import type { BaseEditorInfo } from "../app/base-promotion-service";
import type { ExportTableImage } from "../app/table-image-modal";
import type { PreviewPlainGfm } from "../app/plain-gfm-modal";
import { captureEditorPlainGfmTarget } from "./plain-gfm-target";
import { requestWholeTableTranspose } from "../app/table-transpose-modal";
import { captureEditorTransposeTarget } from "./table-transpose-target";
import { EditorView } from "@codemirror/view";
import { MarkdownView, Menu, Notice, editorInfoField, type App, type Component, type Editor } from "obsidian";

import { createTranslator, operationNotice } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { parseEditableTables } from "../core/parser";
import { reparseUnchangedTable, TableDocumentSnapshot } from "../core/table-snapshot";
import { validateTableOperationInDocument } from "../core/table-operation-document";

import { nativeTableDomSelection } from "./native-table-selection";
import {
  addBasePromotionMenuItem,
  addImageExportMenuItem,
  addPlainGfmMenuItem,
  addSelectionMenuItems,
  addWholeTableTransposeMenuItem,
  hasSelectionMenuItems,
  type TableOperation,
} from "./table-menu";
import { replaceTableSource } from "./table-replacement";
import { structuralTableSelectionFromCoordinates } from "./table-selection";
import { attachedEditorContext } from "./editor-view-context";
import { addEditorTableHtmlCopyMenuItem } from "./table-html-menu";

export class NativeTableMenuBridge {
  private readonly contributedEvents = new WeakSet<Event>();
  private disposed = false;
  private readonly documentCleanups = new Map<Document, () => void>();
  private readonly registeredTargets = new WeakSet<HTMLElement>();
  private readonly targetCleanups = new Map<HTMLElement, () => void>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote: (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable) => void,
    private readonly exportImage?: ExportTableImage,
    private readonly previewGfm?: PreviewPlainGfm,
  ) {}

  register(component: Component): void {
    this.disposed = false;
    component.register(() => {
      this.disposed = true;
      for (const cleanup of [...this.documentCleanups.values()]) cleanup();
    });
    this.registerDocument(document);
    // A popout can predate plugin enable/re-enable: it will not emit a new
    // window-open event. A canvas, PDF or empty leaf can later become Markdown,
    // so observe every existing view's owner document before that transition.
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.registerDocument(leaf.view.containerEl.ownerDocument);
    });
    component.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, window) => {
      this.registerDocument(window.document);
    }));
    component.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, window) => {
      this.documentCleanups.get(window.document)?.();
    }));
  }

  private registerDocument(targetDocument: Document): void {
    if (this.documentCleanups.has(targetDocument)) return;
    this.registerNativeTargets(targetDocument);
    const Observer = targetDocument.defaultView?.MutationObserver;
    const observer = Observer === undefined ? undefined : new Observer((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node.nodeType === 1) this.unregisterNativeTargets(node as Element);
        }
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) this.registerNativeTargets(node as Element);
        }
      }
    });
    if (targetDocument.body !== null) observer?.observe(targetDocument.body, { childList: true, subtree: true });
    this.documentCleanups.set(targetDocument, () => {
      observer?.disconnect();
      // Closing a window does not produce a cell-removal mutation. Include
      // detached cells whose observer records have not been delivered yet.
      for (const [target, cleanup] of [...this.targetCleanups]) {
        if (target.ownerDocument === targetDocument) cleanup();
      }
      this.documentCleanups.delete(targetDocument);
    });
  }

  private registerNativeTargets(root: ParentNode): void {
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
      const listener = (event: MouseEvent): void => this.contribute(event);
      target.addEventListener("contextmenu", listener);
      const cleanup = (): void => {
        target.removeEventListener("contextmenu", listener);
        this.targetCleanups.delete(target);
        this.registeredTargets.delete(target);
      };
      this.targetCleanups.set(target, cleanup);
    }
  }

  private unregisterNativeTargets(root: ParentNode): void {
    const targets = [
      ...(("matches" in root) ? [root as HTMLElement] : []),
      ...root.querySelectorAll<HTMLElement>("th, td"),
    ];
    for (const target of targets) this.targetCleanups.get(target)?.();
  }

  private contribute(event: MouseEvent): void {
    if (this.contributedEvents.has(event)) return;
    const domSelection = nativeTableDomSelection(event);
    if (domSelection === null) return;
    const target = this.targetForWidget(domSelection.widget);
    if (target === null) return;
    const { markdown: markdownView, table } = target;
    if (!table.valid || domSelection.tableElement.rows.length !== table.rows.length) return;
    const selection = structuralTableSelectionFromCoordinates(table, domSelection.coordinates);
    if (selection === null || !selection.rectangular) return;
    this.contributedEvents.add(event);
    const menu = Menu.forEvent(event);
    const t = createTranslator(this.getSettings().language);
    if (hasSelectionMenuItems(selection)) {
      addSelectionMenuItems(
        menu, t, selection,
        (operation) => { if (target.isCurrent()) this.applyMenuOperation(markdownView.editor, table, operation); },
        { defaultSourceSyntax: this.getSettings().defaultSourceSyntax },
      );
    }
    const transposeTarget = captureEditorTransposeTarget(
      this.app, markdownView.editor, table, t, markdownView, () => !this.disposed && target.isCurrent(),
    );
    addWholeTableTransposeMenuItem(menu, t, () => {
      if (transposeTarget === null) { new Notice(t("notice.staleTable")); return; }
      requestWholeTableTranspose(this.app, t, table, transposeTarget);
    });
    if (this.previewGfm !== undefined) {
      const gfmTarget = captureEditorPlainGfmTarget(this.app, markdownView.editor, table, markdownView,
        () => !this.disposed && target.isCurrent());
      addPlainGfmMenuItem(menu, t, () => {
        if (gfmTarget === null) { new Notice(t("notice.staleTable")); return; }
        this.previewGfm?.(table, gfmTarget);
      });
    }
    addEditorTableHtmlCopyMenuItem(menu, this.app, markdownView.editor, table, this.getSettings, markdownView,
      () => !this.disposed && target.isCurrent());
    if (this.exportImage !== undefined) {
      const sourcePath = markdownView.file?.path ?? "";
      addImageExportMenuItem(menu, t, () => this.exportImage?.(table, sourcePath,
        () => !this.disposed && target.isCurrent()
          && reparseUnchangedTable(markdownView.editor.getValue(), table) !== null, domSelection.tableElement));
    }
    addBasePromotionMenuItem(menu, t, table, () => {
      if (!this.disposed && target.isCurrent()) this.promote(markdownView.editor, () => markdownView, table);
    });
  }

  private targetForWidget(widget: HTMLElement) {
    // Resolve the widget's parent editor, never its descendant native cell CM.
    const root = widget.closest<HTMLElement>(".cm-editor");
    const codeMirror = root === null ? null : EditorView.findFromDOM(root);
    const info = codeMirror?.state.field(editorInfoField, false);
    if (codeMirror === null || codeMirror.dom !== root || info?.editor === undefined || info.file == null) return null;
    const matches: MarkdownView[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.editor === info.editor && leaf.view.file === info.file
        && leaf.view.containerEl.ownerDocument === widget.ownerDocument && leaf.view.containerEl.contains(root)) matches.push(leaf.view);
    });
    if (matches.length !== 1) return null;
    const context = attachedEditorContext(this.app, info.editor, matches[0]);
    if (context === null || context.view !== codeMirror) return null;
    try {
      const offset = codeMirror.posAtDOM(widget, 0);
      const table = parseEditableTables(info.editor.getValue()).tables.find((candidate) => offset >= candidate.range.from && offset < candidate.range.to);
      return table === undefined ? null : { ...context, table };
    } catch {
      // Without a mapped widget position, the current cursor proves nothing
      // about which of several identical tables the user clicked.
      return null;
    }
  }

  private applyMenuOperation(editor: Editor, expected: StructuralTable, operation: TableOperation): void {
    const t = createTranslator(this.getSettings().language);
    const snapshot = new TableDocumentSnapshot(editor.getValue());
    const current = reparseUnchangedTable(snapshot, expected);
    if (current === null) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const result = validateTableOperationInDocument(snapshot, current, operation(current));
    if (editor.getValue() !== snapshot.source) {
      new Notice(t("notice.staleTable"));
      return;
    }
    if (result.changed) {
      replaceTableSource(editor, current, result.source);
    }
    new Notice(operationNotice(t, result.code));
  }
}
