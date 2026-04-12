import { App, PluginSettingTab, Setting } from "obsidian";
import type AutoTaggerPlugin from "../main";
import type { LLMProvider, NewTagsPolicy } from "../types";

export class AutoTaggerSettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: AutoTaggerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "AutoTagger Settings" });

    this.renderLLMSection();
    this.renderAutoTaggingSection();
    this.renderMtimeSection();
    this.renderNewTagsSection();
    this.renderRegistrySection();
  }

  private renderLLMSection(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "LLM Provider" });

    new Setting(containerEl).setName("Provider").addDropdown((dd) =>
      dd
        .addOptions({
          openai: "OpenAI",
          anthropic: "Anthropic",
          google: "Google Gemini",
          ollama: "Ollama (local)",
        })
        .setValue(this.plugin.settings.provider)
        .onChange(async (value) => {
          this.plugin.settings.provider = value as LLMProvider;
          await this.plugin.saveSettings();
          this.display();
        })
    );

    new Setting(containerEl)
      .setName("Model name")
      .addText((text) =>
        text
          .setPlaceholder(this.defaultModelName())
          .setValue(this.plugin.settings.modelName)
          .onChange(async (value) => {
            this.plugin.settings.modelName = value;
            await this.plugin.saveSettings();
          })
      );

    if (this.plugin.settings.provider !== "ollama") {
      new Setting(containerEl).setName("API key").addText((text) => {
        text
          .setPlaceholder("Enter your API key")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
      });
    } else {
      new Setting(containerEl)
        .setName("Ollama URL")
        .addText((text) =>
          text
            .setPlaceholder("http://localhost:11434")
            .setValue(this.plugin.settings.ollamaUrl)
            .onChange(async (value) => {
              this.plugin.settings.ollamaUrl = value;
              await this.plugin.saveSettings();
            })
        );
    }

    new Setting(containerEl)
      .setName("System prompt")
      .setDesc("Instructions sent to the LLM before the entity/tag context.")
      .addTextArea((area) => {
        area.setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
          this.plugin.settings.systemPrompt = value;
          await this.plugin.saveSettings();
        });
        area.inputEl.rows = 6;
        area.inputEl.style.width = "100%";
      });

    new Setting(containerEl).setName("Max input tokens").addText((text) =>
      text
        .setValue(String(this.plugin.settings.maxInputTokens))
        .onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.maxInputTokens = n;
            await this.plugin.saveSettings();
          }
        })
    );

    new Setting(containerEl).setName("Max output tokens").addText((text) =>
      text
        .setValue(String(this.plugin.settings.maxOutputTokens))
        .onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.maxOutputTokens = n;
            await this.plugin.saveSettings();
          }
        })
    );
  }

  private renderAutoTaggingSection(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Auto-tagging" });

    new Setting(containerEl)
      .setName("Enable auto-tagging")
      .setDesc("Automatically tag notes after a grace period of inactivity.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoTag.enabled)
          .onChange(async (value) => {
            this.plugin.settings.autoTag.enabled = value;
            await this.plugin.saveSettings();
            this.plugin.restartAutoTagger();
          })
      );

    new Setting(containerEl)
      .setName("Grace period (minutes)")
      .setDesc("How long after last edit before auto-tagging fires.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.autoTag.gracePeriodMinutes))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.autoTag.gracePeriodMinutes = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Check interval (minutes)")
      .setDesc("How often the plugin sweeps for pending files.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.autoTag.checkIntervalMinutes))
          .onChange(async (value) => {
            const n = parseInt(value, 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.autoTag.checkIntervalMinutes = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Include folders")
      .setDesc(
        "Comma-separated list of folders to include (leave empty for all)."
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autoTag.includeFolders.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.autoTag.includeFolders = value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Exclude folders")
      .setDesc("Comma-separated list of folders to exclude.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.autoTag.excludeFolders.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.autoTag.excludeFolders = value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
          })
      );
  }

  private renderMtimeSection(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "File modification time" });

    new Setting(containerEl)
      .setName("Preserve modification time")
      .setDesc(
        "Restore the original mtime after tagging. Desktop only — has no effect on mobile."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.preserveMtime)
          .onChange(async (value) => {
            this.plugin.settings.preserveMtime = value;
            await this.plugin.saveSettings();
          })
      );
  }

  private renderNewTagsSection(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "New tags" });

    new Setting(containerEl).setName("New tags policy").addDropdown((dd) =>
      dd
        .addOptions({
          "existing-only": "Existing tags only",
          "allow-suggestions": "Allow new tag suggestions",
        })
        .setValue(this.plugin.settings.newTagsPolicy)
        .onChange(async (value) => {
          this.plugin.settings.newTagsPolicy = value as NewTagsPolicy;
          await this.plugin.saveSettings();
          this.display();
        })
    );

    if (this.plugin.settings.newTagsPolicy === "allow-suggestions") {
      new Setting(containerEl)
        .setName("New tags namespace")
        .setDesc("New tags must start with this prefix.")
        .addText((text) =>
          text
            .setPlaceholder("topic/")
            .setValue(this.plugin.settings.newTagsNamespace)
            .onChange(async (value) => {
              this.plugin.settings.newTagsNamespace = value;
              await this.plugin.saveSettings();
            })
        );
    }
  }

  private renderRegistrySection(): void {
    const { containerEl } = this;
    containerEl.createEl("h3", { text: "Registry" });

    new Setting(containerEl)
      .setName("Rebuild registry")
      .setDesc("Re-scan vault for entities and tags.")
      .addButton((btn) =>
        btn.setButtonText("Rebuild").onClick(async () => {
          await this.plugin.rebuildRegistry();
          btn.setButtonText("Done!");
          setTimeout(() => btn.setButtonText("Rebuild"), 2000);
        })
      );

    containerEl.createEl("h4", { text: "Tag descriptions" });
    containerEl.createEl("p", {
      text: "Add descriptions to disambiguate tags for the LLM.",
      cls: "setting-item-description",
    });

    for (const tagEntry of this.plugin.tagRegistry.getEntries()) {
      new Setting(containerEl)
        .setName(tagEntry.tag)
        .setDesc(`Used ${tagEntry.count} time${tagEntry.count !== 1 ? "s" : ""}`)
        .addText((text) =>
          text
            .setPlaceholder("Description…")
            .setValue(this.plugin.settings.tagDescriptions[tagEntry.tag] ?? "")
            .onChange(async (value) => {
              if (value) {
                this.plugin.settings.tagDescriptions[tagEntry.tag] = value;
              } else {
                delete this.plugin.settings.tagDescriptions[tagEntry.tag];
              }
              await this.plugin.saveSettings();
              this.plugin.tagRegistry.rebuild(
                this.app,
                this.plugin.settings.tagDescriptions
              );
            })
        );
    }

    containerEl.createEl("h4", { text: "Entity descriptions" });
    containerEl.createEl("p", {
      text: "Add descriptions to help the LLM identify entities.",
      cls: "setting-item-description",
    });

    for (const entity of this.plugin.entityRegistry.getEntries()) {
      new Setting(containerEl)
        .setName(`${entity.canonicalName} (${entity.type})`)
        .setDesc(
          entity.aliases.length > 0
            ? `Aliases: ${entity.aliases.join(", ")}`
            : "No aliases"
        )
        .addText((text) =>
          text
            .setPlaceholder("Description…")
            .setValue(
              this.plugin.settings.entityDescriptions[entity.canonicalName] ?? ""
            )
            .onChange(async (value) => {
              if (value) {
                this.plugin.settings.entityDescriptions[entity.canonicalName] =
                  value;
              } else {
                delete this.plugin.settings.entityDescriptions[
                  entity.canonicalName
                ];
              }
              await this.plugin.saveSettings();
            })
        );
    }
  }

  private defaultModelName(): string {
    switch (this.plugin.settings.provider) {
      case "openai":
        return "gpt-4o-mini";
      case "anthropic":
        return "claude-3-5-haiku-latest";
      case "google":
        return "gemini-1.5-flash";
      case "ollama":
        return "llama3.2";
    }
  }
}
