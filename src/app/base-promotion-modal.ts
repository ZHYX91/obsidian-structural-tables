import { App, Modal, Setting } from "obsidian";

import type { BasePromotionBlocker, BasePromotionWarning } from "../core/base-promotion";
import type { PreparedBasePromotion } from "./base-promotion-service";

export interface BasePromotionLabels {
  title: string;
  description: string;
  target: string;
  records: string;
  columns: string;
  warning: (warning: BasePromotionWarning) => string;
  blockingIssues: string;
  blocker: (blocker: BasePromotionBlocker) => string;
  cancel: string;
  confirm: string;
}

export class BasePromotionModal extends Modal {
  constructor(
    app: App,
    private readonly prepared: PreparedBasePromotion,
    private readonly labels: BasePromotionLabels,
    private readonly onConfirm: () => Promise<void>,
    private readonly onError: (error: unknown) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.labels.title);
    this.contentEl.createEl("p", { text: this.labels.description });
    this.contentEl.createEl("p", {
      text: this.labels.target.replace("{path}", this.prepared.directoryPath),
    });
    this.contentEl.createEl("p", {
      text: this.labels.records.replace("{count}", String(this.prepared.records.length)),
    });
    this.contentEl.createEl("h3", { text: this.labels.columns });
    const mapping = this.contentEl.createEl("ul", { cls: "structural-tables-promotion-mapping" });
    for (const column of this.prepared.plan.columns) {
      mapping.createEl("li", { text: `${column.displayName} → ${column.key}` });
    }
    for (const warning of this.prepared.plan.warnings) {
      this.contentEl.createDiv({
        cls: "structural-tables-promotion-warning",
        text: this.labels.warning(warning),
      });
    }
    if (this.prepared.plan.blockers.length > 0) {
      this.contentEl.createEl("h3", { text: this.labels.blockingIssues });
      for (const blocker of this.prepared.plan.blockers) {
        this.contentEl.createDiv({
          cls: "structural-tables-promotion-blocker",
          text: this.labels.blocker(blocker),
        });
      }
    }
    this.contentEl.createEl("pre", {
      cls: "structural-tables-conversion-preview",
      text: this.prepared.replacementSource,
    });
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText(this.labels.cancel)
        .onClick(() => this.close()))
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(this.labels.confirm)
          .setDisabled(this.prepared.plan.blockers.length > 0);
        if (this.prepared.plan.blockers.length > 0) return;
        button.onClick(async () => {
          button.setDisabled(true);
          try {
            await this.onConfirm();
            this.close();
          } catch (error) {
            this.onError(error);
          } finally {
            button.setDisabled(false);
          }
        });
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
