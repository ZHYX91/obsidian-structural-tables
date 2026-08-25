import { EditorView } from "@codemirror/view";
import { MarkdownView, Menu, Notice, type App, type Component, type Editor } from "obsidian";

import { createTranslator, operationNotice } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { parseEditableTables } from "../core/parser";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { nativeTableDomSelection } from "./native-table-selection";
import { addSelectionMenuItems, hasSelectionMenuItems, type TableOperation } from "./table-menu";
import { replaceTableSource } from "./table-replacement";
import { structuralTableSelectionFromCoordinates } from "./table-selection";

export class NativeTableMenuBridge {
  private readonly contributedEvents = new WeakSet<Event>();
  private readonly registeredDocuments = new WeakSet<Document>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
  ) {}

  register(component: Component): void {
    this.registerDocument(component, document);
    component.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, window) => {
      this.registerDocument(component, window.document);
    }));
  }

  private registerDocument(component: Component, targetDocument: Document): void {
    if (this.registeredDocuments.has(targetDocument)) return;
    this.registeredDocuments.add(targetDocument);
    component.registerDomEvent(targetDocument, "contextmenu", (event) => {
      const target = event.target;
      if (target !== null && "closest" in target
        && (target as Element).closest(".table-row-drag-handle, .table-col-drag-handle") !== null) {
        this.contribute(event);
      }
    }, { capture: true });
    component.registerDomEvent(targetDocument, "contextmenu", (event) => {
      this.contribute(event);
    });
  }

  private contribute(event: MouseEvent): void {
    if (this.contributedEvents.has(event)) return;
    const domSelection = nativeTableDomSelection(event);
    if (domSelection === null) return;
    const markdownView = this.markdownViewFor(domSelection.widget);
    if (markdownView === null) return;
    const table = this.tableForWidget(markdownView.editor, domSelection.widget);
    if (table === null || !table.valid || domSelection.tableElement.rows.length !== table.rows.length) return;
    const selection = structuralTableSelectionFromCoordinates(table, domSelection.coordinates);
    if (selection === null || !selection.rectangular || !hasSelectionMenuItems(selection)) return;

    this.contributedEvents.add(event);
    const menu = Menu.forEvent(event);
    addSelectionMenuItems(
      menu,
      createTranslator(this.getSettings().language),
      selection,
      (operation) => this.applyMenuOperation(markdownView.editor, table, operation),
    );
  }

  private markdownViewFor(target: Node): MarkdownView | null {
    let found: MarkdownView | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found === null && leaf.view instanceof MarkdownView && leaf.view.containerEl.contains(target)) {
        found = leaf.view;
      }
    });
    return found;
  }

  private tableForWidget(editor: Editor, widget: HTMLElement): StructuralTable | null {
    const source = editor.getValue();
    const tables = parseEditableTables(source).tables;
    const offsets: number[] = [];
    const codeMirror = EditorView.findFromDOM(widget);
    if (codeMirror !== null) {
      try {
        offsets.push(codeMirror.posAtDOM(widget, 0));
      } catch {
        // The cursor fallback below still identifies the table after native cell selection.
      }
    }
    offsets.push(editor.posToOffset(editor.getCursor()));
    for (const offset of offsets) {
      const table = tables.find((candidate) => offset >= candidate.range.from && offset <= candidate.range.to);
      if (table !== undefined) return table;
    }
    return null;
  }

  private applyMenuOperation(editor: Editor, expected: StructuralTable, operation: TableOperation): void {
    const t = createTranslator(this.getSettings().language);
    const current = reparseUnchangedTable(editor.getValue(), expected);
    if (current === null) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const result = operation(current);
    if (result.changed) {
      replaceTableSource(editor, current, result.source);
    }
    new Notice(operationNotice(t, result.code));
  }
}
