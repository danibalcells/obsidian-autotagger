/**
 * Derives tag-examples.json from ground-truth.json.
 *
 * Output: tests/fixtures/tag-examples.json
 *   { tagName: [notePath, notePath, ...] }
 *
 * Usage:
 *   npm run derive-examples
 */

import * as fs from "fs";
import * as path from "path";
import type { LLMResponse } from "../src/types";

const GROUND_TRUTH_PATH = path.join("tests", "fixtures", "ground-truth.json");
const TAG_EXAMPLES_PATH = path.join("tests", "fixtures", "tag-examples.json");

if (!fs.existsSync(GROUND_TRUTH_PATH)) {
  console.error(`Missing ${GROUND_TRUTH_PATH}. Run the annotation UI first.`);
  process.exit(1);
}

const groundTruth: Record<string, LLMResponse> = JSON.parse(
  fs.readFileSync(GROUND_TRUTH_PATH, "utf-8")
);

const examples: Record<string, string[]> = {};

for (const [notePath, annotation] of Object.entries(groundTruth)) {
  const allTags = [...annotation.tags, ...annotation.new_tags];
  for (const tag of allTags) {
    if (!examples[tag]) examples[tag] = [];
    examples[tag].push(notePath);
  }
}

// Sort tags alphabetically, paths within each tag by notePath
const sorted: Record<string, string[]> = {};
for (const tag of Object.keys(examples).sort()) {
  sorted[tag] = examples[tag].sort();
}

fs.mkdirSync(path.dirname(TAG_EXAMPLES_PATH), { recursive: true });
fs.writeFileSync(TAG_EXAMPLES_PATH, JSON.stringify(sorted, null, 2));

const tagCount = Object.keys(sorted).length;
const noteCount = Object.keys(groundTruth).length;
console.log(`Derived ${tagCount} tags from ${noteCount} annotated notes.`);
console.log(`Wrote ${TAG_EXAMPLES_PATH}`);
