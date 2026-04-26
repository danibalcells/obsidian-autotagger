import { App, Modal, Setting } from "obsidian";

export interface PreviewData {
  people: string[];
  organizations: string[];
  places: string[];
  tags: string[];
  new_tags: string[];
}

export class PreviewModal extends Modal {
  private onConfirm: () => void;

  constructor(
    app: App,
    private data: PreviewData,
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
      this.data.people.length > 0 ||
      this.data.organizations.length > 0 ||
      this.data.places.length > 0 ||
      this.data.tags.length > 0 ||
      this.data.new_tags.length > 0;

    if (!hasResults) {
      contentEl.createEl("p", { text: "No tags or entity links suggested." });
    } else {
      this.renderSection(contentEl, "People", this.data.people);
      this.renderSection(contentEl, "Organizations", this.data.organizations);
      this.renderSection(contentEl, "Places", this.data.places);
      this.renderSection(contentEl, "Tags", this.data.tags);
      this.renderSection(contentEl, "New Tags", this.data.new_tags);
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
