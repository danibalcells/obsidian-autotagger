/**
 * Annotation web UI for generating ground truth, tag descriptions, and annotation metadata.
 *
 * Usage:
 *   npm run sample          # generate tests/fixtures/sample.json first
 *   npm run annotate        # start the UI
 *
 * Views:
 *   Annotate — label notes with tags, entities, and descriptions
 *   Tags     — browse all tags, edit/generate descriptions, view tagged notes
 *
 * Saves progress incrementally to tests/fixtures/:
 *   ground-truth.json     — { notePath: { tags, people, organizations, places } }
 *   tag-descriptions.json — { tag: "one-line description" }
 *   annotation-meta.json  — { notePath: { time_spent_ms, notes, added_new_tags, last_saved } }
 */

import express from "express";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import { configDotenv } from "dotenv";
import matter from "gray-matter";
import type { RegistryContext, LLMResponse } from "../src/types";

configDotenv({ path: ".env.eval" });

const SAMPLE_PATH = path.join("tests", "fixtures", "sample.json");
const DATA_PATH = path.join("tests", "fixtures", "data.json");
const GROUND_TRUTH_PATH = path.join("tests", "fixtures", "ground-truth.json");
const TAG_DESCRIPTIONS_PATH = path.join("tests", "fixtures", "tag-descriptions.json");
const ANNOTATION_META_PATH = path.join("tests", "fixtures", "annotation-meta.json");

if (!fs.existsSync(SAMPLE_PATH)) {
  console.error(`Missing sample.json. Run: npm run sample`);
  process.exit(1);
}

interface SampleEntry {
  path: string;
  category: string;
}

interface SampleFile {
  vaultPath: string;
  notes: SampleEntry[];
}

interface AnnotationMeta {
  time_spent_ms: number;
  notes: string;
  added_new_tags: boolean;
  last_saved: string;
}

const sampleFile: SampleFile = JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf-8"));
const vaultPath = process.env.VAULT_PATH ?? sampleFile.vaultPath;

if (!vaultPath) {
  console.error("VAULT_PATH not set and not found in sample.json.");
  process.exit(1);
}

function loadJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function saveJson(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function findPort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(start, () => srv.close(() => resolve(start)));
    srv.on("error", () => findPort(start + 1).then(resolve).catch(reject));
  });
}

// ─── Vault tag index (lazy, cached) ──────────────────────────────────────────

let vaultTagIndex: Record<string, string[]> | null = null;

function getVaultTagIndex(): Record<string, string[]> {
  if (vaultTagIndex) return vaultTagIndex;
  const index: Record<string, string[]> = {};

  function walkDir(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        !entry.name.startsWith(".")
      ) {
        try {
          const raw = fs.readFileSync(fullPath, "utf-8");
          const { data } = matter(raw);
          const rawTags = data["tags"];
          const tags: string[] = Array.isArray(rawTags)
            ? rawTags.filter((t: unknown): t is string => typeof t === "string")
            : typeof rawTags === "string" && rawTags
            ? [rawTags]
            : [];
          const relPath = path.relative(vaultPath, fullPath);
          const relLower = relPath.toLowerCase().replace(/\\/g, "/");
          if (relLower.startsWith("archive/topics/")) continue;
          for (const tag of tags) {
            if (!index[tag]) index[tag] = [];
            index[tag].push(relPath);
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  console.log("Building vault tag index…");
  walkDir(vaultPath);
  vaultTagIndex = index;
  const total = Object.values(index).reduce((s, v) => s + v.length, 0);
  console.log(`  ${Object.keys(index).length} tags, ${total} tag-note pairs indexed`);
  return index;
}

function truncateNoteContent(rawContent: string, maxWords = 1000): string {
  const withoutFm = rawContent.replace(/^---[\s\S]*?---\s*\n?/, "");
  const words = withoutFm.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= maxWords * 2) return withoutFm;
  const first = words.slice(0, maxWords).join(" ");
  const last = words.slice(-maxWords).join(" ");
  const dropped = Math.max(0, withoutFm.length - first.length - last.length - 6);
  return `${first}\n\n... [truncated ${dropped} characters] ...\n\n${last}`;
}

async function generateTagDescription(
  tag: string
): Promise<{ description: string; sourceNotes: string[] }> {
  const index = getVaultTagIndex();
  const descs = loadJson<Record<string, string>>(TAG_DESCRIPTIONS_PATH, {});
  const tagNotes = index[tag] ?? [];
  if (tagNotes.length === 0) throw new Error("No vault notes tagged with this tag");

  // Round-robin across top-level folders for diversity, up to 15 notes
  const byFolder: Record<string, string[]> = {};
  for (const notePath of tagNotes) {
    const folder = notePath.split("/")[0];
    if (!byFolder[folder]) byFolder[folder] = [];
    byFolder[folder].push(notePath);
  }
  const folderQueues: Record<string, string[]> = Object.fromEntries(
    Object.entries(byFolder).map(([f, notes]) => [f, [...notes]])
  );
  const folders = Object.keys(folderQueues).sort();
  const selectedNotes: string[] = [];
  while (selectedNotes.length < 15) {
    let added = false;
    for (const folder of folders) {
      if (selectedNotes.length >= 15) break;
      if (folderQueues[folder].length > 0) {
        selectedNotes.push(folderQueues[folder].shift()!);
        added = true;
      }
    }
    if (!added) break;
  }

  // Few-shot: up to 3 tags with descriptions + 2 snippet notes each, ≤ 2000 words total
  const exampleEntries = Object.entries(descs).filter(
    ([t, d]) => t !== tag && d.trim().length > 0 && (index[t]?.length ?? 0) >= 2
  );
  let fewShotSection = "";
  let fewShotWords = 0;
  const MAX_FEWSHOT_WORDS = 2000;

  if (exampleEntries.length > 0) {
    fewShotSection += "Example tags with descriptions:\n\n";
    fewShotWords += 6;
    for (const [exTag, exDesc] of exampleEntries.slice(0, 3)) {
      if (fewShotWords >= MAX_FEWSHOT_WORDS) break;
      let block = `Tag: ${exTag}\nDescription: "${exDesc}"\n`;
      for (const np of (index[exTag] ?? []).slice(0, 2)) {
        const abs = path.join(vaultPath, np);
        if (!fs.existsSync(abs)) continue;
        const snippet = fs
          .readFileSync(abs, "utf-8")
          .replace(/^---[\s\S]*?---\s*\n?/, "")
          .split(/\s+/)
          .filter((w) => w)
          .slice(0, 120)
          .join(" ");
        block += `  Note (${path.basename(np, ".md")}): ${snippet}\n`;
      }
      const blockWords = block.split(/\s+/).length;
      if (fewShotWords + blockWords > MAX_FEWSHOT_WORDS) break;
      fewShotSection += block + "\n";
      fewShotWords += blockWords;
    }
    fewShotSection += "---\n\n";
  }

  // Notes for target tag
  const includedNotes: string[] = [];
  let notesSection = "";
  for (const notePath of selectedNotes) {
    const abs = path.join(vaultPath, notePath);
    if (!fs.existsSync(abs)) continue;
    const truncated = truncateNoteContent(fs.readFileSync(abs, "utf-8"), 1000);
    notesSection += `--- ${notePath} ---\n${truncated}\n\n`;
    includedNotes.push(notePath);
  }

  const userMessage =
    fewShotSection +
    `Write a single-line description for the tag "${tag}".\n\n` +
    `Requirements: ≤ 120 characters, no surrounding quotes, captures what makes notes with this tag distinctive.\n\n` +
    `Notes tagged "${tag}" (${includedNotes.length}):\n\n` +
    notesSection +
    `Reply with ONLY the description text.`;

  const apiKey = process.env.API_KEY ?? "";
  const model = process.env.MODEL ?? "claude-sonnet-4-6";
  if (!apiKey) throw new Error("API_KEY not set in .env.eval");

  // Attempt with extended thinking; fall back if the model/version doesn't support it
  let response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      thinking: { type: "enabled", budget_tokens: 3000 },
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 400) {
      console.warn("Extended thinking unavailable, retrying without it…");
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
      if (!response.ok) {
        throw new Error(`Anthropic API error ${response.status}: ${await response.text()}`);
      }
    } else {
      throw new Error(`Anthropic API error ${response.status}: ${errText}`);
    }
  }

  const json = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  const description = json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
  return { description, sourceNotes: includedNotes };
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// ─── Annotate API ─────────────────────────────────────────────────────────────

app.get("/api/sample", (_req, res) => {
  const gt = loadJson<Record<string, LLMResponse>>(GROUND_TRUTH_PATH, {});
  res.json({
    notes: sampleFile.notes.map((n) => ({
      ...n,
      labeled: n.path in gt,
    })),
  });
});

app.get("/api/notes/*notePath", (req, res) => {
  const notePath = [req.params.notePath].flat().join("/");
  const absPath = path.join(vaultPath, notePath);
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: "Not found" });
  res.json({ content: fs.readFileSync(absPath, "utf-8"), notePath });
});

app.get("/api/data", (_req, res) => {
  res.json(loadJson<RegistryContext>(DATA_PATH, { entities: [], tags: [] }));
});

app.get("/api/ground-truth", (_req, res) => {
  res.json(loadJson<Record<string, LLMResponse>>(GROUND_TRUTH_PATH, {}));
});

app.get("/api/tag-descriptions", (_req, res) => {
  res.json(loadJson<Record<string, string>>(TAG_DESCRIPTIONS_PATH, {}));
});

app.get("/api/annotation-meta", (_req, res) => {
  res.json(loadJson<Record<string, AnnotationMeta>>(ANNOTATION_META_PATH, {}));
});

interface SavePayload {
  annotation: Omit<LLMResponse, "new_tags">;
  newTags: string[];
  tagDescriptions: Record<string, string>;
  meta: { time_spent_ms: number; notes: string; added_new_tags: boolean };
}

app.post("/api/save/*notePath", (req, res) => {
  const notePath = [req.params.notePath].flat().join("/");
  const body = req.body as SavePayload;

  const gt = loadJson<Record<string, LLMResponse>>(GROUND_TRUTH_PATH, {});
  gt[notePath] = {
    people: body.annotation.people,
    organizations: body.annotation.organizations,
    places: body.annotation.places,
    tags: body.annotation.tags,
    new_tags: body.newTags,
  };
  saveJson(GROUND_TRUTH_PATH, gt);

  const descs = loadJson<Record<string, string>>(TAG_DESCRIPTIONS_PATH, {});
  for (const [tag, desc] of Object.entries(body.tagDescriptions)) {
    if (desc.trim()) descs[tag] = desc.trim();
  }
  saveJson(TAG_DESCRIPTIONS_PATH, descs);

  const meta = loadJson<Record<string, AnnotationMeta>>(ANNOTATION_META_PATH, {});
  const existing = meta[notePath];
  meta[notePath] = {
    time_spent_ms: (existing?.time_spent_ms ?? 0) + body.meta.time_spent_ms,
    notes: body.meta.notes,
    added_new_tags: body.meta.added_new_tags,
    last_saved: new Date().toISOString(),
  };
  saveJson(ANNOTATION_META_PATH, meta);

  res.json({ ok: true });
});

app.delete("/api/ground-truth/*notePath", (req, res) => {
  const notePath = [req.params.notePath].flat().join("/");
  const gt = loadJson<Record<string, LLMResponse>>(GROUND_TRUTH_PATH, {});
  delete gt[notePath];
  saveJson(GROUND_TRUTH_PATH, gt);
  res.json({ ok: true });
});

// ─── Tags API ─────────────────────────────────────────────────────────────────

app.get("/api/tags", (_req, res) => {
  const data = loadJson<RegistryContext>(DATA_PATH, { entities: [], tags: [] });
  const descs = loadJson<Record<string, string>>(TAG_DESCRIPTIONS_PATH, {});
  const index = getVaultTagIndex();

  const allTagSet = new Set<string>([
    ...data.tags.map((t) => t.tag),
    ...Object.keys(descs),
    ...Object.keys(index),
  ]);

  const tagList = [...allTagSet]
    .map((tag) => {
      const reg = data.tags.find((t) => t.tag === tag);
      return {
        tag,
        description: descs[tag] ?? reg?.description ?? "",
        noteCount: index[tag]?.length ?? 0,
        registryCount: reg?.count ?? 0,
      };
    })
    .sort(
      (a, b) =>
        b.noteCount - a.noteCount ||
        b.registryCount - a.registryCount ||
        a.tag.localeCompare(b.tag)
    );

  res.json(tagList);
});

app.get("/api/tag-notes", (req, res) => {
  const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
  if (!tag) return res.status(400).json({ error: "tag query param required" });
  const index = getVaultTagIndex();
  const notes = (index[tag] ?? []).map((notePath) => ({
    path: notePath,
    folder: notePath.split("/").slice(0, 2).join("/"),
    name: path.basename(notePath, ".md"),
  }));
  res.json({ notes });
});

app.post("/api/tag-descriptions", (req, res) => {
  const { tag, description } = req.body as { tag: string; description: string };
  if (!tag) return res.status(400).json({ error: "tag required" });
  const descs = loadJson<Record<string, string>>(TAG_DESCRIPTIONS_PATH, {});
  if (description && description.trim()) {
    descs[tag] = description.trim();
  } else {
    delete descs[tag];
  }
  saveJson(TAG_DESCRIPTIONS_PATH, descs);
  res.json({ ok: true });
});

app.post("/api/tag-generate", async (req, res) => {
  const { tag } = req.body as { tag: string };
  if (!tag) return res.status(400).json({ error: "tag required" });
  try {
    const result = await generateTagDescription(tag);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/", (_req, res) => res.send(HTML));

findPort(3000).then((port) => {
  app.listen(port, () => {
    console.log(`\nAnnotation UI → http://localhost:${port}`);
    console.log(`Vault    : ${vaultPath}`);
    console.log(`Sample   : ${sampleFile.notes.length} notes`);
    console.log(`Outputs  : tests/fixtures/{ground-truth,tag-descriptions,annotation-meta}.json\n`);
  });
});

// ─── HTML ─────────────────────────────────────────────────────────────────────

const HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Annotation UI</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .note-content { font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  .chip { display:inline-flex; align-items:center; gap:4px; background:#e0e7ff; color:#3730a3; border-radius:4px; padding:2px 8px; font-size:12px; cursor:default; }
  .chip-new { background:#fef3c7; color:#92400e; }
  .chip-remove { cursor:pointer; opacity:0.5; font-size:14px; line-height:1; margin-left:2px; }
  .chip-remove:hover { opacity:1; }
  .chip-desc-btn { cursor:pointer; opacity:0.5; font-size:11px; margin-left:2px; }
  .chip-desc-btn:hover { opacity:1; }
  .dropdown { position:absolute; z-index:50; background:white; border:1px solid #e5e7eb; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,0.12); max-height:220px; overflow-y:auto; min-width:100%; }
  .dropdown-item { padding:6px 10px; cursor:pointer; font-size:13px; display:flex; flex-direction:column; }
  .dropdown-item:hover, .dropdown-item.active { background:#eff6ff; }
  .dropdown-item.dropdown-create { border-top:1px solid #f3f4f6; }
  .dropdown-item.dropdown-create span:first-child { color:#92400e; }
  .dropdown-item.dropdown-create:hover, .dropdown-item.dropdown-create.active { background:#fffbeb; }
  .dropdown-item .sub { font-size:11px; color:#9ca3af; }
  .tag-input-wrap { position:relative; }
  .saved-flash { transition: opacity 0.4s; }
  #sidebar { min-width:220px; max-width:220px; }
  #content-pane { flex:1; min-width:0; }
  #anno-pane { min-width:300px; max-width:300px; }
  .note-item { cursor:pointer; padding:5px 10px; border-radius:6px; font-size:11px; display:flex; align-items:center; gap:6px; }
  .note-item:hover { background:#f3f4f6; }
  .note-item.active { background:#eff6ff; color:#1d4ed8; }
  .note-item .cat-badge { font-size:9px; padding:1px 4px; border-radius:3px; background:#f3f4f6; color:#6b7280; flex-shrink:0; }
  .dot { width:7px; height:7px; border-radius:50%; flex-shrink:0; }
  .dot.labeled { background:#22c55e; }
  .dot.unlabeled { background:#d1d5db; }
  .desc-row { display:flex; align-items:center; gap:4px; margin-top:3px; background:#fffbeb; border:1px solid #fde68a; border-radius:4px; padding:3px 6px; }
  .desc-row input { flex:1; font-size:11px; border:none; outline:none; background:transparent; color:#92400e; }
  .desc-row label { font-size:10px; color:#b45309; white-space:nowrap; }
  .tab-btn { color:#6b7280; font-weight:500; transition:all 0.1s; }
  .tab-btn.active { background:white; color:#1d4ed8; box-shadow:0 1px 2px rgba(0,0,0,0.08); }
  .tag-note-row { border-bottom:1px solid #f3f4f6; }
  .tag-note-row:last-child { border-bottom:none; }
  .tag-note-header { cursor:pointer; display:flex; align-items:center; gap:6px; padding:6px 8px; }
  .tag-note-header:hover { background:#f9fafb; }
  .tag-note-body { padding:0 8px 8px; }
  ::-webkit-scrollbar { width:5px; height:5px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#d1d5db; border-radius:3px; }
</style>
</head>
<body class="bg-gray-50 h-screen flex flex-col overflow-hidden">

<!-- Header -->
<header class="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-4 shrink-0">
  <span class="font-semibold text-gray-800 text-sm">Annotation UI</span>
  <div class="flex gap-0.5 bg-gray-100 rounded p-0.5">
    <button id="tab-annotate" class="tab-btn active text-xs px-3 py-1 rounded" onclick="switchTab('annotate')">Annotate</button>
    <button id="tab-tags" class="tab-btn text-xs px-3 py-1 rounded" onclick="switchTab('tags')">Tags</button>
  </div>
  <div class="flex-1 bg-gray-200 rounded-full h-1.5 max-w-xs">
    <div id="progress-bar" class="bg-indigo-500 h-1.5 rounded-full transition-all"></div>
  </div>
  <span id="progress-label" class="text-xs text-gray-500"></span>
  <span id="saved-indicator" class="text-xs text-green-600 saved-flash opacity-0">Saved ✓</span>
</header>

<!-- Annotate view -->
<div id="annotate-view" class="flex flex-1 overflow-hidden">

  <!-- Sidebar: note list -->
  <aside id="sidebar" class="bg-white border-r border-gray-200 flex flex-col overflow-hidden">
    <div class="p-2 border-b border-gray-100">
      <input id="note-search" type="text" placeholder="Filter notes…"
        class="w-full text-xs border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-indigo-400">
    </div>
    <div id="note-list" class="flex-1 overflow-y-auto p-1"></div>
  </aside>

  <!-- Content pane -->
  <main id="content-pane" class="flex flex-col overflow-hidden bg-white border-r border-gray-200">
    <div class="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
      <span class="text-xs text-gray-400 font-mono truncate" id="content-filename">Select a note</span>
      <span id="content-category" class="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded ml-2 shrink-0"></span>
    </div>
    <div class="flex-1 overflow-y-auto p-4">
      <pre id="content-text" class="note-content text-gray-700"></pre>
    </div>
  </main>

  <!-- Annotation pane -->
  <aside id="anno-pane" class="bg-white flex flex-col overflow-hidden">
    <div class="flex-1 overflow-y-auto p-3 space-y-4" id="anno-fields">
      <p class="text-xs text-gray-400 mt-4 text-center">Select a note to annotate</p>
    </div>
    <div class="border-t border-gray-100 p-3 space-y-2">
      <div>
        <label class="text-xs font-medium text-gray-500 block mb-1">Annotator notes</label>
        <textarea id="anno-notes" rows="2"
          class="w-full text-xs border border-gray-200 rounded p-2 outline-none focus:border-indigo-400 resize-none"
          placeholder="e.g. borderline inner/ vs social/…"></textarea>
      </div>
      <div class="flex gap-2">
        <button id="clear-btn" class="flex-1 text-xs py-1.5 border border-gray-200 rounded text-gray-500 hover:bg-gray-50">Clear</button>
        <button id="save-btn" class="flex-1 text-xs py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-medium">Save</button>
      </div>
    </div>
  </aside>

</div>

<!-- Tags view -->
<div id="tags-view" class="flex flex-1 overflow-hidden hidden">

  <!-- Tag sidebar -->
  <aside style="min-width:220px;max-width:220px" class="bg-white border-r border-gray-200 flex flex-col overflow-hidden">
    <div class="p-2 border-b border-gray-100">
      <input id="tag-search" type="text" placeholder="Filter tags…"
        class="w-full text-xs border border-gray-200 rounded px-2 py-1.5 outline-none focus:border-indigo-400">
    </div>
    <div id="tag-list" class="flex-1 overflow-y-auto p-1"></div>
  </aside>

  <!-- Tag main panel -->
  <main class="flex-1 flex flex-col overflow-hidden bg-white">
    <div class="px-4 py-2 border-b border-gray-100 flex items-center gap-2 shrink-0">
      <span id="tag-header" class="text-xs font-mono text-gray-500 truncate">Select a tag</span>
    </div>
    <div id="tag-empty-state" class="flex-1 flex items-center justify-center">
      <p class="text-xs text-gray-400">Select a tag to view and edit its description</p>
    </div>
    <div id="tag-content" class="flex-1 overflow-y-auto p-4 space-y-5 hidden">
      <!-- Description -->
      <div>
        <label class="text-xs font-medium text-gray-500 block mb-1.5">Description</label>
        <div class="flex gap-2 items-start">
          <textarea id="tag-desc" rows="2"
            class="flex-1 text-xs border border-gray-200 rounded p-2 outline-none focus:border-indigo-400 resize-none"
            placeholder="One-line description of this tag…"></textarea>
          <button id="tag-generate-btn"
            class="text-xs px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-200 rounded whitespace-nowrap shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Auto-generate description from vault notes" disabled>✨ Generate</button>
        </div>
        <div id="tag-generate-source" class="text-xs text-gray-400 mt-1 italic"></div>
      </div>
      <!-- Notes list -->
      <div>
        <label class="text-xs font-medium text-gray-500 block mb-2" id="tag-notes-label">Tagged notes</label>
        <div id="tag-notes-list" class="border border-gray-100 rounded-md overflow-hidden"></div>
      </div>
    </div>
  </main>

</div>

<script>
// ─── State ─────────────────────────────────────────────────────────────────
let allNotes = [];
let registryData = { entities: [], tags: [] };
let groundTruth = {};
let tagDescriptions = {};
let annotationMeta = {};
let currentNote = null;
let saveTimer = null;
let noteStartTime = null;
let accumulatedMs = 0;
const tagInputs = {};

// Tags view state
let allTags = [];
let currentTag = null;
let tagNoteContentCache = {};
let tagNotesExpanded = {};
let tagSaveTimer = null;
let tagsViewBooted = false;

// ─── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
  const annotateView = document.getElementById('annotate-view');
  const tagsView = document.getElementById('tags-view');
  const tabAnnotate = document.getElementById('tab-annotate');
  const tabTags = document.getElementById('tab-tags');
  if (tab === 'annotate') {
    annotateView.classList.remove('hidden');
    tagsView.classList.add('hidden');
    tabAnnotate.classList.add('active');
    tabTags.classList.remove('active');
    updateProgress();
  } else {
    annotateView.classList.add('hidden');
    tagsView.classList.remove('hidden');
    tabAnnotate.classList.remove('active');
    tabTags.classList.add('active');
    if (!tagsViewBooted) {
      bootTagsView();
      tagsViewBooted = true;
    } else {
      updateTagProgress();
    }
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────
async function boot() {
  const [sampleRes, dataRes, gtRes, tdRes, metaRes] = await Promise.all([
    fetch('/api/sample').then(r => r.json()),
    fetch('/api/data').then(r => r.json()),
    fetch('/api/ground-truth').then(r => r.json()),
    fetch('/api/tag-descriptions').then(r => r.json()),
    fetch('/api/annotation-meta').then(r => r.json()),
  ]);
  allNotes = sampleRes.notes;
  registryData = dataRes;
  groundTruth = gtRes;
  tagDescriptions = tdRes;
  annotationMeta = metaRes;

  renderNoteList(allNotes);
  updateProgress();

  document.getElementById('note-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderNoteList(q ? allNotes.filter(n => n.path.toLowerCase().includes(q) || n.category.includes(q)) : allNotes);
  });

  const first = allNotes.find(n => !(n.path in groundTruth)) ?? allNotes[0];
  if (first) selectNote(first);
}

// ─── Note list ─────────────────────────────────────────────────────────────
function renderNoteList(notes) {
  const list = document.getElementById('note-list');
  list.innerHTML = '';
  notes.forEach(note => {
    const div = document.createElement('div');
    div.className = 'note-item' + (currentNote?.path === note.path ? ' active' : '');
    div.dataset.path = note.path;
    const labeled = note.path in groundTruth;
    const name = note.path.split('/').pop().replace(/\\.md$/, '');
    div.innerHTML =
      '<div class="dot ' + (labeled ? 'labeled' : 'unlabeled') + '"></div>' +
      '<span class="truncate flex-1" title="' + note.path + '">' + name + '</span>' +
      '<span class="cat-badge">' + note.category + '</span>';
    div.addEventListener('click', () => selectNote(note));
    list.appendChild(div);
  });
}

function refreshNoteList() {
  const q = document.getElementById('note-search').value.toLowerCase();
  renderNoteList(q ? allNotes.filter(n => n.path.toLowerCase().includes(q) || n.category.includes(q)) : allNotes);
}

// ─── Select note ───────────────────────────────────────────────────────────
async function selectNote(note) {
  if (currentNote?.path === note.path) return;
  currentNote = note;
  noteStartTime = Date.now();
  accumulatedMs = 0;

  document.getElementById('content-filename').textContent = note.path;
  document.getElementById('content-category').textContent = note.category;
  const { content } = await fetch('/api/notes/' + note.path.split('/').map(encodeURIComponent).join('/')).then(r => r.json());
  document.getElementById('content-text').textContent = content;

  const gt = groundTruth[note.path];
  const meta = annotationMeta[note.path];
  document.getElementById('anno-notes').value = meta?.notes ?? '';

  renderAnnoFields(gt);
  refreshNoteList();
}

// ─── Helpers to split saved values into known vs new ───────────────────────
function splitByRegistry(names, type) {
  const knownSet = new Set(
    registryData.entities.filter(e => e.type === type).map(e => e.canonicalName)
  );
  return {
    known: (names || []).filter(n => knownSet.has(n)),
    created: (names || []).filter(n => !knownSet.has(n)),
  };
}

function splitTagsByRegistry(tags, newTags) {
  const knownSet = new Set(registryData.tags.map(t => t.tag));
  return {
    known: (tags || []).filter(t => knownSet.has(t)),
    created: [
      ...(tags || []).filter(t => !knownSet.has(t)),
      ...(newTags || []),
    ],
  };
}

// ─── Annotation fields ─────────────────────────────────────────────────────
function renderAnnoFields(existing) {
  const container = document.getElementById('anno-fields');
  container.innerHTML = '';
  Object.values(tagInputs).forEach(ti => ti.destroy());
  Object.keys(tagInputs).forEach(k => delete tagInputs[k]);

  const ex = existing ?? { people: [], organizations: [], places: [], tags: [], new_tags: [] };

  const entityOpts = (type) => registryData.entities
    .filter(e => e.type === type)
    .map(e => ({ value: e.canonicalName, label: e.canonicalName, sub: e.aliases.join(', ') }));

  const tagOpts = () => registryData.tags
    .map(t => ({ value: t.tag, label: t.tag, sub: (t.description || '') + (t.count ? '  ×' + t.count : '') }));

  const { known: kPeople,  created: cPeople  } = splitByRegistry(ex.people,        'person');
  const { known: kOrgs,    created: cOrgs    } = splitByRegistry(ex.organizations,  'organization');
  const { known: kPlaces,  created: cPlaces  } = splitByRegistry(ex.places,         'place');
  const { known: kTags,    created: cTags    } = splitTagsByRegistry(ex.tags, ex.new_tags);

  const initTagDescs = Object.fromEntries(
    [...kTags, ...cTags].map(t => [t, tagDescriptions[t] ?? ''])
  );

  tagInputs.people = new TagInput(container, 'People', entityOpts('person'), kPeople, cPeople, false, {}, val => {
    registryData.entities.push({ canonicalName: val, aliases: [], type: 'person', description: '' });
  });
  tagInputs.organizations = new TagInput(container, 'Organizations', entityOpts('organization'), kOrgs, cOrgs, false, {}, val => {
    registryData.entities.push({ canonicalName: val, aliases: [], type: 'organization', description: '' });
  });
  tagInputs.places = new TagInput(container, 'Places', entityOpts('place'), kPlaces, cPlaces, false, {}, val => {
    registryData.entities.push({ canonicalName: val, aliases: [], type: 'place', description: '' });
  });
  tagInputs.tags = new TagInput(container, 'Tags', tagOpts(), kTags, cTags, true, initTagDescs, val => {
    registryData.tags.push({ tag: val, description: '', count: 0 });
  });
}

// ─── Collect annotation state ───────────────────────────────────────────────
function collectAnnotation() {
  const newTags = tagInputs.tags?.getCreated() ?? [];
  const elapsedMs = noteStartTime ? (Date.now() - noteStartTime) : 0;
  const cappedMs = Math.min(elapsedMs, 10 * 60 * 1000);

  return {
    annotation: {
      people:        [...(tagInputs.people?.getKnown()        ?? []), ...(tagInputs.people?.getCreated()        ?? [])],
      organizations: [...(tagInputs.organizations?.getKnown() ?? []), ...(tagInputs.organizations?.getCreated() ?? [])],
      places:        [...(tagInputs.places?.getKnown()        ?? []), ...(tagInputs.places?.getCreated()        ?? [])],
      tags:          tagInputs.tags?.getKnown() ?? [],
    },
    newTags,
    tagDescriptions: tagInputs.tags?.getDescriptions() ?? {},
    meta: {
      time_spent_ms: accumulatedMs + cappedMs,
      notes: document.getElementById('anno-notes').value,
      added_new_tags: newTags.length > 0,
    },
  };
}

// ─── Save ───────────────────────────────────────────────────────────────────
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
}

async function save() {
  if (!currentNote) return;
  const payload = collectAnnotation();

  accumulatedMs = payload.meta.time_spent_ms;
  noteStartTime = Date.now();

  await fetch('/api/save/' + currentNote.path.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  groundTruth[currentNote.path] = { ...payload.annotation, new_tags: payload.newTags };
  Object.assign(tagDescriptions, payload.tagDescriptions);

  updateProgress();
  refreshNoteList();
  flashSaved();
}

function flashSaved() {
  const el = document.getElementById('saved-indicator');
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 1600);
}

function updateProgress() {
  const labeled = allNotes.filter(n => n.path in groundTruth).length;
  const total = allNotes.length;
  document.getElementById('progress-bar').style.width = total > 0 ? (labeled / total * 100) + '%' : '0%';
  document.getElementById('progress-label').textContent = labeled + '/' + total + ' labeled';
}

function updateTagProgress() {
  const described = allTags.filter(t => t.description && t.description.trim()).length;
  const total = allTags.length;
  document.getElementById('progress-bar').style.width = total > 0 ? (described / total * 100) + '%' : '0%';
  document.getElementById('progress-label').textContent = described + '/' + total + ' described';
}

document.getElementById('save-btn').addEventListener('click', () => { clearTimeout(saveTimer); save(); });

document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!currentNote) return;
  if (!confirm('Clear annotation for this note?')) return;
  await fetch('/api/ground-truth/' + currentNote.path.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' });
  delete groundTruth[currentNote.path];
  renderAnnoFields(null);
  document.getElementById('anno-notes').value = '';
  updateProgress();
  refreshNoteList();
});

// ─── Tags view ─────────────────────────────────────────────────────────────
async function bootTagsView() {
  const tagsRes = await fetch('/api/tags').then(r => r.json());
  allTags = tagsRes;
  renderTagList(allTags);
  updateTagProgress();

  document.getElementById('tag-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderTagList(q ? allTags.filter(t => t.tag.toLowerCase().includes(q)) : allTags);
  });
}

function renderTagList(tags) {
  const list = document.getElementById('tag-list');
  list.innerHTML = '';
  tags.forEach(tag => {
    const div = document.createElement('div');
    div.className = 'note-item' + (currentTag?.tag === tag.tag ? ' active' : '');
    const hasDesc = tag.description && tag.description.trim();
    div.innerHTML =
      '<div class="dot ' + (hasDesc ? 'labeled' : 'unlabeled') + '"></div>' +
      '<span class="truncate flex-1" title="' + escHtml(tag.tag) + '">' + escHtml(tag.tag) + '</span>' +
      '<span class="cat-badge">' + tag.noteCount + '</span>';
    div.addEventListener('click', () => selectTag(tag));
    list.appendChild(div);
  });
}

function refreshTagList() {
  const q = document.getElementById('tag-search').value.toLowerCase();
  renderTagList(q ? allTags.filter(t => t.tag.toLowerCase().includes(q)) : allTags);
}

async function selectTag(tag) {
  currentTag = tag;
  refreshTagList();

  document.getElementById('tag-header').textContent = tag.tag;
  document.getElementById('tag-desc').value = tag.description ?? '';

  const generateBtn = document.getElementById('tag-generate-btn');
  generateBtn.disabled = tag.noteCount === 0;
  generateBtn.textContent = '✨ Generate';
  document.getElementById('tag-generate-source').textContent = '';

  document.getElementById('tag-empty-state').classList.add('hidden');
  document.getElementById('tag-content').classList.remove('hidden');

  document.getElementById('tag-notes-label').textContent =
    'Tagged notes (' + tag.noteCount + ')';

  const notesContainer = document.getElementById('tag-notes-list');
  notesContainer.innerHTML = '<div class="p-2 text-xs text-gray-400">Loading…</div>';

  const { notes } = await fetch('/api/tag-notes?tag=' + encodeURIComponent(tag.tag)).then(r => r.json());
  renderTagNotes(notes);
}

function renderTagNotes(notes) {
  const container = document.getElementById('tag-notes-list');
  container.innerHTML = '';
  if (notes.length === 0) {
    container.innerHTML = '<div class="p-3 text-xs text-gray-400">No notes with this tag found in the vault.</div>';
    return;
  }
  notes.forEach(note => {
    const expanded = tagNotesExpanded[note.path] ?? false;

    const wrapper = document.createElement('div');
    wrapper.className = 'tag-note-row';
    wrapper.dataset.path = note.path;

    const header = document.createElement('div');
    header.className = 'tag-note-header';
    header.innerHTML =
      '<span class="flex-1 text-xs font-mono truncate text-gray-700" title="' + escHtml(note.path) + '">' + escHtml(note.name) + '</span>' +
      '<span class="cat-badge shrink-0">' + escHtml(note.folder) + '</span>' +
      '<span class="text-gray-400 text-xs shrink-0 ml-1 expand-chevron">' + (expanded ? '▲' : '▼') + '</span>';

    const body = document.createElement('div');
    body.className = 'tag-note-body' + (expanded ? '' : ' hidden');
    if (expanded && tagNoteContentCache[note.path]) {
      const pre = document.createElement('pre');
      pre.className = 'note-content text-gray-600 text-xs max-h-64 overflow-y-auto bg-gray-50 rounded p-2';
      pre.textContent = tagNoteContentCache[note.path];
      body.appendChild(pre);
    }

    header.addEventListener('click', () => toggleTagNote(wrapper, note));
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    container.appendChild(wrapper);
  });
}

async function toggleTagNote(wrapper, note) {
  const body = wrapper.querySelector('.tag-note-body');
  const chevron = wrapper.querySelector('.expand-chevron');
  const isExpanded = !body.classList.contains('hidden');

  if (isExpanded) {
    body.classList.add('hidden');
    chevron.textContent = '▼';
    tagNotesExpanded[note.path] = false;
  } else {
    chevron.textContent = '▲';
    tagNotesExpanded[note.path] = true;
    body.classList.remove('hidden');
    if (!tagNoteContentCache[note.path]) {
      body.innerHTML = '<p class="text-xs text-gray-400 py-2 px-1">Loading…</p>';
      try {
        const { content } = await fetch(
          '/api/notes/' + note.path.split('/').map(encodeURIComponent).join('/')
        ).then(r => r.json());
        tagNoteContentCache[note.path] = content;
        body.innerHTML = '';
        const pre = document.createElement('pre');
        pre.className = 'note-content text-gray-600 text-xs max-h-64 overflow-y-auto bg-gray-50 rounded p-2';
        pre.textContent = content;
        body.appendChild(pre);
      } catch {
        body.innerHTML = '<p class="text-xs text-red-400 py-2 px-1">Failed to load note.</p>';
      }
    } else {
      body.innerHTML = '';
      const pre = document.createElement('pre');
      pre.className = 'note-content text-gray-600 text-xs max-h-64 overflow-y-auto bg-gray-50 rounded p-2';
      pre.textContent = tagNoteContentCache[note.path];
      body.appendChild(pre);
    }
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Tag description — debounced auto-save
document.getElementById('tag-desc').addEventListener('input', e => {
  if (currentTag) {
    currentTag.description = e.target.value;
    clearTimeout(tagSaveTimer);
    tagSaveTimer = setTimeout(saveTagDescription, 700);
  }
});

async function saveTagDescription() {
  if (!currentTag) return;
  const desc = document.getElementById('tag-desc').value;
  await fetch('/api/tag-descriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag: currentTag.tag, description: desc }),
  });
  const tagInList = allTags.find(t => t.tag === currentTag.tag);
  if (tagInList) tagInList.description = desc;
  refreshTagList();
  updateTagProgress();
  flashSaved();
}

// Generate description
document.getElementById('tag-generate-btn').addEventListener('click', async () => {
  if (!currentTag) return;
  const btn = document.getElementById('tag-generate-btn');
  const sourceEl = document.getElementById('tag-generate-source');
  btn.disabled = true;
  btn.textContent = '⏳ Generating…';
  sourceEl.textContent = '';
  sourceEl.style.color = '';

  try {
    const res = await fetch('/api/tag-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: currentTag.tag }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error || 'Unknown error');
    }
    const { description, sourceNotes } = await res.json();
    document.getElementById('tag-desc').value = description;
    currentTag.description = description;
    const noteNames = sourceNotes
      .map(p => p.split('/').pop().replace(/\\.md$/, ''))
      .join(', ');
    sourceEl.textContent = 'Based on ' + sourceNotes.length + ' note(s): ' + noteNames;
    clearTimeout(tagSaveTimer);
    await saveTagDescription();
  } catch (err) {
    sourceEl.textContent = 'Error: ' + err.message;
    sourceEl.style.color = '#ef4444';
    setTimeout(() => { sourceEl.style.color = ''; }, 4000);
  } finally {
    btn.disabled = currentTag ? currentTag.noteCount === 0 : true;
    btn.textContent = '✨ Generate';
  }
});

// ─── TagInput ──────────────────────────────────────────────────────────────
// All fields support creating new entries. Values from the registry get blue
// chips; values the user creates get amber chips and are tracked separately.
class TagInput {
  // options:      [{value, label, sub}] — current registry entries
  // knownSel:     string[] — pre-selected values that exist in registry
  // createdSel:   string[] — pre-selected values not in registry
  // withDesc:     bool — show description inputs (tags only)
  // initDescs:    {tag: desc}
  // onNew(value): called when a brand-new value is added; use to update registry
  constructor(container, label, options, knownSel, createdSel, withDesc, initDescs = {}, onNew = null) {
    this.options    = options;
    this.knownSet   = new Set(knownSel || []);
    this.createdSet = new Set(createdSel || []);
    this.withDesc   = withDesc;
    this.descriptions = { ...initDescs };
    this.onNew      = onNew;
    this._openDescs = new Set(createdSel || []); // desc rows open by default for created
    this.filtered   = [];
    this.activeIdx  = -1;

    this.root = document.createElement('div');
    container.appendChild(this.root);
    this._render(label);
    this._bindEvents();
  }

  _render(label) {
    this.root.innerHTML =
      '<div class="text-xs font-medium text-gray-600 mb-1">' + label + '</div>' +
      '<div class="border border-gray-200 rounded-md p-1.5 min-h-8 cursor-text tag-input-wrap">' +
        '<div class="chips-area flex flex-wrap gap-1 mb-1"></div>' +
        '<div class="relative" style="min-width:80px">' +
          '<input type="text" placeholder="Search or create…" class="w-full text-xs outline-none bg-transparent px-1 py-0.5">' +
          '<div class="dropdown hidden"></div>' +
        '</div>' +
      '</div>' +
      '<div class="desc-rows space-y-1 mt-1"></div>';

    this.wrap      = this.root.querySelector('.tag-input-wrap');
    this.chipsArea = this.root.querySelector('.chips-area');
    this.input     = this.root.querySelector('input');
    this.dropdown  = this.root.querySelector('.dropdown');
    this.descRows  = this.root.querySelector('.desc-rows');

    this._renderChips();
    if (this.withDesc) this._renderDescRows();
  }

  _renderChips() {
    this.chipsArea.innerHTML = '';
    // known = blue, created = amber
    const render = (val, isNew) => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (isNew ? ' chip-new' : '');
      chip.innerHTML =
        '<span>' + val + '</span>' +
        (this.withDesc ? '<span class="chip-desc-btn" data-val="' + val + '" title="Edit description">✎</span>' : '') +
        '<span class="chip-remove" data-val="' + val + '">×</span>';
      chip.querySelector('.chip-remove').addEventListener('click', e => {
        e.stopPropagation(); this.remove(e.target.dataset.val);
      });
      if (this.withDesc) {
        chip.querySelector('.chip-desc-btn').addEventListener('click', e => {
          e.stopPropagation(); this._focusDesc(e.target.dataset.val);
        });
      }
      this.chipsArea.appendChild(chip);
    };
    this.knownSet.forEach(v   => render(v, false));
    this.createdSet.forEach(v => render(v, true));
  }

  _renderDescRows() {
    this.descRows.innerHTML = '';
    const allVals = [...this.knownSet, ...this.createdSet];
    allVals.forEach(val => {
      if (!this._openDescs.has(val)) return;
      const isNew = this.createdSet.has(val);
      const existing = this.descriptions[val] ?? '';
      const row = document.createElement('div');
      row.className = 'desc-row';
      row.dataset.tag = val;
      row.innerHTML =
        '<label>' + (isNew ? '✦ ' : '') + val.split('/').pop() + ':</label>' +
        '<input type="text" placeholder="One-line description…" value="' + existing.replace(/"/g, '&quot;') + '">';
      row.querySelector('input').addEventListener('input', e => {
        this.descriptions[val] = e.target.value;
        scheduleSave();
      });
      this.descRows.appendChild(row);
    });
  }

  _focusDesc(val) {
    this._openDescs.add(val);
    this._renderDescRows();
    const row = this.descRows.querySelector('[data-tag="' + val + '"] input');
    if (row) row.focus();
  }

  _bindEvents() {
    this.input.addEventListener('input',   () => this._updateDropdown());
    this.input.addEventListener('focus',   () => this._updateDropdown());
    this.input.addEventListener('keydown', e  => this._onKey(e));
    this.wrap.addEventListener('click',    () => this.input.focus());
    this._outsideClick = e => { if (!this.root.contains(e.target)) this._hideDropdown(); };
    document.addEventListener('mousedown', this._outsideClick);
  }

  _allSelected() {
    return new Set([...this.knownSet, ...this.createdSet]);
  }

  _updateDropdown() {
    const raw = this.input.value.trim();
    const q   = raw.toLowerCase();
    const sel = this._allSelected();

    const matches = this.options
      .filter(o => !sel.has(o.value) &&
        (!q || o.label.toLowerCase().includes(q) || (o.sub && o.sub.toLowerCase().includes(q))))
      .slice(0, 40)
      .map(o => ({ ...o, isCreate: false }));

    // Show a "Create" row when: user has typed something, and it's not already
    // an exact match in options or already added
    const hasExact = this.options.some(o => o.label.toLowerCase() === q);
    this.filtered = [...matches];
    if (raw && !hasExact && !sel.has(raw)) {
      this.filtered.push({ value: raw, label: raw, sub: '✦ Create new entry', isCreate: true });
    }

    if (this.filtered.length === 0) { this._hideDropdown(); return; }
    this.activeIdx = -1;
    this._renderDropdown();
  }

  _renderDropdown() {
    this.dropdown.innerHTML = '';
    this.dropdown.classList.remove('hidden');
    this.filtered.forEach((opt, i) => {
      const item = document.createElement('div');
      item.className = 'dropdown-item' + (opt.isCreate ? ' dropdown-create' : '');
      item.innerHTML = '<span>' + opt.label + '</span>' + (opt.sub ? '<span class="sub">' + opt.sub + '</span>' : '');
      item.addEventListener('mousedown', e => { e.preventDefault(); this._addItem(opt); });
      this.dropdown.appendChild(item);
    });
  }

  _hideDropdown() {
    this.dropdown.classList.add('hidden');
    this.dropdown.innerHTML = '';
    this.filtered = [];
    this.activeIdx = -1;
  }

  _onKey(e) {
    if (e.key === 'Escape') { this._hideDropdown(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.activeIdx = Math.min(this.activeIdx + 1, this.filtered.length - 1);
      this._highlightActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.activeIdx = Math.max(this.activeIdx - 1, 0);
      this._highlightActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.activeIdx >= 0 && this.filtered[this.activeIdx]) {
        this._addItem(this.filtered[this.activeIdx]);
      } else if (this.filtered.length === 1) {
        this._addItem(this.filtered[0]);
      } else if (this.input.value.trim()) {
        // Treat as create if no selection
        this._addItem({ value: this.input.value.trim(), isCreate: true });
      }
    } else if (e.key === 'Backspace' && !this.input.value) {
      // Remove last created first, then last known
      const lastCreated = [...this.createdSet].pop();
      if (lastCreated) { this.remove(lastCreated); return; }
      const lastKnown = [...this.knownSet].pop();
      if (lastKnown) this.remove(lastKnown);
    }
  }

  _highlightActive() {
    [...this.dropdown.children].forEach((el, i) => el.classList.toggle('active', i === this.activeIdx));
  }

  _addItem(opt) {
    const value = opt.value;
    if (!value) return;
    const isCreate = opt.isCreate || !this.options.some(o => o.value === value);

    if (isCreate) {
      this.createdSet.add(value);
      if (this.withDesc) {
        this.descriptions[value] = this.descriptions[value] ?? '';
        this._openDescs.add(value);
      }
      if (this.onNew) this.onNew(value);
    } else {
      this.knownSet.add(value);
    }

    this.input.value = '';
    this._hideDropdown();
    this._renderChips();
    if (this.withDesc) {
      this._renderDescRows();
      if (isCreate) {
        const row = this.descRows.querySelector('[data-tag="' + value + '"] input');
        if (row) setTimeout(() => row.focus(), 50);
      }
    }
    scheduleSave();
  }

  remove(value) {
    this.knownSet.delete(value);
    this.createdSet.delete(value);
    this._openDescs.delete(value);
    this._renderChips();
    if (this.withDesc) this._renderDescRows();
    scheduleSave();
  }

  getKnown()        { return [...this.knownSet]; }
  getCreated()      { return [...this.createdSet]; }
  getDescriptions() { return { ...this.descriptions }; }
  destroy()         { document.removeEventListener('mousedown', this._outsideClick); }
}

// ─── Keyboard shortcuts ────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    clearTimeout(saveTimer);
    save();
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const active = document.activeElement;
    const isInInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (!isInInput) {
      e.preventDefault();
      const idx = allNotes.findIndex(n => n.path === currentNote?.path);
      if (e.key === 'ArrowDown' && idx < allNotes.length - 1) selectNote(allNotes[idx + 1]);
      if (e.key === 'ArrowUp' && idx > 0) selectNote(allNotes[idx - 1]);
    }
  }
});

boot();
</script>
</body>
</html>`;
