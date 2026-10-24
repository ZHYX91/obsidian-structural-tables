import type { MarkdownView, App, Editor, TFile } from "obsidian";

import type { StructuralTable } from "../core/model";
import type { OperationResult } from "../core/operations";
import { reparseUnchangedTable, TableDocumentSnapshot } from "../core/table-snapshot";
import { validateTableOperationInDocument } from "../core/table-operation-document";
import { codeMirrorForEditor, markdownViewForEditor } from "./editor-view-context";
import { tableWriteHistory } from "./table-history";

export interface EditorTableCommandTarget {
  ownerDocument: Document;
  draftRoot: ParentNode;
  sourcePath: string;
  isCurrent: () => boolean;
  apply: (operation: (source: string, table: StructuralTable) => OperationResult) => OperationResult | null;
}

/** Capture the attached editor/file/model, never a cursor or a table's DOM ordinal. */
export function captureEditorTableCommandTarget(app: App, editor: Editor, table: StructuralTable,
  viewHint?: MarkdownView, isActive: () => boolean = () => true): EditorTableCommandTarget | null {
  const captured = markdownViewForEditor(app, editor, viewHint);
  if (captured === null) return null;
  const file: TFile | null = captured.file;
  if (file === null || !captured.containerEl.isConnected) return null;
  const path = file.path;
  const container = captured.containerEl;
  const ownerDocument = container.ownerDocument;
  const codeMirror = codeMirrorForEditor(container, editor, file);
  if (codeMirror === null) return null;
  const bindingIsCurrent = (): boolean => {
    if (!isActive() || captured.file !== file || captured.editor !== editor
      || file.path !== path || !container.isConnected || container.ownerDocument !== ownerDocument
      || app.vault.getFileByPath(path) !== file) return false;
    if (codeMirrorForEditor(container, editor, file) !== codeMirror
      || codeMirror.state.doc.toString() !== editor.getValue()) return false;
    let hasView = false;
    app.workspace.iterateAllLeaves((leaf) => { if (leaf.view === captured) hasView = true; });
    return hasView;
  };
  const isCurrent = (): boolean => bindingIsCurrent() && reparseUnchangedTable(editor.getValue(), table) !== null;
  return {
    ownerDocument, draftRoot: container, sourcePath: path, isCurrent,
    apply: (operation) => {
      if (!bindingIsCurrent()) return null;
      const source = editor.getValue();
      const snapshot = new TableDocumentSnapshot(source);
      const current = reparseUnchangedTable(snapshot, table);
      if (current === null) return null;
      const result = validateTableOperationInDocument(snapshot, current, operation(source, current));
      if (!bindingIsCurrent() || editor.getValue() !== source) return null;
      if (result.changed) {
        codeMirror.dispatch({
          changes: { from: current.range.from, to: current.range.to, insert: result.source },
          selection: { anchor: current.range.from + result.source.length },
          ...tableWriteHistory(current, result.source, path, { row: 0, column: 0 }, { restorePresentation: true }),
        });
        codeMirror.focus();
      }
      return result;
    },
  };
}
