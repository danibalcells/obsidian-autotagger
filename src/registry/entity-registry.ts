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
          (f) => f.path.startsWith(folder + "/") && f.extension === "md"
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
    const rawAliases = frontmatter["aliases"] ?? frontmatter["alias"];
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
}
