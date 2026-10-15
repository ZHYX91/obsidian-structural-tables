import { isolateHistory } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { MarkdownView, Notice, editorInfoField, type App, type Editor, type TFile } from "obsidian";

import { operationNotice, type Translate } from "../config/i18n";
import type { StructuralTable } from "../core/model";
import { transposeTable } from "../core/operations";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { requestWholeTableTranspose, type TableTransposeRequest } from "../app/table-transpose-modal";

function codeMirrorForEditor(container: HTMLElement, editor: Editor): EditorView | null {
  const roots = [...container.querySelectorAll<HTMLElement>(".cm-editor")];
  if (container.matches(".cm-editor")) roots.unshift(container);
  for (const root of roots) {
    const view = EditorView.findFromDOM(root);
    // Embedded editors can share the note container. Match the host's editor
    // identity rather than choosing the first DOM editor or matching text.
    if (view?.state.field(editorInfoField, false)?.editor === editor) return view;
  }
  return null;
}

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
  const codeMirror = codeMirrorForEditor(container, editor);
  if (codeMirror === null) return null;
  const isCurrent = (): boolean => {
    if (!isActive() || captured.file !== file || captured.editor !== editor
      || file.path !== path || !container.isConnected || container.ownerDocument !== ownerDocument
      || app.vault.getFileByPath(path) !== file) return false;
    if (codeMirrorForEditor(container, editor) !== codeMirror
      || codeMirror.state.doc.toString() !== editor.getValue()) return false;
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
    if (result.changed) {
      codeMirror.dispatch({
        changes: { from: current.range.from, to: current.range.to, insert: result.source },
        selection: { anchor: current.range.from + result.source.length },
        // A command is one host-history operation, separate from typing on
        // either side, even when confirmation follows the last keystroke.
        annotations: isolateHistory.of("full"),
      });
      // The confirmation closes before applying and can leave focus on the
      // document body. Return keyboard undo/redo to this verified editor.
      codeMirror.focus();
    }
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
