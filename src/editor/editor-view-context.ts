import { EditorView } from "@codemirror/view";
import { MarkdownView, editorInfoField, type App, type Editor, type TFile } from "obsidian";

import type { StructuralTable } from "../core/model";
import { reparseUnchangedTable } from "../core/table-snapshot";

export function markdownViewForEditor(app: App, editor: Editor, hint?: MarkdownView): MarkdownView | null {
  let result: MarkdownView | null = null;
  let ambiguous = false;
  app.workspace.iterateAllLeaves((leaf) => {
    if (!(leaf.view instanceof MarkdownView) || leaf.view.editor !== editor || (hint !== undefined && leaf.view !== hint)) return;
    if (result !== null && result !== leaf.view) ambiguous = true;
    result = leaf.view;
  });
  return ambiguous ? null : result;
}

export function codeMirrorForEditor(container: HTMLElement, editor: Editor, file: TFile | null): EditorView | null {
  const roots = [...container.querySelectorAll<HTMLElement>(".cm-editor")];
  if (container.matches(".cm-editor")) roots.unshift(container);
  const source = editor.getValue();
  const candidates = new Set<EditorView>();
  for (const root of roots) {
    const view = EditorView.findFromDOM(root);
    const info = view?.state.field(editorInfoField, false);
    // A native cell CM inherits the note's editor/file info, but its document
    // is only that cell. Both identity and the complete note must agree.
    if (view === null || view.dom !== root || !root.isConnected || root.ownerDocument !== container.ownerDocument
      || info?.editor !== editor || info.file !== file || view.state.doc.toString() !== source) continue;
    candidates.add(view);
  }
  // Even a byte-identical nested editor is owned by its matching full-note
  // ancestor. Separate peer full-note editors remain ambiguous and are refused.
  const owners = [...candidates].filter((candidate) => ![...candidates].some((other) =>
    other !== candidate && other.contentDOM.contains(candidate.dom)));
  return owners.length === 1 ? owners[0]! : null;
}

/** Read presentation only from the attached editor that owns this table. */
export function editorTableDirection(app: App, editor: Editor, table: StructuralTable, hint?: MarkdownView): "ltr" | "rtl" {
  const markdown = markdownViewForEditor(app, editor, hint);
  if (!markdown?.containerEl?.isConnected) return "ltr";
  const view = codeMirrorForEditor(markdown.containerEl, editor, markdown.file);
  if (view === null || !view.dom.isConnected || view.state.field(editorInfoField, false)?.file !== markdown.file
    || view.state.doc.toString() !== editor.getValue() || reparseUnchangedTable(editor.getValue(), table) === null) return "ltr";

  const rendered: HTMLTableElement[] = [];
  for (const host of view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview, .cm-table-widget")) {
    // findFromDOM(host) can discover a native cell's descendant .cm-content.
    // The nearest editor root proves which full-note editor owns the widget.
    if (host.closest(".cm-editor") !== view.dom) continue;
    let matches = host.dataset.structuralSourceTableIndex === String(table.sourceTableIndex);
    if (!matches && host.matches(".cm-table-widget")) {
      try {
        const offset = view.posAtDOM(host, 0);
        matches = offset >= table.range.from && offset < table.range.to;
      } catch { /* Unmapped native widgets cannot establish table identity. */ }
    }
    const element = host.querySelector<HTMLTableElement>("table");
    if (matches && element !== null) rendered.push(element);
  }
  const context = rendered.length === 1 ? rendered[0]! : view.contentDOM;
  return context.ownerDocument.defaultView?.getComputedStyle(context).direction === "rtl" ? "rtl" : "ltr";
}
