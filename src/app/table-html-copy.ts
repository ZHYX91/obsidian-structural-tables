import { Notice, type App } from "obsidian";

import type { Translate } from "../config/i18n";
import type { TableAppearance } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { copyHtml } from "../editor/table-interchange";
import { renderTableClipboard } from "../rendering/table-clipboard";

export interface TableHtmlCopyTarget {
  sourcePath: string;
  direction: "ltr" | "rtl";
  isCurrent: () => boolean | Promise<boolean>;
}

/** Recheck the captured table after asynchronous rendering, before touching the clipboard. */
export async function copyTableForWord(app: App, table: StructuralTable, appearance: TableAppearance,
  target: TableHtmlCopyTarget, t: Translate): Promise<void> {
  try {
    if (!await target.isCurrent()) { new Notice(t("notice.staleTable")); return; }
    const { html, text } = await renderTableClipboard(app, table, target.sourcePath, appearance, target.direction);
    if (!await target.isCurrent()) { new Notice(t("notice.staleTable")); return; }
    const mode = await copyHtml(html, text);
    new Notice(mode === "plain" ? t("notice.copiedHtmlPlain") : t("notice.copied").replace("{format}", "HTML"));
  } catch { new Notice(t("notice.clipboardFailed")); }
}
