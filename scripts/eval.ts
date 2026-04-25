/**
 * Eval script: runs the plugin's LLM adapter over fixture notes and measures
 * precision and recall against manually-curated ground truth.
 *
 * One Langfuse trace per note (when LANGFUSE_ENABLED=true).
 *
 * Usage:
 *   cp .env.eval.example .env.eval
 *   # edit .env.eval
 *   npm run eval
 *
 * Required env vars:
 *   PROVIDER         openai | anthropic | google | ollama
 *   MODEL            e.g. gpt-4o-mini, claude-3-5-haiku-20241022
 *   API_KEY          provider API key (not needed for ollama)
 *
 * Optional:
 *   OLLAMA_URL       default http://localhost:11434
 *   NEW_TAGS_POLICY  existing-only | allow-suggestions  (default: existing-only)
 *   NEW_TAGS_NS      namespace prefix for new tags       (default: topic/)
 *   MAX_INPUT_TOKENS default 8000
 *   MAX_OUTPUT_TOKENS default 1000
 *   CONCURRENCY      default 10
 *   TOP_N            number of top FP/FN to show        (default: 10)
 *
 *   LANGFUSE_ENABLED  true to enable tracing
 *   LANGFUSE_SECRET_KEY
 *   LANGFUSE_PUBLIC_KEY
 *   LANGFUSE_HOST     default https://cloud.langfuse.com
 */

import { configDotenv } from "dotenv";
configDotenv({ path: ".env.eval" });
import * as fs from "fs";
import * as path from "path";
import { createLLMAdapter } from "../src/llm/index";
import { buildSystemPrompt, buildUserMessage } from "../src/llm/prompt-builder";
import type {
  AutoTaggerSettings,
  LLMProvider,
  LLMResponse,
  NewTagsPolicy,
  RegistryContext,
} from "../src/types";
import { DEFAULT_SYSTEM_PROMPT } from "../src/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SAMPLE_PATH = path.join("tests", "fixtures", "sample.json");
const DATA_PATH = path.join("tests", "fixtures", "data.json");
const GROUND_TRUTH_PATH = path.join("tests", "fixtures", "ground-truth.json");
const TAG_DESCRIPTIONS_PATH = path.join("tests", "fixtures", "tag-descriptions.json");

function requireFile(p: string): void {
  if (!fs.existsSync(p)) {
    console.error(`Missing required file: ${p}`);
    process.exit(1);
  }
}

requireFile(DATA_PATH);
requireFile(GROUND_TRUTH_PATH);

function loadJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

const rawContext: RegistryContext = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
const tagDescriptions: Record<string, string> = loadJson<Record<string, string>>(
  TAG_DESCRIPTIONS_PATH,
  {}
);

// Merge human-authored tag descriptions into the registry context
const context: RegistryContext = {
  ...rawContext,
  tags: rawContext.tags.map((t) => ({
    ...t,
    description: tagDescriptions[t.tag] ?? t.description,
  })),
};

const groundTruth: Record<string, LLMResponse> = JSON.parse(
  fs.readFileSync(GROUND_TRUTH_PATH, "utf-8")
);

// Build list of note paths from sample.json if present, otherwise fall back to ground truth keys
interface SampleFile {
  vaultPath: string;
  notes: { path: string; category: string }[];
}

const vaultPath = fs.existsSync(SAMPLE_PATH)
  ? (loadJson<SampleFile>(SAMPLE_PATH, { vaultPath: "", notes: [] }).vaultPath)
  : process.env.VAULT_PATH ?? "";

if (!vaultPath) {
  console.error("VAULT_PATH not found in sample.json or environment.");
  process.exit(1);
}

const sampleNotes: { path: string; category: string }[] = fs.existsSync(SAMPLE_PATH)
  ? loadJson<SampleFile>(SAMPLE_PATH, { vaultPath: "", notes: [] }).notes
  : Object.keys(groundTruth).map((p) => ({ path: p, category: "unknown" }));

const notePaths = sampleNotes
  .map((n) => n.path)
  .filter((p) => p in groundTruth);

if (notePaths.length === 0) {
  console.error("No labeled notes found. Run the annotation UI first.");
  process.exit(1);
}

// ─── Settings from env ───────────────────────────────────────────────────────

const provider = (process.env.PROVIDER ?? "openai") as LLMProvider;
const apiKey = process.env.API_KEY ?? "";
const settings: AutoTaggerSettings = {
  provider,
  modelName: process.env.MODEL ?? "gpt-4o-mini",
  apiKeys: { [provider]: apiKey } as AutoTaggerSettings["apiKeys"],
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  maxInputTokens: Number(process.env.MAX_INPUT_TOKENS ?? 8000),
  maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS ?? 1000),
  autoTag: {
    enabled: false,
    gracePeriodMinutes: 10,
    checkIntervalMinutes: 5,
    includeFolders: [],
    excludeFolders: [],
  },
  preserveMtime: false,
  newTagsPolicy: (process.env.NEW_TAGS_POLICY ?? "existing-only") as NewTagsPolicy,
  newTagsNamespace: process.env.NEW_TAGS_NS ?? "topic/",
  entityDescriptions: {},
  tagDescriptions: {},
  excludeTagPrefixes: [],
  lastBatchRun: 0,
};

const adapter = createLLMAdapter(settings, apiKey);
const TOP_N = Number(process.env.TOP_N ?? 10);
const langfuseEnabled = process.env.LANGFUSE_ENABLED === "true";

async function main(): Promise<void> {

// ─── Langfuse ─────────────────────────────────────────────────────────────────

let langfuse: import("langfuse").Langfuse | null = null;

if (langfuseEnabled) {
  const { Langfuse } = await import("langfuse");
  langfuse = new Langfuse({
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    baseUrl: process.env.LANGFUSE_HOST ?? "https://cloud.langfuse.com",
  });
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

type Category = "people" | "organizations" | "places" | "tags";
const CATEGORIES: Category[] = ["people", "organizations", "places", "tags"];

function computePRF(
  predicted: string[],
  truth: string[]
): { precision: number; recall: number; f1: number; tp: number; fp: string[]; fn: string[] } {
  const predSet = new Set(predicted.map(normalize));
  const truthSet = new Set(truth.map(normalize));

  if (predSet.size === 0 && truthSet.size === 0) {
    return { precision: 1, recall: 1, f1: 1, tp: 0, fp: [], fn: [] };
  }

  const fp = [...predSet].filter((p) => !truthSet.has(p));
  const fn = [...truthSet].filter((t) => !predSet.has(t));
  const tp = [...predSet].filter((p) => truthSet.has(p)).length;

  const precision = predSet.size > 0 ? tp / predSet.size : 0;
  const recall = truthSet.size > 0 ? tp / truthSet.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { precision, recall, f1, tp, fp, fn };
}

function computeNoteMetrics(
  predicted: LLMResponse,
  truth: LLMResponse
): {
  overall: { precision: number; recall: number; f1: number };
  byCategory: Record<Category, { precision: number; recall: number; f1: number; tp: number; fp: string[]; fn: string[] }>;
} {
  const allPred = [
    ...predicted.people,
    ...predicted.organizations,
    ...predicted.places,
    ...predicted.tags,
    ...predicted.new_tags,
  ];
  const allTruth = [
    ...truth.people,
    ...truth.organizations,
    ...truth.places,
    ...truth.tags,
    ...truth.new_tags,
  ];

  const overall = computePRF(allPred, allTruth);

  const byCategory = {} as Record<Category, ReturnType<typeof computePRF>>;
  for (const cat of CATEGORIES) {
    byCategory[cat] = computePRF(predicted[cat] ?? [], truth[cat] ?? []);
  }

  return { overall, byCategory };
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n - 1) + "…" : s.padEnd(n);
}

const SEP = "─".repeat(74);

// ─── Eval loop ────────────────────────────────────────────────────────────────

const concurrency = Number(process.env.CONCURRENCY ?? 10);

console.log(
  `\nEval — ${settings.provider} / ${settings.modelName} — ${notePaths.length} notes (concurrency: ${concurrency})`
);
if (tagDescriptions && Object.keys(tagDescriptions).length > 0) {
  console.log(`Tag descriptions loaded: ${Object.keys(tagDescriptions).length} tags`);
}
if (langfuseEnabled) console.log("Langfuse tracing enabled");
console.log("");

type NoteResult = {
  notePath: string;
  category: string;
  overall: { precision: number; recall: number; f1: number };
  byCategory: Record<Category, { precision: number; recall: number; f1: number; tp: number; fp: string[]; fn: string[] }>;
  error?: string;
};

const allowNew = settings.newTagsPolicy === "allow-suggestions";

async function tagNote(notePath: string, category: string): Promise<NoteResult> {
  const absPath = path.join(vaultPath, notePath);
  if (!fs.existsSync(absPath)) {
    const error = `File not found: ${absPath}`;
    process.stdout.write(`  ✗ ${notePath}\n`);
    return {
      notePath,
      category,
      overall: { precision: 0, recall: 0, f1: 0 },
      byCategory: Object.fromEntries(
        CATEGORIES.map((c) => [c, { precision: 0, recall: 0, f1: 0, tp: 0, fp: [] as string[], fn: [] as string[] }])
      ) as unknown as Record<Category, ReturnType<typeof computePRF>>,
      error,
    };
  }

  const content = fs.readFileSync(absPath, "utf-8");
  const truth = groundTruth[notePath];

  const systemPrompt = buildSystemPrompt(
    settings.systemPrompt,
    context,
    allowNew,
    settings.newTagsNamespace
  );
  const userMessage = buildUserMessage(content, settings.maxInputTokens, []);

  const trace = langfuse?.trace({
    name: `eval/${path.basename(notePath)}`,
    input: { note: content.slice(0, 500) },
    metadata: { provider: settings.provider, model: settings.modelName, notePath },
  });

  const generation = trace?.generation({
    name: "tag",
    model: settings.modelName,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  });

  let predicted: LLMResponse;
  try {
    predicted = await adapter.tag(content, context, []);
  } catch (err) {
    const error = String(err);
    generation?.end({ output: { error }, level: "ERROR" });
    trace?.update({ output: { error } });
    process.stdout.write(`  ✗ ${notePath}\n`);
    return {
      notePath,
      category,
      overall: { precision: 0, recall: 0, f1: 0 },
      byCategory: Object.fromEntries(
        CATEGORIES.map((c) => [c, { precision: 0, recall: 0, f1: 0, tp: 0, fp: [] as string[], fn: [] as string[] }])
      ) as unknown as Record<Category, ReturnType<typeof computePRF>>,
      error,
    };
  }

  const { overall, byCategory } = computeNoteMetrics(predicted, truth);

  generation?.end({ output: predicted });
  trace?.score({ name: "precision", value: overall.precision });
  trace?.score({ name: "recall", value: overall.recall });
  trace?.score({ name: "f1", value: overall.f1 });
  trace?.update({ output: predicted });

  process.stdout.write(`  ✓ ${notePath}\n`);
  return { notePath, category, overall, byCategory };
}

// Run with bounded concurrency
const queue = sampleNotes.filter((n) => n.path in groundTruth);
const active: Promise<NoteResult>[] = [];
const settled: NoteResult[] = [];

while (queue.length > 0 || active.length > 0) {
  while (active.length < concurrency && queue.length > 0) {
    const { path: notePath, category } = queue.shift()!;
    const p = tagNote(notePath, category).then((r) => {
      active.splice(active.indexOf(p), 1);
      settled.push(r);
      return r;
    });
    active.push(p);
  }
  if (active.length > 0) await Promise.race(active);
}

// Restore original order
const resultMap = new Map(settled.map((r) => [r.notePath, r]));
const results = notePaths.map((p) => resultMap.get(p)!);
const successful = results.filter((r) => !r.error);

// ─── Per-note table ───────────────────────────────────────────────────────────

console.log("\n" + SEP);
console.log(`${"Note".padEnd(42)}  ${"P".padStart(4)}  ${"R".padStart(4)}  ${"F1".padStart(4)}`);
console.log(SEP);

for (const r of results) {
  const name = pad(path.basename(r.notePath).replace(/\.md$/, ""), 42);
  if (r.error) {
    console.log(`${name}  ERROR: ${r.error.slice(0, 30)}`);
  } else {
    console.log(
      `${name}  ${pct(r.overall.precision).padStart(4)}  ${pct(r.overall.recall).padStart(4)}  ${pct(r.overall.f1).padStart(4)}`
    );
  }
}

// ─── Aggregate ────────────────────────────────────────────────────────────────

function avg(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, x) => s + x, 0) / arr.length : 0;
}

const aggOverall = {
  precision: avg(successful.map((r) => r.overall.precision)),
  recall: avg(successful.map((r) => r.overall.recall)),
  f1: avg(successful.map((r) => r.overall.f1)),
};

console.log(SEP);
console.log(
  `${"AGGREGATE".padEnd(42)}  ${pct(aggOverall.precision).padStart(4)}  ${pct(aggOverall.recall).padStart(4)}  ${pct(aggOverall.f1).padStart(4)}`
);
console.log(`(${successful.length} successful, ${results.length - successful.length} errors)`);

// ─── Per-category breakdown ───────────────────────────────────────────────────

console.log("\n" + SEP);
console.log("PER-CATEGORY BREAKDOWN");
console.log(SEP);
console.log(`${"Category".padEnd(18)}  ${"P".padStart(4)}  ${"R".padStart(4)}  ${"F1".padStart(4)}  ${"Support".padStart(7)}`);
console.log(SEP);

for (const cat of CATEGORIES) {
  const withSupport = successful.filter((r) => {
    const truth = groundTruth[r.notePath];
    return (truth[cat]?.length ?? 0) > 0;
  });
  const support = withSupport.reduce((s, r) => s + (groundTruth[r.notePath][cat]?.length ?? 0), 0);
  const p = avg(withSupport.map((r) => r.byCategory[cat].precision));
  const rec = avg(withSupport.map((r) => r.byCategory[cat].recall));
  const f = avg(withSupport.map((r) => r.byCategory[cat].f1));
  console.log(
    `${cat.padEnd(18)}  ${pct(p).padStart(4)}  ${pct(rec).padStart(4)}  ${pct(f).padStart(4)}  ${String(support).padStart(7)}`
  );
}

// ─── Per-tag F1 ───────────────────────────────────────────────────────────────

// Collect all ground-truth tags, count support, compute F1 per tag
const tagSupport: Record<string, number> = {};
const tagTP: Record<string, number> = {};
const tagFP: Record<string, number> = {};
const tagFN: Record<string, number> = {};

for (const r of successful) {
  const truth = groundTruth[r.notePath];
  const allTrueTags = [...(truth.tags ?? []), ...(truth.new_tags ?? [])].map(normalize);
  for (const tag of allTrueTags) {
    tagSupport[tag] = (tagSupport[tag] ?? 0) + 1;
  }
  const catResult = r.byCategory.tags;
  for (const fp of catResult.fp) {
    tagFP[fp] = (tagFP[fp] ?? 0) + 1;
  }
  for (const fn of catResult.fn) {
    tagFN[fn] = (tagFN[fn] ?? 0) + 1;
  }
  // TP: a tag is a true positive if it appears in truth but NOT in fn
  const fnSet = new Set(catResult.fn.map((t) => normalize(t)));
  for (const tag of allTrueTags) {
    if (!fnSet.has(normalize(tag))) {
      tagTP[tag] = (tagTP[tag] ?? 0) + 1;
    }
  }
}

// Compute per-tag F1
const tagStats = Object.entries(tagSupport)
  .map(([tag, support]) => {
    const tp = tagTP[tag] ?? 0;
    const fp = tagFP[tag] ?? 0;
    const fn = tagFN[tag] ?? 0;
    const p = tp + fp > 0 ? tp / (tp + fp) : 0;
    const r = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = p + r > 0 ? (2 * p * r) / (p + r) : 0;
    return { tag, support, f1, p, r };
  })
  .sort((a, b) => b.support - a.support || b.f1 - a.f1);

if (tagStats.length > 0) {
  console.log("\n" + SEP);
  console.log("PER-TAG F1  (sorted by support)");
  console.log(SEP);
  console.log(`${"Tag".padEnd(36)}  ${"F1".padStart(4)}  ${"P".padStart(4)}  ${"R".padStart(4)}  ${"N".padStart(3)}`);
  console.log(SEP);
  for (const { tag, support, f1, p, r } of tagStats) {
    const lowSupport = support < 3 ? " !" : "  ";
    console.log(
      `${pad(tag, 36)}  ${pct(f1).padStart(4)}  ${pct(p).padStart(4)}  ${pct(r).padStart(4)}  ${String(support).padStart(3)}${lowSupport}`
    );
  }
  if (tagStats.some((t) => t.support < 3)) {
    console.log(`  ! low support (<3), F1 unreliable`);
  }
}

// ─── Top FP / FN ──────────────────────────────────────────────────────────────

// Aggregate false positives and false negatives across all notes and categories
const globalFP: Record<string, number> = {};
const globalFN: Record<string, number> = {};

for (const r of successful) {
  for (const cat of CATEGORIES) {
    for (const fp of r.byCategory[cat].fp) {
      const key = `[${cat.slice(0, 3)}] ${fp}`;
      globalFP[key] = (globalFP[key] ?? 0) + 1;
    }
    for (const fn of r.byCategory[cat].fn) {
      const key = `[${cat.slice(0, 3)}] ${fn}`;
      globalFN[key] = (globalFN[key] ?? 0) + 1;
    }
  }
}

function topN(counter: Record<string, number>, n: number): [string, number][] {
  return Object.entries(counter)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n);
}

console.log("\n" + SEP);
console.log(`TOP ${TOP_N} FALSE POSITIVES  (predicted, not in truth)`);
console.log(SEP);
for (const [label, count] of topN(globalFP, TOP_N)) {
  console.log(`  ${String(count).padStart(3)}×  ${label}`);
}

console.log("\n" + SEP);
console.log(`TOP ${TOP_N} FALSE NEGATIVES  (in truth, not predicted)`);
console.log(SEP);
for (const [label, count] of topN(globalFN, TOP_N)) {
  console.log(`  ${String(count).padStart(3)}×  ${label}`);
}

// ─── Worst notes ─────────────────────────────────────────────────────────────

const worstN = Math.min(5, successful.length);
const worst = [...successful].sort((a, b) => a.overall.f1 - b.overall.f1).slice(0, worstN);

console.log("\n" + SEP);
console.log(`WORST ${worstN} NOTES BY F1`);
console.log(SEP);
for (const r of worst) {
  console.log(
    `  ${pct(r.overall.f1).padStart(4)}  ${path.basename(r.notePath).replace(/\.md$/, "")}`
  );
}

console.log("\n" + SEP + "\n");

if (langfuse) {
  await langfuse.flushAsync();
}

} // end main
main().catch((err) => { console.error(err); process.exit(1); });
