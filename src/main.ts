import { Notice, Plugin } from "obsidian";
import type { AutoTaggerSettings, BatchScope, LLMProvider, PluginData } from "./types";
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
      },
      () => this.resolveApiKey(this.settings.provider)
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
          this.tagRegistry,
          () => this.resolveApiKey(this.settings.provider)
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
      const data = raw as Partial<PluginData>;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings ?? {});
      this.tagCache = data.tagCache ?? {};
    } else {
      this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
      this.tagCache = {};
    }
    this.migrateApiKeys();
  }

  resolveApiKey(provider: LLMProvider): string {
    const key = this.app.secretStorage?.getSecret(`autotagger-${provider}-key`);
    if (key) return key;
    return this.settings.apiKeys[provider] ?? "";
  }

  async saveApiKey(provider: LLMProvider, value: string): Promise<void> {
    if (this.app.secretStorage) {
      this.app.secretStorage.setSecret(`autotagger-${provider}-key`, value);
      if (this.settings.apiKeys[provider]) {
        delete this.settings.apiKeys[provider];
        await this.saveSettings();
      }
    } else {
      this.settings.apiKeys[provider] = value;
      await this.saveSettings();
    }
  }

  private migrateApiKeys(): void {
    const ss = this.app.secretStorage;
    if (!ss) return;
    let migrated = false;
    for (const provider of ["openai", "anthropic", "google"] as LLMProvider[]) {
      const legacyKey = this.settings.apiKeys[provider];
      if (legacyKey) {
        if (!ss.getSecret(`autotagger-${provider}-key`)) {
          ss.setSecret(`autotagger-${provider}-key`, legacyKey);
        }
        delete this.settings.apiKeys[provider];
        migrated = true;
      }
    }
    if (migrated) {
      this.saveSettings().catch(console.error);
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
      },
      () => this.resolveApiKey(this.settings.provider)
    ).catch((err) => {
      console.error("AutoTagger batch error:", err);
      new Notice(
        `AutoTagger: Batch error — ${err instanceof Error ? err.message : String(err)}`
      );
    });
  }
}
