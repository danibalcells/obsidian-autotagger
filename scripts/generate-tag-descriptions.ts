/**
 * Batch-generate descriptions for all tags that don't yet have one.
 *
 * Usage:
 *   npm run generate-tags                  # generate all undescribed tags with ≥1 note
 *   npm run generate-tags -- --min-notes=2 # skip tags with fewer than N notes
 *   npm run generate-tags -- --dry-run     # estimate cost without calling the API
 *
 * Saves progress to tests/fixtures/tag-descriptions.json after each tag.
 * Safe to interrupt (Ctrl+C) and resume — already-generated tags are skipped.
 */

import { configDotenv } from "dotenv";
configDotenv({ path: ".env.eval" });

import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";

const VAULT_PATH = process.env.VAULT_PATH ?? "";
const API_KEY = process.env.API_KEY ?? "";
const MODEL = process.env.MODEL ?? "claude-sonnet-4-6";
const TAG_DESCRIPTIONS_PATH = path.join("tests", "fixtures", "tag-descriptions.json");
const THINKING_BUDGET = 3000;
const MAX_NOTES = 15;
const MAX_WORDS_PER_NOTE = 1000;
const MAX_FEWSHOT_WORDS = 2000;

const DRY_RUN = process.argv.includes("--dry-run");
const MIN_NOTES = Number(
  process.argv.find((a) => a.startsWith("--min-notes="))?.split("=")[1] ?? "1"
);
const CONCURRENCY = Number(
  process.argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? "5"
);
const EXCLUDE_PREFIXES = ["type/", "readwise"];

if (!VAULT_PATH) {
  console.error("VAULT_PATH not set in .env.eval");
  process.exit(1);
}
if (!API_KEY && !DRY_RUN) {
  console.error("API_KEY not set in .env.eval");
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Vault index ─────────────────────────────────────────────────────────────

function buildVaultTagIndex(): Record<string, string[]> {
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
          const relPath = path.relative(VAULT_PATH, fullPath);
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

  walkDir(VAULT_PATH);
  return index;
}

// ─── Note truncation ──────────────────────────────────────────────────────────

function truncateNoteContent(rawContent: string, maxWords = MAX_WORDS_PER_NOTE): string {
  const withoutFm = rawContent.replace(/^---[\s\S]*?---\s*\n?/, "");
  const words = withoutFm.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= maxWords * 2) return withoutFm;
  const first = words.slice(0, maxWords).join(" ");
  const last = words.slice(-maxWords).join(" ");
  const dropped = Math.max(0, withoutFm.length - first.length - last.length - 6);
  return `${first}\n\n... [truncated ${dropped} characters] ...\n\n${last}`;
}

// ─── Generation ───────────────────────────────────────────────────────────────

async function generateDescription(
  tag: string,
  tagNotes: string[],
  allDescs: Record<string, string>,
  index: Record<string, string[]>
): Promise<string> {
  // Diverse folder sampling
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
  while (selectedNotes.length < MAX_NOTES) {
    let added = false;
    for (const folder of folders) {
      if (selectedNotes.length >= MAX_NOTES) break;
      if (folderQueues[folder].length > 0) {
        selectedNotes.push(folderQueues[folder].shift()!);
        added = true;
      }
    }
    if (!added) break;
  }

  // Few-shot examples
  const exampleEntries = Object.entries(allDescs).filter(
    ([t, d]) => t !== tag && d.trim().length > 0 && (index[t]?.length ?? 0) >= 2
  );
  let fewShotSection = "";
  let fewShotWords = 0;
  if (exampleEntries.length > 0) {
    fewShotSection += "Example tags with descriptions:\n\n";
    fewShotWords += 6;
    for (const [exTag, exDesc] of exampleEntries.slice(0, 3)) {
      if (fewShotWords >= MAX_FEWSHOT_WORDS) break;
      let block = `Tag: ${exTag}\nDescription: "${exDesc}"\n`;
      for (const np of (index[exTag] ?? []).slice(0, 2)) {
        const abs = path.join(VAULT_PATH, np);
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

  // Notes section
  let notesSection = "";
  let includedCount = 0;
  for (const notePath of selectedNotes) {
    const abs = path.join(VAULT_PATH, notePath);
    if (!fs.existsSync(abs)) continue;
    const truncated = truncateNoteContent(fs.readFileSync(abs, "utf-8"));
    notesSection += `--- ${notePath} ---\n${truncated}\n\n`;
    includedCount++;
  }

  const userMessage =
    fewShotSection +
    `Write a single-line description for the tag "${tag}".\n\n` +
    `Requirements: ≤ 120 characters, no surrounding quotes, captures what makes notes with this tag distinctive.\n\n` +
    `Notes tagged "${tag}" (${includedCount}):\n\n` +
    notesSection +
    `Reply with ONLY the description text.`;

  // Try with extended thinking; fall back without if unsupported
  let response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: THINKING_BUDGET + 512,
      thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 400) {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 512,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
      if (!response.ok) {
        throw new Error(`API error ${response.status}: ${await response.text()}`);
      }
    } else {
      throw new Error(`API error ${response.status}: ${errText}`);
    }
  }

  const json = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stdout.write("Building vault tag index… ");
  const index = buildVaultTagIndex();
  const total = Object.values(index).reduce((s, v) => s + v.length, 0);
  console.log(`${Object.keys(index).length} tags, ${total} tag-note pairs`);

  const descs = loadJson<Record<string, string>>(TAG_DESCRIPTIONS_PATH, {});

  const isExcluded = (tag: string): boolean =>
    EXCLUDE_PREFIXES.some((p) => tag.startsWith(p));

  const queue = Object.entries(index)
    .filter(([tag, notes]) => !descs[tag] && !isExcluded(tag) && notes.length >= MIN_NOTES)
    .sort(([, a], [, b]) => b.length - a.length); // process high-note-count tags first

  const skippedExcluded = Object.keys(index).filter((t) => !descs[t] && isExcluded(t)).length;
  const skippedNoNotes = Object.keys(index).filter(
    (t) => !descs[t] && !isExcluded(t) && index[t].length < MIN_NOTES
  ).length;

  console.log(`\nTags to generate  : ${queue.length}`);
  console.log(`Already described : ${Object.keys(descs).length}`);
  console.log(`Skipped (excluded): ${skippedExcluded}  [${EXCLUDE_PREFIXES.join(", ")}]`);
  console.log(`Skipped (<${MIN_NOTES} notes): ${skippedNoNotes}`);

  if (DRY_RUN) {
    console.log("\n[dry-run] Exiting without calling the API.");
    queue.slice(0, 10).forEach(([tag, notes]) =>
      console.log(`  would generate: ${tag} (${notes.length} notes)`)
    );
    if (queue.length > 10) console.log(`  … and ${queue.length - 10} more`);
    return;
  }

  if (queue.length === 0) {
    console.log("\nNothing to generate.");
    return;
  }

  console.log(`Concurrency       : ${CONCURRENCY}\n`);

  const width = String(queue.length).length;
  let generated = 0;
  let failed = 0;
  let idx = 0;
  const startAll = Date.now();

  // File write mutex — prevents concurrent read-modify-write races on the JSON
  let writeLock = Promise.resolve();

  async function processTag(tag: string, notes: string[], position: number): Promise<void> {
    const prefix = `[${String(position).padStart(width)}/${queue.length}] ${tag} (${notes.length} notes)`;
    const t0 = Date.now();
    try {
      // Check under lock whether it was already written by another worker or the UI
      const alreadyDone = await writeLock.then(
        () => !!loadJson<Record<string, string>>(TAG_DESCRIPTIONS_PATH, {})[tag]
      );
      if (alreadyDone) {
        console.log(`${prefix} — skipped (already set)`);
        return;
      }

      const currentDescs = loadJson<Record<string, string>>(TAG_DESCRIPTIONS_PATH, {});
      const description = await generateDescription(tag, notes, currentDescs, index);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      // Serialize writes
      writeLock = writeLock.then(() => {
        const d = loadJson<Record<string, string>>(TAG_DESCRIPTIONS_PATH, {});
        d[tag] = description;
        saveJson(TAG_DESCRIPTIONS_PATH, d);
      });
      await writeLock;

      console.log(`${prefix} — ${elapsed}s → "${description}"`);
      generated++;
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`${prefix} — FAILED (${elapsed}s): ${String(err).slice(0, 100)}`);
      failed++;
    }
  }

  // Bounded concurrency pool
  const active: Promise<void>[] = [];
  for (const [tag, notes] of queue) {
    const position = ++idx;
    const p = processTag(tag, notes, position).then(() => {
      active.splice(active.indexOf(p), 1);
    });
    active.push(p);
    if (active.length >= CONCURRENCY) await Promise.race(active);
  }
  await Promise.all(active);

  const totalSec = ((Date.now() - startAll) / 1000).toFixed(0);
  console.log(`\nDone in ${totalSec}s — ${generated} generated, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
