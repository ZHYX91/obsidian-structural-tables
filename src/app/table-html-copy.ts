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

/** Word/HTML entries and direct text-copy commands share the latest intent. */
export class TableCopySession {
  private active = true;
  private request: object | undefined;

  begin(): () => boolean {
    const request = this.request = {};
    return () => this.active && this.request === request;
  }

  dispose(): void { this.active = false; this.request = undefined; }
}

const sessions = new WeakMap<App, TableCopySession>();

export function tableCopySession(app: App): TableCopySession {
  let session = sessions.get(app);
  if (session === undefined) { session = new TableCopySession(); sessions.set(app, session); }
  return session;
}

export function startTableCopySession(app: App): TableCopySession {
  sessions.get(app)?.dispose();
  const session = new TableCopySession();
  sessions.set(app, session);
  return session;
}

/** Recheck the captured table after asynchronous rendering, before touching the clipboard. */
export async function copyTableForWord(app: App, table: StructuralTable, appearance: TableAppearance,
  target: TableHtmlCopyTarget, t: Translate, session = tableCopySession(app)): Promise<void> {
  const isCurrent = session.begin();
  if (!isCurrent()) return;
  try {
    const before = await target.isCurrent();
    if (!isCurrent()) return;
    if (!before) { new Notice(t("notice.staleTable")); return; }
    const { html, text } = await renderTableClipboard(app, table, target.sourcePath, appearance, target.direction, isCurrent);
    const after = await target.isCurrent();
    if (!isCurrent()) return;
    if (!after) { new Notice(t("notice.staleTable")); return; }
    const mode = await copyHtml(html, text);
    if (!isCurrent()) return;
    new Notice(mode === "plain" ? t("notice.copiedHtmlPlain") : t("notice.copied").replace("{format}", "HTML"));
  } catch { if (isCurrent()) new Notice(t("notice.clipboardFailed")); }
}
