import type { Editor } from "obsidian";

import type { ImportedHtmlRow } from "../core/interchange";
import { importedHtmlTableToStructuralSource } from "../core/interchange";

function positiveSpan(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

const HTML_BLOCK_ELEMENTS = new Set(["ADDRESS", "ARTICLE", "BLOCKQUOTE", "DIV", "LI", "P"]);

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

interface ClipboardTable {
  document: Document;
  table: HTMLTableElement;
}

function parsedClipboardTable(html: string): ClipboardTable | null {
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
  return table instanceof HTMLTableElement ? { document, table } : null;
}

const NON_TEXT_CONTENT = "svg, math, mjx-container, img, .internal-embed, a[href], video, audio, canvas, iframe, object, input, textarea, select, button, script, pre, sup, sub";

function hasUnsupportedCellContent(table: HTMLTableElement): boolean {
  return table.querySelector(NON_TEXT_CONTENT) !== null
    // Text-node whitespace normalization is not a TeX parser. Preserve the
    // clipboard's original plain-text alternative for source math as well.
    || (table.textContent ?? "").includes("$")
    || Array.from(table.querySelectorAll("caption")).some((caption) => (caption.textContent ?? "").trim() !== "");
}

function hasMeaningfulContentOutsideTable(document: Document): boolean {
  if (document.querySelectorAll("table").length !== 1) return true;
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelector("table")?.remove();
  if ((clone.textContent ?? "").trim() !== "") return true;
  return clone.querySelector(
    "img, svg, math, mjx-container, video, audio, canvas, iframe, object, input, textarea, select, button",
  ) !== null;
}

export function singleCellTextFromClipboardHtml(html: string): string | null {
  const parsed = parsedClipboardTable(html);
  if (parsed === null || hasMeaningfulContentOutsideTable(parsed.document) || hasUnsupportedCellContent(parsed.table)) return null;
  const cells = parsed.table.querySelectorAll<HTMLTableCellElement>("td, th");
  const cell = cells?.length === 1 ? cells[0] : undefined;
  if (cell === undefined) return null;
  return htmlCellText(cell);
}

export type CellClipboardText =
  | { kind: "text"; text: string; fallback: boolean }
  | { kind: "empty" }
  | { kind: "unsupported" };

/** An unsupported HTML payload must never erase the editor selection. */
export function cellClipboardText(html: string, plain: string): CellClipboardText {
  const extracted = html === "" ? null : singleCellTextFromClipboardHtml(html);
  if (extracted !== null && extracted !== "") return { kind: "text", text: extracted, fallback: false };
  if (plain !== "") return { kind: "text", text: plain, fallback: html !== "" };
  if (extracted === "") return { kind: "empty" };
  return { kind: "unsupported" };
}

function rowSpanForClipboardCell(cell: HTMLTableCellElement, row: HTMLTableRowElement): number {
  if ((cell.getAttribute("rowspan") ?? "").trim() !== "0") return positiveSpan(cell.rowSpan);
  const siblings = Array.from(row.parentElement?.children ?? [])
    .filter((candidate): candidate is HTMLTableRowElement => candidate.tagName === "TR");
  const index = siblings.indexOf(row);
  return index < 0 ? 1 : Math.max(1, siblings.length - index);
}

function hasMeaningfulTableContent(table: HTMLTableElement): boolean {
  return Array.from(table.querySelectorAll<HTMLTableCellElement>("td, th"))
    .some((cell) => htmlCellText(cell) !== "");
}

export function structuralSourceFromClipboardHtml(html: string): string | null {
  const parsed = parsedClipboardTable(html);
  if (
    parsed === null
    || hasMeaningfulContentOutsideTable(parsed.document)
    || hasUnsupportedCellContent(parsed.table)
    || !hasMeaningfulTableContent(parsed.table)
  ) return null;
  const { table } = parsed;
  const rows: ImportedHtmlRow[] = Array.from(table.rows).map((row) => {
    const section = row.parentElement?.tagName.toLowerCase() === "thead" ? "head" : "body";
    return {
      section,
      cells: Array.from(row.cells).map((cell) => ({
        text: htmlCellText(cell),
        rowSpan: rowSpanForClipboardCell(cell, row),
        columnSpan: positiveSpan(cell.colSpan),
        header: cell.tagName.toLowerCase() === "th",
      })),
    };
  });
  return importedHtmlTableToStructuralSource(rows);
}

export type WholeTableClipboardImport =
  | { kind: "table"; source: string }
  | { kind: "native"; plain: string };

/** Classify the complete clipboard payload before taking ownership of a note-level paste. */
export function wholeTableClipboardImport(html: string, plain: string): WholeTableClipboardImport {
  const source = structuralSourceFromClipboardHtml(html);
  return source === null ? { kind: "native", plain } : { kind: "table", source };
}

/**
 * Own a whole-note paste only when the HTML table can be represented losslessly.
 * Otherwise leave both the selection and complete clipboard payload to Obsidian.
 */
export function replaceSelectionFromClipboardTable(clipboardData: DataTransfer, editor: Editor): boolean {
  const result = wholeTableClipboardImport(
    clipboardData.getData("text/html"),
    clipboardData.getData("text/plain"),
  );
  if (result.kind === "native") return false;
  editor.replaceSelection(result.source);
  return true;
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
