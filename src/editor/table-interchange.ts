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

export function structuralSourceFromClipboardHtml(html: string): string | null {
  if (!/<table(?:\s|>)/iu.test(html)) return null;
  const document = new DOMParser().parseFromString(html, "text/html");
  const table = document.querySelector("table");
  if (!(table instanceof HTMLTableElement)) return null;
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

export async function copyHtml(html: string): Promise<void> {
  if (typeof ClipboardItem === "undefined" || navigator.clipboard.write === undefined) {
    await copyText(html);
    return;
  }
  await navigator.clipboard.write([new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([html], { type: "text/plain" }),
  })]);
}
