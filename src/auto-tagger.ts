import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import type { AutoTaggerSettings } from "./types";
import type { EntityRegistry } from "./registry/entity-registry";
import type { TagRegistry } from "./registry/tag-registry";
import type { Ambiguity, DetectedEntity } from "./llm/types";
import { createLLMAdapter } from "./llm";
import { mergeFrontmatter, splitFrontmatter } from "./frontmatter";
import { withPreservedMtime } from "./mtime";
import { scanBody } from "./entity-scanner";
import { injectWikilinks, resolvedEntitiesToSpanMatches } from "./wikilink-injector";
import { resolveAndAssembleEntities } from "./commands/entity-pipeline";

export class AutoTagger {
  private pendingTimers = new Map<string, number>();
  private sweepInterval: number | null = null;

  constructor(
    private app: App,
    private getSettings: () => AutoTaggerSettings,
    private entityRegistry: EntityRegistry,
    private tagRegistry: TagRegistry,
    private getTagCache: () => Record<string, number>,
    private onTagged: (path: string, timestamp: number) => Promise<void>,
    private getApiKey: () => string
  ) {}

  start(): void {
    this.app.vault.on("modify", this.onModify);
    this.startSweepInterval();
  }

  stop(): void {
    this.app.vault.off("modify", this.onModify);
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    if (this.sweepInterval !== null) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }

  private onModify = (abstractFile: TAbstractFile): void => {
    const settings = this.getSettings();
    if (!settings.autoTag.enabled) return;
    if (!(abstractFile instanceof TFile)) return;
    if (abstractFile.extension !== "md") return;
    if (!this.isInScope(abstractFile, settings)) return;

    const gracePeriodMs = settings.autoTag.gracePeriodMinutes * 60 * 1000;

    const existing = this.pendingTimers.get(abstractFile.path);
    if (existing) clearTimeout(existing);

    const timer = window.setTimeout(() => {
      this.tagFile(abstractFile).catch((err) =>
        console.error("AutoTagger: error tagging file:", err)
      );
      this.pendingTimers.delete(abstractFile.path);
    }, gracePeriodMs);

    this.pendingTimers.set(abstractFile.path, timer);
  };

  private startSweepInterval(): void {
    const settings = this.getSettings();
    if (!settings.autoTag.enabled) return;

    const intervalMs = settings.autoTag.checkIntervalMinutes * 60 * 1000;
    this.sweepInterval = window.setInterval(() => {
      // Heartbeat for future polling-based enhancements.
    }, intervalMs);
  }

  private isInScope(file: TFile, settings: AutoTaggerSettings): boolean {
    const { includeFolders, excludeFolders } = settings.autoTag;
    if (excludeFolders.some((f) => file.path.startsWith(f + "/"))) return false;
    if (
      includeFolders.length > 0 &&
      !includeFolders.some((f) => file.path.startsWith(f + "/"))
    )
      return false;
    if (this.hasExcludedTag(file, settings)) return false;
    return true;
  }

  private hasExcludedTag(file: TFile, settings: AutoTaggerSettings): boolean {
    const { excludeTagPrefixes } = settings;
    if (!excludeTagPrefixes || excludeTagPrefixes.length === 0) return false;
    const cache = this.app.metadataCache.getFileCache(file);
    const tags: string[] = cache?.frontmatter?.tags ?? [];
    return tags.some((tag) =>
      excludeTagPrefixes.some((prefix) => tag.startsWith(prefix))
    );
  }

  async tagFile(file: TFile): Promise<void> {
    const tagCache = this.getTagCache();
    const lastTagged = tagCache[file.path] ?? 0;
    if (lastTagged >= file.stat.mtime) return;

    const settings = this.getSettings();
    const fullContent = await this.app.vault.read(file);
    const { body } = splitFrontmatter(fullContent);

    const fileCache = this.app.metadataCache.getFileCache(file);
    const existingTags: string[] = fileCache?.frontmatter?.tags ?? [];
    const excludePrefixes = settings.excludeTagPrefixes ?? [];

    // 1. Rule-based entity scan over the body
    const entries = this.entityRegistry.getEntries();
    const scan = scanBody(body, entries, settings.entityAliasStrictCaseMinLength);

    const detectedEntities: DetectedEntity[] = scan.unambiguous.map((m) => ({
      canonical: m.candidates[0].canonicalName,
      type: m.candidates[0].type,
    }));

    const ambiguities: Ambiguity[] = scan.ambiguous.map((m) => ({
      surface: m.surface,
      contextSnippet: body.slice(
        Math.max(0, m.spanStart - 60),
        Math.min(body.length, m.spanEnd + 60)
      ),
      options: m.candidates.map((c) => ({
        canonical: c.canonicalName,
        type: c.type,
        description: c.description,
      })),
    }));

    // 2. LLM call (no full entity dump — just tags + disambiguation)
    const tags = this.tagRegistry
      .getEntries()
      .filter((t) => !excludePrefixes.some((p) => t.tag.startsWith(p)));
    const allowNewTags = settings.newTagsPolicy === "allow-suggestions";

    const adapter = createLLMAdapter(settings, this.getApiKey());
    const llmResponse = await adapter.tag({
      body,
      title: file.basename,
      existingTags,
      detectedEntities,
      ambiguities,
      tags,
      allowNewTags,
      newTagsNamespace: settings.newTagsNamespace,
    });

    // 3. Resolve all entities into a unified list
    const resolved = resolveAndAssembleEntities(scan, llmResponse, this.entityRegistry, body);

    // 4. Write frontmatter + body wikilinks in one mtime-preserved block
    await withPreservedMtime(this.app, file, settings.preserveMtime, async () => {
      await mergeFrontmatter(this.app, file, llmResponse, resolved, allowNewTags);

      const spanMatches = resolvedEntitiesToSpanMatches(resolved);
      if (spanMatches.length > 0) {
        // Read fresh after processFrontMatter modified the file
        const updated = await this.app.vault.read(file);
        const { header, body: currentBody } = splitFrontmatter(updated);
        const newBody = injectWikilinks(currentBody, spanMatches);
        if (newBody !== currentBody) {
          await this.app.vault.modify(file, header + newBody);
        }
      }
    });

    await this.onTagged(file.path, Date.now());
  }

}
