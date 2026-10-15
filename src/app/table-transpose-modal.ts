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

export function requestWholeTableTranspose(
  app: App,
  t: Translate,
  expected: StructuralTable,
  apply: () => void,
  ownerDocument?: Document,
): void {
  const doc = ownerDocument ?? app.workspace.containerEl.ownerDocument;
  const hasActiveDraft = (): boolean =>
    doc.querySelector("textarea.structural-tables-cell-editor") !== null;
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
    if (hasActiveDraft()) {
      new Notice(t("transpose.unsavedDraft"));
      return;
    }
    // Every caller must reparse and compare its frozen table when committing.
    apply();
  };
  if (plan.resetsColumnAlignment || plan.introducesStructuralSyntax) {
    new TableTransposeModal(app, t, plan, commit).open();
  } else commit();
}
