import { isolateHistory } from "@codemirror/commands";
import type { MarkdownView, App, Editor, TFile } from "obsidian";

import type { StructuralTable } from "../core/model";
import type { OperationResult } from "../core/operations";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { validateTableOperationInDocument } from "../core/table-operation-document";
import { codeMirrorForEditor, markdownViewForEditor } from "./editor-view-context";

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
  const isCurrent = (): boolean => {
    if (!isActive() || captured.file !== file || captured.editor !== editor
      || file.path !== path || !container.isConnected || container.ownerDocument !== ownerDocument
      || app.vault.getFileByPath(path) !== file) return false;
    if (codeMirrorForEditor(container, editor, file) !== codeMirror
      || codeMirror.state.doc.toString() !== editor.getValue()) return false;
    let hasView = false;
    app.workspace.iterateAllLeaves((leaf) => { if (leaf.view === captured) hasView = true; });
    return hasView && reparseUnchangedTable(editor.getValue(), table) !== null;
  };
  return {
    ownerDocument, draftRoot: container, sourcePath: path, isCurrent,
    apply: (operation) => {
      if (!isCurrent()) return null;
      const source = editor.getValue();
      const current = reparseUnchangedTable(source, table);
      if (current === null) return null;
      const result = validateTableOperationInDocument(source, current, operation(source, current));
      if (result.changed) {
        // The host Editor owns note history, including native-table editors.
        // A direct CM change can update the note without entering that history.
        codeMirror.dispatch({ annotations: isolateHistory.of("full") });
        editor.transaction({ changes: [{
          from: editor.offsetToPos(current.range.from),
          to: editor.offsetToPos(current.range.to),
          text: result.source,
        }] }, "structural-tables");
        codeMirror.dispatch({
          selection: { anchor: current.range.from + result.source.length },
          annotations: isolateHistory.of("full"),
        });
        codeMirror.focus();
      }
      return result;
    },
  };
}
