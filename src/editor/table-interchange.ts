import type { ImportedHtmlRow } from "../core/interchange";
import { importedHtmlTableToStructuralSource } from "../core/interchange";

function positiveSpan(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

const HTML_BLOCK_ELEMENTS = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "LI", "P", "PRE"]);

function appendHtmlCellText(node: Node, parts: string[]): void {
  if (node.nodeType === 3) {
    parts.push((node.textContent ?? "").replace(/\s+/gu, " "));
    return;
  }
  if (node.nodeType !== 1) return;
  const element = node as Element;
  if (element.tagName === "BR") {
    parts.push("\n");
    return;
  }
  const block = HTML_BLOCK_ELEMENTS.has(element.tagName);
  if (block && parts.length > 0 && !parts[parts.length - 1]?.endsWith("\n")) parts.push("\n");
  for (const child of node.childNodes) appendHtmlCellText(child, parts);
  if (block && !parts[parts.length - 1]?.endsWith("\n")) parts.push("\n");
}

function htmlCellText(cell: HTMLTableCellElement): string {
  const parts: string[] = [];
  for (const child of cell.childNodes) appendHtmlCellText(child, parts);
  return parts.join("").replace(/[ \t]*\n[ \t]*/gu, "\n").trim();
}

function clipboardTable(html: string): HTMLTableElement | null {
  let source = html;
  if (!/<table(?:\s|>)/iu.test(source)) {
    // Spreadsheet clipboard fragments can omit the surrounding table and rows.
    const fragment = /^\s*<(colgroup|col|thead|tbody|tfoot|tr|td|th)(?:\s|>)/iu.exec(source)?.[1]?.toLowerCase();
    if (fragment === undefined) return null;
    source = fragment === "td" || fragment === "th" ? `<tr>${source}</tr>` : source;
    source = `<table>${source}</table>`;
  }
  const document = new DOMParser().parseFromString(source, "text/html");
  const table = document.querySelector("table");
  return table instanceof HTMLTableElement ? table : null;
}

export function singleCellTextFromClipboardHtml(html: string): string | null {
  const table = clipboardTable(html);
  const cells = table?.querySelectorAll<HTMLTableCellElement>("td, th");
  const cell = cells?.length === 1 ? cells[0] : undefined;
  return cell === undefined ? null : htmlCellText(cell);
}

export function structuralSourceFromClipboardHtml(html: string): string | null {
  const table = clipboardTable(html);
  if (table === null) return null;
  const rows: ImportedHtmlRow[] = Array.from(table.rows).map((row) => {
    const section = row.parentElement?.tagName.toLowerCase() === "thead" ? "head" : "body";
    return {
      section,
      cells: Array.from(row.cells).map((cell) => ({
        text: htmlCellText(cell),
        rowSpan: positiveSpan(cell.rowSpan),
        columnSpan: positiveSpan(cell.colSpan),
        header: cell.tagName.toLowerCase() === "th",
      })),
    };
  });
  return importedHtmlTableToStructuralSource(rows);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export async function copyHtml(html: string, text: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || navigator.clipboard.write === undefined) {
    await copyText(text);
    return;
  }
  await navigator.clipboard.write([new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([text], { type: "text/plain" }),
  })]);
}
