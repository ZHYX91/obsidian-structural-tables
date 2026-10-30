import { App, Modal, Setting } from "obsidian";
import { applyInterfaceLocale } from "../config/i18n";
import type { LocaleId } from "../config/locale";

export interface ConversionPreviewOptions {
  language?: LocaleId;
  title: string;
  description: string;
  /** A non-representable difference must be accepted before replacement. */
  warning?: string;
  acknowledgeLabel?: string;
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
    if (this.options.warning !== undefined) {
      this.contentEl.createEl("p", { cls: "structural-tables-conversion-warning", text: this.options.warning });
    }
    this.contentEl.createEl("pre", {
      cls: "structural-tables-conversion-preview",
      text: this.options.source,
    });
    let accepted = this.options.warning === undefined;
    let setConfirmEnabled: ((value: boolean) => void) | null = null;
    if (!accepted) {
      new Setting(this.contentEl)
        .setName(this.options.acknowledgeLabel ?? "")
        .addToggle((toggle) => toggle.setValue(false).onChange((value) => {
          accepted = value;
          setConfirmEnabled?.(value);
        }));
    }
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText(this.options.cancelLabel)
        .onClick(() => this.close()))
      .addButton((button) => {
        setConfirmEnabled = (value) => button.setDisabled(!value);
        return button.setCta().setButtonText(this.options.confirmLabel)
          .setDisabled(!accepted).onClick(() => {
          if (this.closed || !accepted) return;
          this.close();
          this.options.onConfirm();
        });
      });
  }

  override onClose(): void {
    this.closed = true;
    this.contentEl.empty();
    this.options.onClose?.();
  }
}
