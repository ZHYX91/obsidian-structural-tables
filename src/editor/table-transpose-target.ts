import { Notice, type MarkdownView, type App, type Editor } from "obsidian";

import { operationNotice, type Translate } from "../config/i18n";
import type { StructuralTable } from "../core/model";
import { transposeTableInDocument } from "../core/table-transpose-validation";
import { requestWholeTableTranspose, type TableTransposeRequest } from "../app/table-transpose-modal";
import { captureEditorTableCommandTarget } from "./table-command-target";

/**
 * An editor, source offset, or matching Markdown alone does not prove file identity.
 * Capture an actual attached view and TFile before showing any confirmation.
 */
export function captureEditorTransposeTarget(
  app: App,
  editor: Editor,
  table: StructuralTable,
  t: Translate,
  viewHint?: MarkdownView,
  isActive: () => boolean = () => true,
): TableTransposeRequest | null {
  const target = captureEditorTableCommandTarget(app, editor, table, viewHint, isActive);
  if (target === null) return null;
  const apply = (): void => {
    const result = target.apply(transposeTableInDocument);
    if (result === null) {
      new Notice(t("notice.staleTable"));
      return;
    }
    new Notice(operationNotice(t, result.code));
  };
  return { ...target, apply };
}

export function openEditorTableTranspose(
  app: App,
  editor: Editor,
  table: StructuralTable,
  t: Translate,
  viewHint?: MarkdownView,
  isActive?: () => boolean,
): void {
  const target = captureEditorTransposeTarget(app, editor, table, t, viewHint, isActive);
  if (target === null) {
    new Notice(t("notice.staleTable"));
    return;
  }
  requestWholeTableTranspose(app, t, table, target);
}
