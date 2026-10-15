import { EditorView } from "@codemirror/view";
import { MarkdownView, editorInfoField, type App, type Editor } from "obsidian";

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

export function codeMirrorForEditor(container: HTMLElement, editor: Editor): EditorView | null {
  const roots = [...container.querySelectorAll<HTMLElement>(".cm-editor")];
  if (container.matches(".cm-editor")) roots.unshift(container);
  let result: EditorView | null = null;
  for (const root of roots) {
    const view = EditorView.findFromDOM(root);
    // Embedded editors can share the note container and even its Markdown.
    if (view?.state.field(editorInfoField, false)?.editor !== editor) continue;
    if (result !== null && result !== view) return null;
    result = view;
  }
  return result;
}

/** Read presentation only from the attached editor that owns this table. */
export function editorTableDirection(app: App, editor: Editor, table: StructuralTable, hint?: MarkdownView): "ltr" | "rtl" {
  const markdown = markdownViewForEditor(app, editor, hint);
  if (!markdown?.containerEl?.isConnected) return "ltr";
  const view = codeMirrorForEditor(markdown.containerEl, editor);
  if (view === null || !view.dom.isConnected || view.state.field(editorInfoField, false)?.file !== markdown.file
    || view.state.doc.toString() !== editor.getValue() || reparseUnchangedTable(editor.getValue(), table) === null) return "ltr";

  const rendered: HTMLTableElement[] = [];
  for (const host of view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview, .cm-table-widget")) {
    if (EditorView.findFromDOM(host) !== view) continue;
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
