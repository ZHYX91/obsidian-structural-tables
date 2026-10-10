import { Platform, type Editor } from "obsidian";

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

const HARD_UNSUPPORTED_CONTENT = "svg, math, mjx-container, img, embed, .internal-embed, a[href], video, audio, canvas, iframe, object, input, textarea, select, button, script";
const TEXT_SEMANTIC_CONTENT = "pre, sup, sub, h1, h2, h3, h4, h5, h6";

function hasPreservedWhitespaceSemantics(table: HTMLTableElement): boolean {
  const ancestors: HTMLElement[] = [];
  for (let element = table.parentElement; element !== null; element = element.parentElement) ancestors.push(element);
  // white-space is inherited. Clipboard wrappers can carry the cell's visible
  // whitespace semantics even when the table has no inline style of its own.
  return [table, ...ancestors, ...table.querySelectorAll<HTMLElement>("[style]")].some((element) => {
    const whiteSpace = element.style.whiteSpace.trim().toLowerCase();
    return whiteSpace === "pre" || whiteSpace === "pre-wrap" || whiteSpace === "pre-line" || whiteSpace === "break-spaces";
  });
}

function hasHardUnsupportedCellContent(table: HTMLTableElement): boolean {
  return table.matches(HARD_UNSUPPORTED_CONTENT)
    || table.querySelector(HARD_UNSUPPORTED_CONTENT) !== null
    // Text-node whitespace normalization is not a TeX parser. Preserve the
    // clipboard's original plain-text alternative for source math as well.
    || (table.textContent ?? "").includes("$")
    || Array.from(table.querySelectorAll("caption")).some((caption) => (caption.textContent ?? "").trim() !== "");
}

function hasUnsupportedCellContent(table: HTMLTableElement): boolean {
  return hasHardUnsupportedCellContent(table)
    || table.querySelector(TEXT_SEMANTIC_CONTENT) !== null
    || hasPreservedWhitespaceSemantics(table);
}

function hasMeaningfulContentOutsideTable(document: Document): boolean {
  if (document.querySelectorAll("table").length !== 1) return true;
  // Check the complete HTML payload before removing the table so rich meaning
  // carried by the table itself, an ancestor wrapper, or outside content is not
  // lost by a plain-text fallback.
  if (document.querySelector(HARD_UNSUPPORTED_CONTENT) !== null) return true;
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelector("table")?.remove();
  return (clone.textContent ?? "").trim() !== "";
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
  const raw = cell.getAttribute("rowspan");
  const token = raw?.trim() ?? "";
  const parsed = /^[0-9]+$/u.test(token) ? Number(token) : null;
  if (parsed !== 0) return positiveSpan(cell.rowSpan);
  const siblings = Array.from(row.parentElement?.children ?? [])
    .filter((candidate): candidate is HTMLTableRowElement => candidate.tagName === "TR");
  const index = siblings.indexOf(row);
  return index < 0 ? 1 : Math.max(1, siblings.length - index);
}

function hasMeaningfulTableContent(table: HTMLTableElement): boolean {
  return Array.from(table.querySelectorAll<HTMLTableCellElement>("td, th"))
    .some((cell) => htmlCellText(cell) !== "");
}

function isPureEmptyClipboardTable(html: string): boolean {
  const parsed = parsedClipboardTable(html);
  if (
    parsed === null
    || hasMeaningfulContentOutsideTable(parsed.document)
    || hasUnsupportedCellContent(parsed.table)
  ) return false;
  const cells = Array.from(parsed.table.querySelectorAll<HTMLTableCellElement>("td, th"));
  return cells.length > 0 && cells.every((cell) => htmlCellText(cell) === "");
}

function isPlainFallbackTextSemanticTable(html: string): boolean {
  const parsed = parsedClipboardTable(html);
  if (
    parsed === null
    || hasMeaningfulContentOutsideTable(parsed.document)
    || hasHardUnsupportedCellContent(parsed.table)
  ) return false;
  const cells = parsed.table.querySelectorAll<HTMLTableCellElement>("td, th");
  return cells.length > 0 && (
    parsed.table.querySelector(TEXT_SEMANTIC_CONTENT) !== null
    || hasPreservedWhitespaceSemantics(parsed.table)
  );
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
  | { kind: "plain"; text: string }
  | { kind: "blocked-empty" }
  | { kind: "blocked-unsafe-text" }
  | { kind: "native" };

/** Classify the complete clipboard payload before taking ownership of a note-level paste. */
export function wholeTableClipboardImport(html: string, plain: string): WholeTableClipboardImport {
  const source = structuralSourceFromClipboardHtml(html);
  if (source !== null) return { kind: "table", source };
  if (isPureEmptyClipboardTable(html)) {
    return plain !== "" ? { kind: "plain", text: plain } : { kind: "blocked-empty" };
  }
  if (isPlainFallbackTextSemanticTable(html)) {
    return plain !== "" ? { kind: "plain", text: plain } : { kind: "blocked-unsafe-text" };
  }
  return { kind: "native" };
}

function hasNativeClipboardPayload(clipboardData: DataTransfer): boolean {
  if (clipboardData.files?.length > 0) return true;
  const items = clipboardData.items;
  if (items !== undefined && items !== null) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item?.kind === "file") return true;
      if (item?.kind === "string" && item.type !== "" && !item.type.toLowerCase().startsWith("text/")) return true;
    }
  }
  const types = clipboardData.types;
  if (types !== undefined && types !== null) {
    for (const type of Array.from(types)) {
      const normalized = type.toLowerCase();
      if (normalized === "files" || (normalized !== "" && !normalized.startsWith("text/"))) return true;
    }
  }
  return false;
}

/**
 * Replace only complete clipboard payloads explicitly owned by the classifier.
 * Files and other non-text clipboard parts remain completely native so host
 * attachment/import handlers keep their opportunity to act.
 */
export function replaceSelectionFromClipboardTable(
  clipboardData: DataTransfer,
  editor: Editor,
): WholeTableClipboardImport["kind"] {
  if (hasNativeClipboardPayload(clipboardData)) return "native";
  const result = wholeTableClipboardImport(
    clipboardData.getData("text/html"),
    clipboardData.getData("text/plain"),
  );
  if (result.kind === "table") editor.replaceSelection(result.source);
  else if (result.kind === "plain") editor.replaceSelection(result.text);
  return result.kind;
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export type HtmlClipboardMode = "html" | "plain";

export async function copyHtml(html: string, text: string): Promise<HtmlClipboardMode> {
  if (Platform.isMobileApp || typeof ClipboardItem === "undefined" || navigator.clipboard.write === undefined) {
    await copyText(text);
    return "plain";
  }
  await navigator.clipboard.write([new ClipboardItem({
    "text/html": new Blob([html], { type: "text/html" }),
    "text/plain": new Blob([text], { type: "text/plain" }),
  })]);
  return "html";
}
