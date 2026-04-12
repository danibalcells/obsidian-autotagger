import { App, Modal } from "obsidian";

export class BatchProgressModal extends Modal {
  private progressEl!: HTMLProgressElement;
  private statusEl!: HTMLParagraphElement;
  private cancelBtn!: HTMLButtonElement;
  private cancelled = false;
  private onCancel: () => void;

  constructor(app: App, private total: number, onCancel: () => void) {
    super(app);
    this.onCancel = onCancel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "AutoTagger — Batch Processing" });

    this.statusEl = contentEl.createEl("p", {
      text: `Processing 0 / ${this.total}`,
    });

    this.progressEl = contentEl.createEl("progress");
    this.progressEl.max = this.total;
    this.progressEl.value = 0;
    this.progressEl.style.width = "100%";

    this.cancelBtn = contentEl.createEl("button", { text: "Cancel" });
    this.cancelBtn.style.marginTop = "12px";
    this.cancelBtn.addEventListener("click", () => {
      this.cancelled = true;
      this.onCancel();
      this.cancelBtn.disabled = true;
      this.statusEl.setText("Cancelling…");
    });
  }

  update(current: number, fileName: string): void {
    this.progressEl.value = current;
    this.statusEl.setText(
      `Processing ${current} / ${this.total}: ${fileName}`
    );
  }

  showSummary(processed: number, skipped: number, errors: number): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "AutoTagger — Batch Complete" });
    contentEl.createEl("p", { text: `Processed: ${processed}` });
    contentEl.createEl("p", { text: `Skipped: ${skipped}` });
    if (errors > 0) {
      contentEl.createEl("p", { text: `Errors: ${errors}` });
    }

    const closeBtn = contentEl.createEl("button", { text: "Close" });
    closeBtn.style.marginTop = "12px";
    closeBtn.addEventListener("click", () => this.close());
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
