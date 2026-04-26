/**
 * Infer descriptions for tags that have no vault notes (or were skipped by generate-tags)
 * by using the existing tag taxonomy as context.
 *
 * Sends batches of undescribed tags to the LLM alongside the full taxonomy,
 * asking it to infer meaning from namespace, siblings, and parent patterns.
 *
 * Usage:
 *   npm run infer-tags                   # infer all undescribed tags
 *   npm run infer-tags -- --dry-run      # preview without calling the API
 *   npm run infer-tags -- --batch-size=30
 */

import { configDotenv } from "dotenv";
configDotenv({ path: ".env.eval" });

import * as fs from "fs";
import * as path from "path";
import { loadTagDescriptions, saveTagDescriptions } from "./plugin-data";

const DATA_PATH = path.join("tests", "fixtures", "data.json");
const API_KEY = process.env.API_KEY ?? "";
const MODEL = process.env.MODEL ?? "claude-sonnet-4-6";
const EXCLUDE_PREFIXES = ["type/", "readwise"];

const DRY_RUN = process.argv.includes("--dry-run");
const THINKING_BUDGET = 3000;

interface TagEntry {
  tag: string;
  description: string;
  count: number;
}

function loadJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function buildTaxonomyContext(descs: Record<string, string>): string {
  // Group by top-level namespace prefix
  const byPrefix: Record<string, Array<{ tag: string; desc: string }>> = {};

  for (const [tag, desc] of Object.entries(descs)) {
    if (!desc.trim()) continue;
    const prefix = tag.includes("/") ? tag.split("/")[0] : "__root__";
    if (!byPrefix[prefix]) byPrefix[prefix] = [];
    byPrefix[prefix].push({ tag, desc });
  }

  const lines: string[] = [];
  for (const prefix of Object.keys(byPrefix).sort()) {
    const displayPrefix = prefix === "__root__" ? "(no namespace)" : `${prefix}/`;
    lines.push(`${displayPrefix}`);
    for (const { tag, desc } of byPrefix[prefix].sort((a, b) => a.tag.localeCompare(b.tag))) {
      lines.push(`  ${tag} — ${desc}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function inferOne(tag: string, taxonomyContext: string): Promise<string> {
  const userMessage =
    `You are helping build a personal knowledge base tag taxonomy.\n\n` +
    `Here is the current taxonomy with descriptions, grouped by namespace:\n\n` +
    taxonomyContext +
    `Based on this taxonomy, infer a concise one-line description (≤ 120 characters) for this tag:\n\n` +
    `Tag: ${tag}\n\n` +
    `Use the namespace prefix and sibling tags to infer meaning — ` +
    `e.g. tags under social/ are about social dynamics, inner/ about inner states, abstract/ about conceptual themes, etc.\n\n` +
    `Reply with ONLY the description text. No quotes, no explanation.`;

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
      max_tokens: THINKING_BUDGET + 256,
      thinking: { type: "enabled", budget_tokens: THINKING_BUDGET },
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 400) {
      console.warn(" (no thinking, retrying)");
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 256,
          messages: [{ role: "user", content: userMessage }],
        }),
      });
      if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`);
    } else {
      throw new Error(`API error ${response.status}: ${errText}`);
    }
  }

  const json = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return json.content?.find((b) => b.type === "text")?.text?.trim() ?? "";
}

async function main(): Promise<void> {
  if (!API_KEY && !DRY_RUN) {
    console.error("API_KEY not set in .env.eval");
    process.exit(1);
  }

  const data = loadJson<{ tags: TagEntry[] }>(DATA_PATH, { tags: [] });
  const descs = loadTagDescriptions();

  const allRegistryTags = new Set(data.tags.map((t) => t.tag));

  // Tags to infer: in registry, no description, not excluded
  const toInfer = [...allRegistryTags].filter(
    (tag) => !descs[tag] && !EXCLUDE_PREFIXES.some((p) => tag.startsWith(p))
  );

  const alreadyDescribed = [...allRegistryTags].filter((t) => descs[t]).length;
  const excluded = [...allRegistryTags].filter((t) =>
    EXCLUDE_PREFIXES.some((p) => t.startsWith(p))
  ).length;

  console.log(`Registry tags    : ${allRegistryTags.size}`);
  console.log(`Already described: ${alreadyDescribed}`);
  console.log(`Excluded prefixes: ${excluded}  [${EXCLUDE_PREFIXES.join(", ")}]`);
  console.log(`To infer         : ${toInfer.length}`);

  if (toInfer.length === 0) {
    console.log("\nNothing to infer.");
    return;
  }

  if (DRY_RUN) {
    console.log("\n[dry-run] Would infer:");
    toInfer.slice(0, 15).forEach((t) => console.log(`  ${t}`));
    if (toInfer.length > 15) console.log(`  … and ${toInfer.length - 15} more`);
    return;
  }

  const taxonomyContext = buildTaxonomyContext(descs);
  const width = String(toInfer.length).length;
  console.log(`\nThinking budget: ${THINKING_BUDGET} tokens\n`);

  let totalAdded = 0;
  let totalFailed = 0;

  for (let i = 0; i < toInfer.length; i++) {
    const tag = toInfer[i];
    process.stdout.write(`[${String(i + 1).padStart(width)}/${toInfer.length}] ${tag}… `);
    const t0 = Date.now();

    try {
      // Skip if already written (e.g. by the UI) since we started
      const current = loadTagDescriptions();
      if (current[tag]) {
        console.log("skipped (already set)");
        continue;
      }

      const description = await inferOne(tag, taxonomyContext);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      current[tag] = description;
      saveTagDescriptions(current);
      totalAdded++;

      console.log(`${elapsed}s → "${description}"`);
    } catch (err) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`FAILED (${elapsed}s): ${String(err).slice(0, 100)}`);
      totalFailed++;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log(`\nDone — ${totalAdded} inferred, ${totalFailed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
