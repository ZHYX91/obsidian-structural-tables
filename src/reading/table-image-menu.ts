import { Menu, Notice, TFile, type App, type Component } from "obsidian";

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
        const isCurrent = (): boolean => active && wrapper.isConnected && file.path === sourcePath;
        if (!isCurrent() || reparseUnchangedTable(source, table) === null) {
          new Notice(t()("notice.staleTable")); return;
        }
        exportImage(table, sourcePath, isCurrent, wrapper);
      })().catch(() => { new Notice(t()("image.error.resource")); });
    });
  });
}
