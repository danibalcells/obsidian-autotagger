import { App, PluginSettingTab, Setting } from "obsidian";
import type AutoTaggerPlugin from "../main";
import type { LLMProvider, NewTagsPolicy } from "../types";

interface ModelOption {
  id: string;
  label: string;
}

const PROVIDER_MODELS: Record<LLMProvider, ModelOption[]> = {
  openai: [
    { id: "gpt-5.4", label: "GPT-5.4" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini" },
    { id: "gpt-5.4-nano", label: "GPT-5.4 nano" },
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "custom", label: "Custom…" },
  ],
  anthropic: [
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { id: "claude-3-7-sonnet-20250219", label: "Claude 3.7 Sonnet" },
    { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
    { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
    { id: "custom", label: "Custom…" },
  ],
  google: [
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)" },
    { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite (preview)" },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { id: "custom", label: "Custom…" },
  ],
  ollama: [
    { id: "custom", label: "Enter model name…" },
  ],
};

const CUSTOM_SENTINEL = "custom";

function resolveDropdownValue(provider: LLMProvider, modelName: string): string {
  if (!modelName) return PROVIDER_MODELS[provider][0]?.id ?? CUSTOM_SENTINEL;
  const known = PROVIDER_MODELS[provider].some(
    (m) => m.id === modelName && m.id !== CUSTOM_SENTINEL
  );
  return known ? modelName : CUSTOM_SENTINEL;
}

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
          // Reset model to first option for new provider
          const first = PROVIDER_MODELS[value as LLMProvider][0];
          if (first && first.id !== CUSTOM_SENTINEL) {
            this.plugin.settings.modelName = first.id;
          } else {
            this.plugin.settings.modelName = "";
          }
          await this.plugin.saveSettings();
          this.display();
        })
    );

    this.renderModelSelector(containerEl);

    if (this.plugin.settings.provider !== "ollama") {
      const provider = this.plugin.settings.provider;
      new Setting(containerEl).setName("API key").addText((text) => {
        text
          .setPlaceholder("Enter your API key")
          .setValue(this.plugin.resolveApiKey(provider))
          .onChange(async (value) => {
            await this.plugin.saveApiKey(provider, value);
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

  private renderModelSelector(containerEl: HTMLElement): void {
    const provider = this.plugin.settings.provider;
    const models = PROVIDER_MODELS[provider];
    const dropdownValue = resolveDropdownValue(provider, this.plugin.settings.modelName);
    const isCustom = dropdownValue === CUSTOM_SENTINEL;

    // Custom text input placeholder shown below the dropdown when needed
    let customInputEl: HTMLElement | null = null;

    const modelSetting = new Setting(containerEl).setName("Model");

    modelSetting.addDropdown((dd) => {
      for (const model of models) {
        dd.addOption(model.id, model.label);
      }
      dd.setValue(dropdownValue);
      dd.onChange(async (value) => {
        if (value === CUSTOM_SENTINEL) {
          this.plugin.settings.modelName = "";
          await this.plugin.saveSettings();
          if (customInputEl) customInputEl.style.display = "block";
        } else {
          this.plugin.settings.modelName = value;
          await this.plugin.saveSettings();
          if (customInputEl) customInputEl.style.display = "none";
        }
      });
    });

    // Custom input row — only visible when "Custom…" is selected
    const customRow = containerEl.createEl("div");
    customRow.style.display = isCustom ? "block" : "none";
    customInputEl = customRow;

    new Setting(customRow)
      .setName("Custom model name")
      .setDesc("Enter the exact API model ID.")
      .addText((text) =>
        text
          .setPlaceholder(this.defaultModelPlaceholder())
          .setValue(isCustom ? this.plugin.settings.modelName : "")
          .onChange(async (value) => {
            this.plugin.settings.modelName = value;
            await this.plugin.saveSettings();
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

    new Setting(containerEl)
      .setName("Exclude tag prefixes")
      .setDesc(
        "Comma-separated tag prefixes — notes with any matching tag are skipped. E.g. \"type/\" skips all notes tagged type/task, type/template, etc."
      )
      .addText((text) =>
        text
          .setPlaceholder("type/")
          .setValue(this.plugin.settings.excludeTagPrefixes.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.excludeTagPrefixes = value
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
          this.display();
        })
      );

    const sortedTags = [...this.plugin.tagRegistry.getEntries()].sort((a, b) =>
      a.tag.localeCompare(b.tag)
    );
    const sortedEntities = [...this.plugin.entityRegistry.getEntries()].sort(
      (a, b) => a.canonicalName.localeCompare(b.canonicalName)
    );

    this.renderCollapsibleList(
      containerEl,
      `Tag descriptions (${sortedTags.length})`,
      "Add descriptions to disambiguate tags for the LLM.",
      "Search tags…",
      sortedTags,
      (item, listEl) => this.renderTagSetting(listEl, item.tag, item.count)
    );

    this.renderCollapsibleList(
      containerEl,
      `Entity descriptions (${sortedEntities.length})`,
      "Add descriptions to help the LLM identify entities.",
      "Search entities…",
      sortedEntities,
      (item, listEl) =>
        this.renderEntitySetting(
          listEl,
          item.canonicalName,
          item.type,
          item.aliases
        )
    );
  }

  private renderCollapsibleList<T>(
    containerEl: HTMLElement,
    title: string,
    description: string,
    searchPlaceholder: string,
    items: T[],
    renderItem: (item: T, container: HTMLElement) => void
  ): void {
    const wrapper = containerEl.createEl("div");
    wrapper.style.marginTop = "16px";

    // Toggle header
    const header = wrapper.createEl("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.cursor = "pointer";
    header.style.userSelect = "none";
    header.style.padding = "4px 0";

    const arrow = header.createEl("span", { text: "▶" });
    arrow.style.marginRight = "6px";
    arrow.style.fontSize = "10px";
    arrow.style.transition = "transform 0.15s";

    header.createEl("span", { text: title, cls: "setting-item-name" });

    // Collapsible content
    const content = wrapper.createEl("div");
    content.style.display = "none";

    // Description
    content.createEl("p", {
      text: description,
      cls: "setting-item-description",
    });

    // Search input
    const searchInput = content.createEl("input");
    searchInput.type = "text";
    searchInput.placeholder = searchPlaceholder;
    searchInput.style.width = "100%";
    searchInput.style.marginBottom = "8px";
    searchInput.style.padding = "4px 8px";
    searchInput.style.boxSizing = "border-box";
    searchInput.addClass("autotagger-search-input");

    // Item list container
    const listEl = content.createEl("div");

    const renderFiltered = (query: string): void => {
      listEl.empty();
      const lower = query.toLowerCase();
      let count = 0;
      for (const item of items) {
        const label =
          "tag" in (item as object)
            ? (item as { tag: string }).tag
            : (item as { canonicalName: string }).canonicalName;
        if (!lower || label.toLowerCase().includes(lower)) {
          renderItem(item, listEl);
          count++;
        }
      }
      if (count === 0) {
        listEl.createEl("p", {
          text: "No results.",
          cls: "setting-item-description",
        });
      }
    };

    searchInput.addEventListener("input", () => renderFiltered(searchInput.value));

    let opened = false;
    header.addEventListener("click", () => {
      const isOpen = content.style.display !== "none";
      if (isOpen) {
        content.style.display = "none";
        arrow.setText("▶");
        arrow.style.transform = "";
      } else {
        content.style.display = "block";
        arrow.setText("▼");
        if (!opened) {
          renderFiltered("");
          opened = true;
        }
      }
    });
  }

  private renderTagSetting(
    container: HTMLElement,
    tag: string,
    count: number
  ): void {
    new Setting(container)
      .setName(tag)
      .setDesc(`Used ${count} time${count !== 1 ? "s" : ""}`)
      .addText((text) =>
        text
          .setPlaceholder("Description…")
          .setValue(this.plugin.settings.tagDescriptions[tag] ?? "")
          .onChange(async (value) => {
            if (value) {
              this.plugin.settings.tagDescriptions[tag] = value;
            } else {
              delete this.plugin.settings.tagDescriptions[tag];
            }
            await this.plugin.saveSettings();
            this.plugin.tagRegistry.rebuild(
              this.app,
              this.plugin.settings.tagDescriptions
            );
          })
      );
  }

  private renderEntitySetting(
    container: HTMLElement,
    canonicalName: string,
    type: string,
    aliases: string[]
  ): void {
    new Setting(container)
      .setName(`${canonicalName} (${type})`)
      .setDesc(
        aliases.length > 0 ? `Aliases: ${aliases.join(", ")}` : "No aliases"
      )
      .addText((text) =>
        text
          .setPlaceholder("Description…")
          .setValue(
            this.plugin.settings.entityDescriptions[canonicalName] ?? ""
          )
          .onChange(async (value) => {
            if (value) {
              this.plugin.settings.entityDescriptions[canonicalName] = value;
            } else {
              delete this.plugin.settings.entityDescriptions[canonicalName];
            }
            await this.plugin.saveSettings();
          })
      );
  }

  private defaultModelPlaceholder(): string {
    switch (this.plugin.settings.provider) {
      case "openai":
        return "e.g. gpt-5.4";
      case "anthropic":
        return "e.g. claude-sonnet-4-6";
      case "google":
        return "e.g. gemini-2.5-flash";
      case "ollama":
        return "e.g. llama3.2";
    }
  }
}
