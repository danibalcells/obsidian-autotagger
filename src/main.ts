import { Notice, Plugin } from "obsidian";
import type { AutoTaggerSettings, BatchScope } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { EntityRegistry } from "./registry/entity-registry";
import { TagRegistry } from "./registry/tag-registry";
import { AutoTaggerSettingsTab } from "./settings/settings-tab";
import { tagCurrentNote } from "./commands/tag-current-note";
import { batchTag } from "./commands/batch-tag";
import { AutoTagger } from "./auto-tagger";

export default class AutoTaggerPlugin extends Plugin {
  settings!: AutoTaggerSettings;
  entityRegistry!: EntityRegistry;
  tagRegistry!: TagRegistry;
  private autoTagger!: AutoTagger;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.entityRegistry = new EntityRegistry();
    this.tagRegistry = new TagRegistry();

    this.autoTagger = new AutoTagger(
      this.app,
      () => this.settings,
      this.entityRegistry,
      this.tagRegistry
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
      id: "batch-tag-untagged",
      name: "Batch tag — untagged notes",
      callback: () => this.runBatch("untagged"),
    });

    this.addCommand({
      id: "batch-tag-modified",
      name: "Batch tag — notes modified since last run",
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

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private runBatch(scope: BatchScope): void {
    batchTag(
      this.app,
      this.settings,
      this.entityRegistry,
      this.tagRegistry,
      scope,
      async (lastRun) => {
        this.settings.lastBatchRun = lastRun;
        await this.saveSettings();
      }
    ).catch((err) => {
      console.error("AutoTagger batch error:", err);
      new Notice(`AutoTagger: Batch error — ${err instanceof Error ? err.message : String(err)}`);
    });
  }
}
