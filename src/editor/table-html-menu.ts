import { Notice, type App, type Editor, type MarkdownView, type Menu } from "obsidian";

import { copyTableForWord } from "../app/table-html-copy";
import { createTranslator } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { editorTableDirection } from "./editor-view-context";
import { captureEditorTableCommandTarget } from "./table-command-target";
import { addTableHtmlCopyMenuItem } from "./table-menu";

export function addEditorTableHtmlCopyMenuItem(menu: Menu, app: App, editor: Editor, table: StructuralTable,
  getSettings: () => StructuralTablesSettings, viewHint?: MarkdownView, isActive: () => boolean = () => true): void {
  const target = captureEditorTableCommandTarget(app, editor, table, viewHint, isActive);
  const t = createTranslator(getSettings().language);
  const direction = editorTableDirection(app, editor, table, viewHint);
  addTableHtmlCopyMenuItem(menu, t, () => {
    if (target === null) { new Notice(t("notice.staleTable")); return; }
    void copyTableForWord(app, table, getSettings().appearance, { ...target, direction }, t);
  });
}
