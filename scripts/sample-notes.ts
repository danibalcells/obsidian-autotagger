/**
 * Samples notes from the vault into tests/fixtures/sample.json.
 *
 * Usage:
 *   VAULT_PATH=/path/to/vault npm run sample
 *   VAULT_PATH=/path/to/vault npm run sample -- --force   # regenerate even if sample.json exists
 *
 * Edit scripts/sample-config.json to configure folders and counts.
 * The output sample.json is meant to be tweaked by hand before annotating.
 */

import * as fs from "fs";
import * as path from "path";
import { configDotenv } from "dotenv";
configDotenv({ path: ".env.eval" });

const vaultPath = process.env.VAULT_PATH;
if (!vaultPath) {
  console.error("Error: VAULT_PATH environment variable is required.");
  process.exit(1);
}

const SAMPLE_CONFIG_PATH = path.join("scripts", "sample-config.json");
const SAMPLE_OUTPUT_PATH = path.join("tests", "fixtures", "sample.json");
const FORCE = process.argv.includes("--force");

interface CategoryConfig {
  category: string;
  folder: string;
  count: number;
  recursive: boolean;
}

interface SampleConfig {
  categories: CategoryConfig[];
}

interface SampleEntry {
  path: string;
  category: string;
}

interface SampleFile {
  generatedAt: string;
  vaultPath: string;
  notes: SampleEntry[];
}

function listMarkdownFiles(dir: string, recursive: boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      result.push(...listMarkdownFiles(full, true));
    } else if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith(".")) {
      result.push(full);
    }
  }
  return result;
}

function sample<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

if (fs.existsSync(SAMPLE_OUTPUT_PATH) && !FORCE) {
  console.log(`sample.json already exists. Pass --force to regenerate.`);
  console.log(`Current sample: ${SAMPLE_OUTPUT_PATH}`);
  process.exit(0);
}

const config: SampleConfig = JSON.parse(fs.readFileSync(SAMPLE_CONFIG_PATH, "utf-8"));
const notes: SampleEntry[] = [];
const seenPaths = new Set<string>();

for (const cat of config.categories) {
  const dir = path.join(vaultPath, cat.folder);
  const files = listMarkdownFiles(dir, cat.recursive).filter((f) => !seenPaths.has(f));

  if (files.length === 0) {
    console.warn(`  [warn] No files found in ${cat.folder}`);
    continue;
  }

  const picked = sample(files, cat.count);
  for (const f of picked) {
    seenPaths.add(f);
    notes.push({
      path: path.relative(vaultPath, f),
      category: cat.category,
    });
  }

  console.log(`  ${cat.category.padEnd(14)} ${cat.folder.padEnd(40)} ${picked.length}/${cat.count} picked (${files.length} available)`);
}

console.log(`\nTotal: ${notes.length} notes sampled`);

const output: SampleFile = {
  generatedAt: new Date().toISOString(),
  vaultPath,
  notes,
};

fs.mkdirSync(path.dirname(SAMPLE_OUTPUT_PATH), { recursive: true });
fs.writeFileSync(SAMPLE_OUTPUT_PATH, JSON.stringify(output, null, 2));
console.log(`\nWrote ${SAMPLE_OUTPUT_PATH}`);
console.log(`Edit it by hand if needed, then run: npm run annotate`);
