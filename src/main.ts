import { Notice, Plugin } from "obsidian";
import type { AutoTaggerSettings, BatchScope, PluginData } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { EntityRegistry } from "./registry/entity-registry";
import { TagRegistry } from "./registry/tag-registry";
import { AutoTaggerSettingsTab } from "./settings/settings-tab";
import { tagCurrentNote } from "./commands/tag-current-note";
import { batchTag } from "./commands/batch-tag";
import { AutoTagger } from "./auto-tagger";

export default class AutoTaggerPlugin extends Plugin {
  settings!: AutoTaggerSettings;
  tagCache: Record<string, number> = {};
  entityRegistry!: EntityRegistry;
  tagRegistry!: TagRegistry;
  private autoTagger!: AutoTagger;

  async onload(): Promise<void> {
    await this.loadData_();

    this.entityRegistry = new EntityRegistry();
    this.tagRegistry = new TagRegistry();

    this.autoTagger = new AutoTagger(
      this.app,
      () => this.settings,
      this.entityRegistry,
      this.tagRegistry,
      () => this.tagCache,
      async (path, timestamp) => {
        this.tagCache[path] = timestamp;
        await this.saveData_();
      }
    );

    this.addSettingTab(new AutoTaggerSettingsTab(this.app, this));

    this.addCommand({
      id: "tag-current-note",
      name: "Tag current note",
      callback: () =>
        tagCurrentNote(
          this.app,
          this.settings,
          this.entityRegistry,
          this.tagRegistry
        ),
    });

    this.addCommand({
      id: "batch-tag-never-autotagged",
      name: "Batch tag — never auto-tagged",
      callback: () => this.runBatch("never-autotagged"),
    });

    this.addCommand({
      id: "batch-tag-needs-tagging",
      name: "Batch tag — never auto-tagged or changed since",
      callback: () => this.runBatch("needs-tagging"),
    });

    this.addCommand({
      id: "batch-tag-untagged",
      name: "Batch tag — no tags in frontmatter",
      callback: () => this.runBatch("untagged"),
    });

    this.addCommand({
      id: "batch-tag-modified",
      name: "Batch tag — modified since last batch run",
      callback: () => this.runBatch("modified"),
    });

    this.addCommand({
      id: "batch-tag-all",
      name: "Batch tag — all notes",
      callback: () => this.runBatch("all"),
    });

    this.addCommand({
      id: "rebuild-registry",
      name: "Rebuild entity & tag registry",
      callback: () => this.rebuildRegistry(),
    });

    this.app.workspace.onLayoutReady(async () => {
      await this.rebuildRegistry();
      if (this.settings.autoTag.enabled) {
        this.autoTagger.start();
      }
    });
  }

  onunload(): void {
    this.autoTagger.stop();
  }

  async rebuildRegistry(): Promise<void> {
    await this.entityRegistry.rebuild(this.app, this.settings.entityDescriptions);
    this.tagRegistry.rebuild(this.app, this.settings.tagDescriptions);
    new Notice("AutoTagger: Registry rebuilt.");
  }

  restartAutoTagger(): void {
    this.autoTagger.stop();
    if (this.settings.autoTag.enabled) {
      this.autoTagger.start();
    }
  }

  async loadData_(): Promise<void> {
    const raw = (await this.loadData()) ?? {};
    if ("settings" in raw) {
      // New format: { settings, tagCache }
      const data = raw as Partial<PluginData>;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings ?? {});
      this.tagCache = data.tagCache ?? {};
    } else {
      // Legacy format: flat settings object
      this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
      this.tagCache = {};
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData_();
  }

  async saveData_(): Promise<void> {
    const data: PluginData = { settings: this.settings, tagCache: this.tagCache };
    await this.saveData(data);
  }

  private runBatch(scope: BatchScope): void {
    batchTag(
      this.app,
      this.settings,
      this.entityRegistry,
      this.tagRegistry,
      scope,
      this.tagCache,
      async (lastRun, cacheUpdates) => {
        this.settings.lastBatchRun = lastRun;
        Object.assign(this.tagCache, cacheUpdates);
        await this.saveData_();
      }
    ).catch((err) => {
      console.error("AutoTagger batch error:", err);
      new Notice(
        `AutoTagger: Batch error — ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }
}
