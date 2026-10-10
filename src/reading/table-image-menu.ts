import { MarkdownView, Menu, Notice, TFile, type App, type Component } from "obsidian";

import type { ExportTableImage } from "../app/table-image-modal";
import type { Translate } from "../config/i18n";
import type { StructuralTable } from "../core/model";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { addImageExportMenuItem } from "../editor/table-menu";

export function installReadingImageMenu(app: App, wrapper: HTMLElement, table: StructuralTable,
  sourcePath: string, owner: Component, t: () => Translate, exportImage?: ExportTableImage): void {
  if (exportImage === undefined) return;
  let active = true;
  owner.register(() => { active = false; });
  owner.registerDomEvent(wrapper, "contextmenu", (event) => {
    const menu = Menu.forEvent(event);
    addImageExportMenuItem(menu, t(), () => {
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
        exportImage(table, sourcePath, isCurrent, wrapper);
      })().catch(() => { new Notice(t()("image.error.resource")); });
    });
  });
}
