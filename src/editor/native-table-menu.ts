import { EditorView } from "@codemirror/view";
import { MarkdownView, Menu, Notice, type App, type Component, type Editor, type TFile } from "obsidian";

import { createTranslator, operationNotice } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { parseEditableTables } from "../core/parser";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { nativeTableDomSelection } from "./native-table-selection";
import {
  addBasePromotionMenuItem,
  addSelectionMenuItems,
  hasSelectionMenuItems,
  type TableOperation,
} from "./table-menu";
import { replaceTableSource } from "./table-replacement";
import { structuralTableSelectionFromCoordinates } from "./table-selection";

export class NativeTableMenuBridge {
  private readonly contributedEvents = new WeakSet<Event>();
  private readonly registeredDocuments = new WeakSet<Document>();
  private readonly registeredTargets = new WeakSet<HTMLElement>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote: (editor: Editor, sourceFile: TFile | null, table: StructuralTable) => void,
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
    this.registerNativeTargets(component, targetDocument);
    const Observer = targetDocument.defaultView?.MutationObserver;
    if (Observer === undefined || targetDocument.body === null) return;
    const observer = new Observer((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) this.registerNativeTargets(component, node as Element);
        }
      }
    });
    observer.observe(targetDocument.body, { childList: true, subtree: true });
    component.register(() => observer.disconnect());
  }

  private registerNativeTargets(component: Component, root: ParentNode): void {
    // Obsidian builds this menu in each cell's own listener instead of emitting editor-menu.
    // Registering after the native listener lets Menu.forEvent reuse that menu without replacing it.
    const selector = ".cm-table-widget th, .cm-table-widget td";
    const targets = [
      ...(("matches" in root && (root as Element).matches(selector)) ? [root as HTMLElement] : []),
      ...root.querySelectorAll<HTMLElement>(selector),
    ];
    for (const target of targets) {
      if (this.registeredTargets.has(target)) continue;
      this.registeredTargets.add(target);
      component.registerDomEvent(target, "contextmenu", (event) => this.contribute(event));
    }
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
    if (selection === null || !selection.rectangular) return;
    this.contributedEvents.add(event);
    const menu = Menu.forEvent(event);
    const t = createTranslator(this.getSettings().language);
    addBasePromotionMenuItem(menu, t, table, () => this.promote(markdownView.editor, markdownView.file, table));
    if (hasSelectionMenuItems(selection)) {
      addSelectionMenuItems(
        menu,
        t,
        selection,
        (operation) => this.applyMenuOperation(markdownView.editor, table, operation),
      );
    }
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
