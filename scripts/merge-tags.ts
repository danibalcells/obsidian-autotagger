/**
 * Merge tags in the plugin's tag descriptions and ground-truth.json.
 *
 * Usage (edit MERGES below, then):
 *   npm run merge-tags
 *
 * Each merge spec:
 *   from:        tags to merge away (will be deleted)
 *   to:          target tag name (created or kept)
 *   description: new description (if omitted, keeps existing `to` description or concatenates `from` descriptions)
 */

import * as fs from "fs";
import * as path from "path";
import type { LLMResponse } from "../src/types";
import { loadTagDescriptions, saveTagDescriptions } from "./plugin-data";

const GROUND_TRUTH_PATH = path.join("tests", "fixtures", "ground-truth.json");

interface MergeSpec {
  from: string[];
  to: string;
  description?: string;
}

// ─── Edit merge specs here ───────────────────────────────────────────────────
const MERGES: MergeSpec[] = [
  {
    from: ["social/authority", "social/power"],
    to: "social/authority-power",
    // description omitted → auto-combine from both
  },
  {
    from: ["social/debate-argument"],
    to: "social/debate-discourse",
    // description omitted → keep existing social/debate-discourse description
  },
];
// ─────────────────────────────────────────────────────────────────────────────

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

function combineDescriptions(descs: string[]): string {
  const unique = [...new Set(descs.filter(Boolean))];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  // Join with "; " — simple and readable
  return unique.join("; ");
}

const descs = loadTagDescriptions();
const groundTruth = loadJson<Record<string, LLMResponse>>(GROUND_TRUTH_PATH, {});

for (const { from, to, description } of MERGES) {
  console.log(`\nMerge: [${from.join(", ")}] → ${to}`);

  // Determine final description
  let finalDesc = description;
  if (!finalDesc) {
    const existing = descs[to];
    const fromDescs = from.map((t) => descs[t]).filter(Boolean);
    if (existing) {
      finalDesc = existing; // keep target description as-is
      console.log(`  keeping existing description for ${to}: "${finalDesc}"`);
    } else {
      finalDesc = combineDescriptions(fromDescs);
      console.log(`  combined description: "${finalDesc}"`);
    }
  }

  // Update tag-descriptions.json
  descs[to] = finalDesc;
  for (const tag of from) {
    if (tag !== to) {
      delete descs[tag];
      console.log(`  deleted description for ${tag}`);
    }
  }

  // Update ground-truth.json
  let notesUpdated = 0;
  for (const [notePath, annotation] of Object.entries(groundTruth)) {
    const allTags = new Set([...(annotation.tags ?? []), ...(annotation.new_tags ?? [])]);
    const hasFrom = from.some((t) => allTags.has(t));
    if (!hasFrom) continue;

    // Replace all `from` tags with `to`, deduplicating
    const replaceTags = (arr: string[]): string[] => {
      const replaced = arr.map((t) => (from.includes(t) ? to : t));
      return [...new Set(replaced)];
    };

    groundTruth[notePath] = {
      ...annotation,
      tags: replaceTags(annotation.tags ?? []),
      new_tags: replaceTags(annotation.new_tags ?? []),
    };
    notesUpdated++;
    console.log(`  updated ${notePath}`);
  }
  console.log(`  ${notesUpdated} ground-truth note(s) updated`);
}

saveTagDescriptions(descs);
saveJson(GROUND_TRUTH_PATH, groundTruth);
console.log("\nSaved tag descriptions to plugin data.json and ground-truth.json.");
