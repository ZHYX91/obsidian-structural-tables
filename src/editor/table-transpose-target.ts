import { MarkdownView, Notice, type App, type Editor, type TFile } from "obsidian";

import { operationNotice, type Translate } from "../config/i18n";
import type { StructuralTable } from "../core/model";
import { transposeTable } from "../core/operations";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { requestWholeTableTranspose, type TableTransposeRequest } from "../app/table-transpose-modal";
import { replaceTableSource } from "./table-replacement";

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
  let view: MarkdownView | null = null;
  let ambiguous = false;
  app.workspace.iterateAllLeaves((leaf) => {
    if (!(leaf.view instanceof MarkdownView) || leaf.view.editor !== editor
      || (viewHint !== undefined && leaf.view !== viewHint)) return;
    if (view !== null && view !== leaf.view) ambiguous = true;
    view = leaf.view;
  });
  if (ambiguous || view === null) return null;
  const captured: MarkdownView = view;
  const file: TFile | null = captured.file;
  if (file === null || !captured.containerEl.isConnected) return null;
  const path = file.path;
  const container = captured.containerEl;
  const ownerDocument = container.ownerDocument;
  const isCurrent = (): boolean => {
    if (!isActive() || captured.file !== file || captured.editor !== editor
      || file.path !== path || !container.isConnected || container.ownerDocument !== ownerDocument
      || app.vault.getFileByPath(path) !== file) return false;
    let hasView = false;
    app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view === captured) hasView = true;
    });
    return hasView && reparseUnchangedTable(editor.getValue(), table) !== null;
  };
  const apply = (): void => {
    if (!isCurrent()) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const current = reparseUnchangedTable(editor.getValue(), table);
    if (current === null) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const result = transposeTable(current);
    if (result.changed) replaceTableSource(editor, current, result.source);
    new Notice(operationNotice(t, result.code));
  };
  return { ownerDocument, draftRoot: container, isCurrent, apply };
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
