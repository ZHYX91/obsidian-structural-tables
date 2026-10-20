import { MarkdownView, Menu, Notice, TFile, type App, type Component } from "obsidian";

import type { ExportTableImage } from "../app/table-image-modal";
import type { PreviewPlainGfm } from "../app/plain-gfm-modal";
import { copyTableForWord } from "../app/table-html-copy";
import type { Translate } from "../config/i18n";
import type { StructuralTable } from "../core/model";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { addImageExportMenuItem, addPlainGfmMenuItem, addTableHtmlCopyMenuItem } from "../editor/table-menu";

/** The table, not its outer wrapper, owns a table-specific direction override. */
export function readingImageStyleElement(wrapper: HTMLElement): HTMLTableElement | null {
  return wrapper.querySelector<HTMLTableElement>("table.structural-tables-table");
}

export function installReadingOutputMenu(app: App, wrapper: HTMLElement, table: StructuralTable,
  sourcePath: string, owner: Component, t: () => Translate, exportImage?: ExportTableImage, previewGfm?: PreviewPlainGfm): void {
  let active = true;
  owner.register(() => { active = false; });
  owner.registerDomEvent(wrapper, "contextmenu", (event) => {
    const origin = event.target as Element | null;
    const clickedTable = origin?.nodeType === 1 ? origin.closest("table") : null;
    if (clickedTable !== null && clickedTable !== readingImageStyleElement(wrapper)) return;
    const menu = Menu.forEvent(event);
    const file = app.vault.getAbstractFileByPath(sourcePath);
    const document = wrapper.ownerDocument;
    let sourceView: MarkdownView | undefined;
    app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.file === file && leaf.view.containerEl.contains(wrapper)) sourceView = leaf.view;
    });
    const ownsTarget = (): boolean => active && wrapper.isConnected && wrapper.ownerDocument === document
      && file instanceof TFile && file.path === sourcePath && app.vault.getAbstractFileByPath(sourcePath) === file
      && (sourceView === undefined || sourceView.file === file && sourceView.containerEl.contains(wrapper));
    const isCurrent = async (): Promise<boolean> => {
      if (!(file instanceof TFile) || !ownsTarget()) return false;
      const source = await app.vault.cachedRead(file);
      return ownsTarget() && reparseUnchangedTable(source, table) !== null;
    };
    const direction = document.defaultView?.getComputedStyle(readingImageStyleElement(wrapper) ?? wrapper).direction === "rtl" ? "rtl" : "ltr";
    if (previewGfm !== undefined) addPlainGfmMenuItem(menu, t(), () => {
      // No replacement callback exists in a reading target. Re-read before
      // opening and copying; a saved source change invalidates this snapshot.
      previewGfm(table, {
        sourcePath, ownerDocument: document, draftRoot: wrapper,
        direction, isCurrent,
      });
    });
    addTableHtmlCopyMenuItem(menu, t(), () => {
      const appearance = wrapper.dataset.appearance;
      void copyTableForWord(app, table, appearance === "grid" || appearance === "three-line" ? appearance : "theme",
        { sourcePath, direction, isCurrent }, t());
    });
    if (exportImage !== undefined) addImageExportMenuItem(menu, t(), () => {
      void (async () => {
        const file = app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile)) { new Notice(t()("notice.staleTable")); return; }
        const source = await app.vault.cachedRead(file);
        if (!active || !wrapper.isConnected || file.path !== sourcePath || reparseUnchangedTable(source, table) === null) {
          new Notice(t()("notice.staleTable")); return;
        }
        let sourceView: MarkdownView | undefined;
        app.workspace.iterateAllLeaves((leaf) => {
          if (leaf.view instanceof MarkdownView && leaf.view.file?.path === sourcePath && leaf.view.containerEl.contains(wrapper)) sourceView = leaf.view;
        });
        const surface = wrapper.closest(".markdown-preview-view, .internal-embed, .markdown-embed") ?? wrapper;
        // The verified model and Vault subscriptions own the PNG session. A
        // host rerender may replace this render child without changing its note.
        const isCurrent = (): boolean => file.path === sourcePath && (sourceView === undefined
          ? surface.isConnected : sourceView.containerEl.isConnected && sourceView.file?.path === sourcePath);
        const styleElement = readingImageStyleElement(wrapper);
        if (styleElement === null) { new Notice(t()("notice.staleTable")); return; }
        exportImage(table, sourcePath, isCurrent, styleElement);
      })().catch(() => { new Notice(t()("image.error.resource")); });
    });
  });
}

// Keep the old internal entry point available for existing image-menu callers.
export const installReadingImageMenu = installReadingOutputMenu;
