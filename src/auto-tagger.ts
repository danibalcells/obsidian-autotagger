import { TFile } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import type { AutoTaggerSettings } from "./types";
import type { EntityRegistry } from "./registry/entity-registry";
import type { TagRegistry } from "./registry/tag-registry";
import { createLLMAdapter } from "./llm";
import { mergeFrontmatter } from "./frontmatter";
import { withPreservedMtime } from "./mtime";

export class AutoTagger {
  private pendingTimers = new Map<string, number>();
  private sweepInterval: number | null = null;

  constructor(
    private app: App,
    private getSettings: () => AutoTaggerSettings,
    private entityRegistry: EntityRegistry,
    private tagRegistry: TagRegistry,
    private getTagCache: () => Record<string, number>,
    private onTagged: (path: string, timestamp: number) => Promise<void>
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
      // Debounce timers handle tagging; this interval is a heartbeat
      // for future polling-based enhancements (e.g., files modified before load).
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
    return true;
  }

  async tagFile(file: TFile): Promise<void> {
    // Skip if already tagged after the file's last modification
    const tagCache = this.getTagCache();
    const lastTagged = tagCache[file.path] ?? 0;
    if (lastTagged >= file.stat.mtime) return;

    const settings = this.getSettings();
    const context = {
      entities: this.entityRegistry.getEntries(),
      tags: this.tagRegistry.getEntries(),
    };

    const adapter = createLLMAdapter(settings);
    const content = await this.app.vault.read(file);
    const response = await adapter.tag(content, context);
    const allowNewTags = settings.newTagsPolicy === "allow-suggestions";

    await withPreservedMtime(this.app, file, settings.preserveMtime, async () => {
      await mergeFrontmatter(
        this.app,
        file,
        response,
        this.entityRegistry,
        allowNewTags
      );
    });

    await this.onTagged(file.path, Date.now());
  }
}
