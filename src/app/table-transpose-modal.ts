import { App, Modal, Notice, Setting } from "obsidian";

import { operationNotice, type Translate } from "../config/i18n";
import type { StructuralTable } from "../core/model";
import { planTransposeTable, type TableTransposePlan } from "../core/operations";

/** Only real loss or a new Markdown dialect warrants an extra confirmation. */
export class TableTransposeModal extends Modal {
  constructor(
    app: App,
    private readonly t: Translate,
    private readonly plan: TableTransposePlan,
    private readonly apply: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.t("transpose.confirmTitle"));
    if (this.plan.resetsColumnAlignment) {
      this.contentEl.createEl("p", { text: this.t("transpose.alignmentWarning") });
    }
    if (this.plan.introducesStructuralSyntax) {
      this.contentEl.createEl("p", { text: this.t("transpose.syntaxWarning") });
    }
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(this.t("transpose.cancel"))
        .onClick(() => this.close()))
      .addButton((button) => button.setCta().setButtonText(this.t("transpose.continue"))
        .onClick(() => {
          this.close();
          this.apply();
        }));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export interface TableTransposeRequest {
  /** The captured target's document, which may be a popout rather than the main window. */
  ownerDocument: Document;
  /** The original note or table container; drafts in other panes must not affect this table. */
  draftRoot: ParentNode;
  /** Must check the original file/editor/view and the unchanged table at confirmation time. */
  isCurrent: () => boolean;
  /** Must revalidate the target before writing, not just trust an old menu callback. */
  apply: () => void;
}

export function requestWholeTableTranspose(
  app: App,
  t: Translate,
  expected: StructuralTable,
  request: TableTransposeRequest,
): void {
  const hasActiveDraft = (): boolean =>
    request.draftRoot.querySelector("textarea.structural-tables-cell-editor") !== null;
  if (!request.isCurrent()) {
    new Notice(t("notice.staleTable"));
    return;
  }
  if (hasActiveDraft()) {
    new Notice(t("transpose.unsavedDraft"));
    return;
  }
  const plan = planTransposeTable(expected);
  if (!plan.result.changed) {
    new Notice(operationNotice(t, plan.result.code));
    return;
  }
  const commit = (): void => {
    if (!request.isCurrent()) {
      new Notice(t("notice.staleTable"));
      return;
    }
    if (hasActiveDraft()) {
      new Notice(t("transpose.unsavedDraft"));
      return;
    }
    request.apply();
  };
  if (plan.resetsColumnAlignment || plan.introducesStructuralSyntax) {
    new TableTransposeModal(app, t, plan, commit).open();
  } else commit();
}
