import type { App } from "obsidian";
import type { TagEntry } from "../types";

export class TagRegistry {
  private entries: TagEntry[] = [];

  rebuild(app: App, descriptions: Record<string, string>): void {
    const cache = app.metadataCache as unknown as { getTags(): Record<string, number> };
    const tagCounts: Record<string, number> = typeof cache.getTags === "function"
      ? cache.getTags()
      : {};
    this.entries = Object.entries(tagCounts).map(([rawTag, count]) => {
      const tag = rawTag.startsWith("#") ? rawTag.slice(1) : rawTag;
      return {
        tag,
        count,
        description: descriptions[tag] ?? "",
      };
    });
    this.entries.sort((a, b) => b.count - a.count);
  }

  getEntries(): TagEntry[] {
    return this.entries;
  }
}
