import { App, Modal, Setting } from "obsidian";

export interface ConversionPreviewOptions {
  title: string;
  description: string;
  source: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export class ConversionPreviewModal extends Modal {
  constructor(app: App, private readonly options: ConversionPreviewOptions) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.options.title);
    this.contentEl.createEl("p", { text: this.options.description });
    this.contentEl.createEl("pre", {
      cls: "structural-tables-conversion-preview",
      text: this.options.source,
    });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText(this.options.cancelLabel)
        .onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText(this.options.confirmLabel)
        .onClick(() => {
          this.close();
          this.options.onConfirm();
        }));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
