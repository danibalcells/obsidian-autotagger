import type { App, TFile } from "obsidian";
import type { EntityEntry } from "../types";

const ENTITY_FOLDERS: { folder: string; type: EntityEntry["type"] }[] = [
  { folder: "Resources/People", type: "person" },
  { folder: "Resources/Organizations", type: "organization" },
  { folder: "Resources/Places", type: "place" },
];

export function resolveCanonicalName(
  entries: EntityEntry[],
  name: string
): string | null {
  const lower = name.toLowerCase();
  for (const entry of entries) {
    if (entry.canonicalName.toLowerCase() === lower) return entry.canonicalName;
    if (entry.aliases.some((a) => a.toLowerCase() === lower))
      return entry.canonicalName;
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/** Returns a similarity score in [0, 1]. 1 = identical. */
export function stringSimilarity(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return 1;
  const maxLen = Math.max(al.length, bl.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(al, bl) / maxLen;
}

export class EntityRegistry {
  private entries: EntityEntry[] = [];

  async rebuild(
    app: App,
    descriptionOverrides: Record<string, string>
  ): Promise<void> {
    this.entries = [];
    for (const { folder, type } of ENTITY_FOLDERS) {
      const files = app.vault
        .getFiles()
        .filter(
          (f: TFile) => f.path.startsWith(folder + "/") && f.extension === "md"
        );
      for (const file of files) {
        const entry = this.parseEntityFile(app, file, type, descriptionOverrides);
        if (entry) this.entries.push(entry);
      }
    }
  }

  private parseEntityFile(
    app: App,
    file: TFile,
    type: EntityEntry["type"],
    descriptionOverrides: Record<string, string>
  ): EntityEntry | null {
    const cache = app.metadataCache.getFileCache(file);
    const canonicalName = file.basename;
    const frontmatter = cache?.frontmatter ?? {};

    const aliases: string[] = [];
    const rawAliases =
      frontmatter["aliases"] ?? frontmatter["Aliases"] ??
      frontmatter["alias"]   ?? frontmatter["Alias"];
    if (Array.isArray(rawAliases)) {
      aliases.push(
        ...rawAliases.filter((a: unknown): a is string => typeof a === "string")
      );
    } else if (typeof rawAliases === "string" && rawAliases) {
      aliases.push(rawAliases);
    }

    const description: string =
      descriptionOverrides[canonicalName] ??
      (typeof frontmatter["description"] === "string"
        ? frontmatter["description"]
        : "");

    return { canonicalName, aliases, type, description, filePath: file.path };
  }

  getEntries(): EntityEntry[] {
    return this.entries;
  }

  resolveCanonicalName(name: string): string | null {
    return resolveCanonicalName(this.entries, name);
  }

  /**
   * Fuzzy-matches `name` against all canonical names and aliases.
   * Returns the best-matching entry when similarity ≥ minSimilarity, or null.
   */
  fuzzyMatch(name: string, minSimilarity = 0.92): EntityEntry | null {
    let best: EntityEntry | null = null;
    let bestScore = -1;
    for (const entry of this.entries) {
      const terms = [entry.canonicalName, ...entry.aliases];
      for (const term of terms) {
        const score = stringSimilarity(name, term);
        if (score > bestScore) {
          bestScore = score;
          best = entry;
        }
      }
    }
    return bestScore >= minSimilarity ? best : null;
  }
}
