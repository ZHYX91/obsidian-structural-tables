import { App, Modal, Setting } from "obsidian";

import type {
  BasePromotionBlocker,
  BasePromotionWarning,
} from "../core/base-promotion";
import type { BasePromotionContentKind } from "../core/base-promotion-content";
import {
  acceptBasePromotionContent,
  type BasePromotionContentAcceptance,
  type PreparedBasePromotion,
} from "./base-promotion-service";

export interface BasePromotionLabels {
  title: string;
  description: string;
  target: string;
  records: string;
  columns: string;
  warning: (warning: BasePromotionWarning) => string;
  blockingIssues: string;
  blocker: (blocker: BasePromotionBlocker) => string;
  contentDifferences: string;
  contentSummary: string;
  contentSource: string;
  contentKind: (kind: BasePromotionContentKind) => string;
  contentHeaderTarget: string;
  contentRecordTarget: string;
  recordPreviews: string;
  acceptContentDifferences: string;
  cancel: string;
  confirm: string;
}

export class BasePromotionModal extends Modal {
  constructor(
    app: App,
    private readonly prepared: PreparedBasePromotion,
    private readonly labels: BasePromotionLabels,
    private readonly onConfirm: (acceptance?: BasePromotionContentAcceptance) => Promise<void>,
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

    const report = this.prepared.plan.contentReport;
    if (report.notices.length > 0) {
      this.contentEl.createEl("h3", { text: this.labels.contentDifferences });
      this.contentEl.createEl("p", {
        text: this.labels.contentSummary
          .replace("{sources}", String(report.sourceCellCount))
          .replace("{targets}", String(report.targetCount)),
      });
      const reportContainer = this.contentEl.createDiv({ cls: "structural-tables-promotion-content-report" });
      for (const notice of report.notices) {
        const details = reportContainer.createEl("details", { cls: "structural-tables-promotion-content-item" });
        details.createEl("summary", {
          text: this.labels.contentSource
            .replace("{row}", String(notice.row))
            .replace("{column}", String(notice.column))
            .replace("{line}", String(notice.sourceLine)),
        });
        details.createEl("pre", {
          cls: "structural-tables-promotion-content-source",
          text: notice.source,
        });
        const kinds = [...new Set(notice.occurrences.map(({ kind }) => kind))];
        const kindList = details.createEl("ul");
        for (const kind of kinds) kindList.createEl("li", { text: this.labels.contentKind(kind) });
        const targets = details.createEl("ul");
        for (const target of notice.targets) {
          if (target.type === "header") {
            targets.createEl("li", {
              text: this.labels.contentHeaderTarget
                .replace("{column}", String(target.sourceColumn + 1))
                .replace("{key}", target.key)
                .replace("{displayName}", target.displayName),
            });
            continue;
          }
          const preparedRecord = this.prepared.records[target.recordIndex];
          const item = targets.createEl("li");
          item.createEl("div", {
            text: this.labels.contentRecordTarget
              .replace("{record}", String(target.recordIndex + 1))
              .replace("{path}", preparedRecord?.path ?? "")
              .replace("{key}", target.key),
          });
          item.createEl("pre", {
            cls: "structural-tables-promotion-content-value",
            text: target.value,
          });
        }
      }
    }

    this.contentEl.createEl("h3", { text: this.labels.recordPreviews });
    const recordPreviews = this.contentEl.createDiv({ cls: "structural-tables-promotion-record-previews" });
    for (const record of this.prepared.records) {
      const details = recordPreviews.createEl("details");
      details.createEl("summary", { text: record.path });
      details.createEl("pre", { text: record.content });
    }

    this.contentEl.createEl("pre", {
      cls: "structural-tables-conversion-preview",
      text: this.prepared.replacementSource,
    });

    let acceptanceInput: HTMLInputElement | null = null;
    if (report.requiresAcceptance) {
      const label = this.contentEl.createEl("label", { cls: "structural-tables-promotion-acceptance" });
      acceptanceInput = label.createEl("input");
      acceptanceInput.type = "checkbox";
      label.createEl("span", { text: this.labels.acceptContentDifferences });
    }

    let submitting = false;
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText(this.labels.cancel)
        .onClick(() => this.close()))
      .addButton((button) => {
        const updateDisabled = (): void => {
          const acceptanceMissing = report.requiresAcceptance && acceptanceInput?.checked !== true;
          button.setDisabled(submitting || this.prepared.plan.blockers.length > 0 || acceptanceMissing);
        };
        button.setCta().setButtonText(this.labels.confirm);
        updateDisabled();
        acceptanceInput?.addEventListener("change", updateDisabled);
        button.onClick(async () => {
          if (submitting
            || this.prepared.plan.blockers.length > 0
            || (report.requiresAcceptance && acceptanceInput?.checked !== true)) return;
          submitting = true;
          updateDisabled();
          let succeeded = false;
          try {
            const acceptance = report.requiresAcceptance ? acceptBasePromotionContent(this.prepared) : undefined;
            await this.onConfirm(acceptance);
            succeeded = true;
            this.close();
          } catch (error) {
            this.onError(error);
          } finally {
            submitting = false;
            if (!succeeded) updateDisabled();
          }
        });
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
