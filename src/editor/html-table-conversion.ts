import { importedHtmlTableToStructuralSource, type ImportedHtmlRow } from "../core/interchange";
import { parseEditableTables } from "../core/parser";
import { hasPreservedWhitespaceSemantics, htmlCellText } from "./table-interchange";

export interface HtmlToMarkdownPlan {
  source: string;
  /** Styles and HTML attributes outside the Markdown table dialect need consent to discard. */
  losesAttributes: boolean;
}

const ALLOWED = new Set(["TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BR", "COLGROUP", "COL"]);
const HEADER_ATTRIBUTES = new Set(["rowspan", "colspan", "scope", "id", "headers"]);
const SPAN_ATTRIBUTES = new Set(["rowspan", "colspan"]);
const SECTION_TAGS = new Set(["THEAD", "TBODY"]);

function elementIsSafe(element: Element): boolean {
  const tag = element.tagName;
  if (!ALLOWED.has(tag)) return false;
  const parent = element.parentElement?.tagName;
  if (tag === "THEAD" || tag === "TBODY" || tag === "COLGROUP") return parent === "TABLE";
  if (tag === "COL") return parent === "COLGROUP";
  if (tag === "TR") return parent === "TABLE" || SECTION_TAGS.has(parent ?? "");
  if (tag === "TH" || tag === "TD") return parent === "TR";
  if (tag === "BR") return parent === "TH" || parent === "TD";
  return tag === "TABLE";
}

function exactPositiveSpan(cell: HTMLTableCellElement, name: "rowspan" | "colspan"): boolean {
  const token = cell.getAttribute(name);
  return token === null || (/^[1-9][0-9]*$/u.test(token) && Number(token) <= 10000);
}

/**
 * Browser HTML parsers repair truncated tags and missing closing elements.
 * Refuse those inputs rather than silently converting a repaired structure.
 */
function hasBalancedTableMarkup(source: string): boolean {
  const tokens = /<\/?([A-Za-z][A-Za-z0-9]*)(?:\s+[^<>]*?)?\s*\/?>/gu;
  const stack: string[] = [];
  let end = 0;
  for (const match of source.matchAll(tokens)) {
    if (source.slice(end, match.index).includes("<")) return false;
    const name = match[1]!.toUpperCase();
    if (!ALLOWED.has(name)) return false;
    if (match[0].startsWith("</")) {
      if (stack.pop() !== name) return false;
    } else if (name !== "BR" && name !== "COL") {
      if (match[0].endsWith("/>")) return false;
      stack.push(name);
    }
    end = match.index + match[0].length;
  }
  return !source.slice(end).includes("<") && stack.length === 0;
}

/**
 * Only convert a single text-only HTML table. HTML style/attributes that
 * Markdown cannot carry require an explicit acknowledgement in the preview.
 * Rich content or uncertain geometry refuses without changing the note.
 */
export function planHtmlTableToMarkdown(source: string): HtmlToMarkdownPlan | null {
  if (/<!--|<!doctype|<script\b/iu.test(source) || !hasBalancedTableMarkup(source)) return null;
  const document = new DOMParser().parseFromString(source, "text/html");
  const tables = document.body.querySelectorAll("table");
  const table = tables[0];
  if (!(table instanceof HTMLTableElement) || tables.length !== 1 || table.parentElement !== document.body) return null;
  if (hasPreservedWhitespaceSemantics(table)) return null;
  if (Array.from(document.body.childNodes).some((node) => node !== table
    && (node.nodeType !== Node.TEXT_NODE || (node.textContent ?? "").trim() !== ""))) return null;
  let losesAttributes = false;
  for (const element of [table, ...Array.from(table.querySelectorAll("*"))]) {
    if (!elementIsSafe(element)) return null;
    const style = (element as HTMLElement).style;
    // These declarations affect content, not just decoration. The shared text
    // extractor collapses HTML whitespace, so consent to style loss cannot
    // make preserved spaces or hidden source safe to flatten.
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return null;
    if (element.tagName === "COLGROUP" || element.tagName === "COL") losesAttributes = true;
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "hidden" || name === "contenteditable") return null;
      if (name === "style" && /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attr.value)) return null;
      if ((name === "rowspan" || name === "colspan") && (element.tagName === "TH" || element.tagName === "TD")) {
        if (!exactPositiveSpan(element as HTMLTableCellElement, name)) return null;
      } else if (name === "scope" && element.tagName === "TH") {
        if (attr.value !== "row" && attr.value !== "col") return null;
      } else if (!SPAN_ATTRIBUTES.has(name) || element.tagName !== "TH" && element.tagName !== "TD") {
        if (!(element.tagName === "TH" && HEADER_ATTRIBUTES.has(name))) losesAttributes = true;
        if (name === "id" || name === "headers") losesAttributes = true;
      }
    }
    if (element.tagName !== "TH" && element.tagName !== "TD"
      && element.tagName !== "BR" && element.tagName !== "COL") {
      if (Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE
        && (node.textContent ?? "").trim() !== "")) return null;
    }
  }
  const rows: ImportedHtmlRow[] = Array.from(table.rows).map((row) => ({
    section: row.parentElement?.tagName === "THEAD" ? "head" : "body",
    cells: Array.from(row.cells).map((cell) => ({
      text: htmlCellText(cell),
      rowSpan: cell.rowSpan,
      columnSpan: cell.colSpan,
      header: cell.tagName === "TH",
    })),
  }));
  const markdown = importedHtmlTableToStructuralSource(rows);
  if (markdown === null) return null;
  const parsed = parseEditableTables(markdown).tables[0];
  if (parsed === undefined || !parsed.valid || parsed.rows.length !== rows.length
    || parsed.range.from !== 0 || parsed.range.to !== markdown.length) return null;

  // Compare the HTML ownership grid with the Markdown grid. The original
  // importer may pad missing cells; it must never clip a span, change a th/td
  // role, or swallow a real cell while making that padding.
  const occupied = new Set<string>();
  let anchors = 0;
  for (let row = 0; row < table.rows.length; row += 1) {
    const sourceRow = table.rows.item(row);
    if (sourceRow === null) return null;
    let column = 0;
    for (const cell of Array.from(sourceRow.cells)) {
      while (occupied.has(row + ":" + column)) column += 1;
      const candidate = parsed.rows[row]?.cells[column];
      if (candidate === undefined || candidate.covered || candidate.rowSpan !== cell.rowSpan
        || candidate.columnSpan !== cell.colSpan
        || (candidate.role !== "data") !== (cell.tagName === "TH")) return null;
      if (cell.getAttribute("scope") === "row" && candidate.role !== "row_header") return null;
      if (cell.getAttribute("scope") === "col" && candidate.role !== "column_header") return null;
      for (let dr = 0; dr < cell.rowSpan; dr += 1) {
        if (table.rows.item(row + dr)?.parentElement !== sourceRow.parentElement) return null;
        for (let dc = 0; dc < cell.colSpan; dc += 1) {
          const key = (row + dr) + ":" + (column + dc);
          if (occupied.has(key)) return null;
          occupied.add(key);
        }
      }
      anchors += 1;
      column += cell.colSpan;
    }
  }
  if (parsed.rows.flatMap((row) => row.cells).filter((cell) => !cell.covered).length !== anchors) return null;
  return { source: markdown, losesAttributes };
}
