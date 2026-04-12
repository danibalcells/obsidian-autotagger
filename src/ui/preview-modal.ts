import { App, Modal, Setting } from "obsidian";
import type { LLMResponse } from "../types";

export class PreviewModal extends Modal {
  private onConfirm: () => void;

  constructor(
    app: App,
    private response: LLMResponse,
    onConfirm: () => void
  ) {
    super(app);
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "AutoTagger — Preview" });

    const hasResults =
      this.response.people.length > 0 ||
      this.response.organizations.length > 0 ||
      this.response.places.length > 0 ||
      this.response.tags.length > 0 ||
      this.response.new_tags.length > 0;

    if (!hasResults) {
      contentEl.createEl("p", { text: "No tags or entity links suggested." });
    } else {
      this.renderSection(contentEl, "People", this.response.people);
      this.renderSection(contentEl, "Organizations", this.response.organizations);
      this.renderSection(contentEl, "Places", this.response.places);
      this.renderSection(contentEl, "Tags", this.response.tags);
      this.renderSection(contentEl, "New Tags", this.response.new_tags);
    }

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Apply")
          .setCta()
          .onClick(() => {
            this.close();
            this.onConfirm();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => this.close())
      );
  }

  private renderSection(
    container: HTMLElement,
    label: string,
    items: string[]
  ): void {
    if (items.length === 0) return;
    container.createEl("h3", { text: label });
    const ul = container.createEl("ul");
    for (const item of items) {
      ul.createEl("li", { text: item });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
