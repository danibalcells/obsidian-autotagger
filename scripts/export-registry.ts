/**
 * Exports the current vault registry (entities + tags) to tests/fixtures/data.json.
 *
 * Usage:
 *   VAULT_PATH=/path/to/vault TSCONFIG_PATH=tsconfig.eval.json npx tsx scripts/export-registry.ts
 */

import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import type { EntityEntry, TagEntry, RegistryContext } from "../src/types";

const vaultPath = process.env.VAULT_PATH;
if (!vaultPath) {
  console.error("Error: VAULT_PATH environment variable is required.");
  process.exit(1);
}

const ENTITY_FOLDERS: { folder: string; type: EntityEntry["type"] }[] = [
  { folder: "Resources/People", type: "person" },
  { folder: "Resources/Organizations", type: "organization" },
  { folder: "Resources/Places", type: "place" },
];

function readMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(dir, f));
}

function collectAllMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectAllMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function buildEntities(): EntityEntry[] {
  const entities: EntityEntry[] = [];
  for (const { folder, type } of ENTITY_FOLDERS) {
    const dir = path.join(vaultPath!, folder);
    for (const filePath of readMarkdownFiles(dir)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const { data: frontmatter } = matter(content);
      const canonicalName = path.basename(filePath, ".md");

      const aliases: string[] = [];
      const rawAliases = frontmatter["aliases"] ?? frontmatter["alias"];
      if (Array.isArray(rawAliases)) {
        aliases.push(
          ...rawAliases.filter((a: unknown): a is string => typeof a === "string")
        );
      } else if (typeof rawAliases === "string" && rawAliases) {
        aliases.push(rawAliases);
      }

      const description: string =
        typeof frontmatter["description"] === "string"
          ? frontmatter["description"]
          : "";

      entities.push({
        canonicalName,
        aliases,
        type,
        description,
        filePath: path.relative(vaultPath!, filePath),
      });
    }
  }
  return entities;
}

function buildTags(): TagEntry[] {
  const tagCounts: Record<string, number> = {};
  const allFiles = collectAllMarkdownFiles(vaultPath!);

  for (const filePath of allFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const { data: frontmatter } = matter(content);
      const rawTags = frontmatter["tags"];
      const tags: string[] = Array.isArray(rawTags)
        ? rawTags.filter((t: unknown): t is string => typeof t === "string")
        : typeof rawTags === "string" && rawTags
        ? [rawTags]
        : [];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
      }
    } catch {
      // skip unreadable files
    }
  }

  return Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, description: "", count }))
    .sort((a, b) => b.count - a.count);
}

const outPath = path.join("tests", "fixtures", "data.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });

console.log("Building entity registry...");
const entities = buildEntities();
console.log(`  ${entities.length} entities (people, organizations, places)`);

console.log("Building tag registry...");
const tags = buildTags();
console.log(`  ${tags.length} unique tags`);

const context: RegistryContext = { entities, tags };
fs.writeFileSync(outPath, JSON.stringify(context, null, 2));
console.log(`\nWrote ${outPath}`);
