import { App, Modal, Setting } from "obsidian";
import { applyInterfaceLocale } from "../config/i18n";
import type { LocaleId } from "../config/locale";

export interface ConversionPreviewOptions {
  language?: LocaleId;
  title: string;
  description: string;
  source: string;
  cancelLabel: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose?: () => void;
}

export class ConversionPreviewModal extends Modal {
  private closed = false;

  constructor(app: App, private readonly options: ConversionPreviewOptions) {
    super(app);
  }

  override onOpen(): void {
    applyInterfaceLocale(this.modalEl ?? this.contentEl, this.options.language);
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
          if (this.closed) return;
          this.close();
          this.options.onConfirm();
        }));
  }

  override onClose(): void {
    this.closed = true;
    this.contentEl.empty();
    this.options.onClose?.();
  }
}
