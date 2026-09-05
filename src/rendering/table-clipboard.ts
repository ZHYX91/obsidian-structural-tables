import { App, Component, MarkdownRenderer } from "obsidian";

import type { TableAppearance } from "../config/settings";
import { structuralTableToDelimited, structuralTableToHtml } from "../core/interchange";
import type { StructuralTable } from "../core/model";

const INLINE_TAGS = new Set(["A", "B", "BR", "CODE", "DEL", "EM", "I", "MARK", "S", "STRONG", "SUB", "SUP", "U"]);
const OMIT_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT"]);

function appendPortableContent(source: Node, target: Node): void {
  const document = target.ownerDocument!;
  if (source.nodeType === 3) {
    target.appendChild(document.createTextNode(source.textContent ?? ""));
    return;
  }
  if (source.nodeType !== 1) return;
  const element = source as Element;
  if (OMIT_TAGS.has(element.tagName)) return;
  if (element.tagName === "IMG" || element.classList.contains("internal-embed")) {
    target.appendChild(document.createTextNode(element.getAttribute("alt") ?? element.textContent ?? ""));
    return;
  }
  const output = INLINE_TAGS.has(element.tagName) ? document.createElement(element.tagName.toLowerCase()) : target;
  if (output !== target) {
    if (element.tagName === "A") {
      const href = element.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/iu.test(href)) (output as Element).setAttribute("href", href);
    }
    target.appendChild(output);
  }
  for (const child of source.childNodes) appendPortableContent(child, output);
}

function portableText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType === 1 && (node as Element).tagName === "BR") return "\n";
  return Array.from(node.childNodes, portableText).join("");
}

/** Render only portable inline content; never export editor controls or theme CSS. */
export async function renderTableClipboard(
  app: App,
  table: StructuralTable,
  sourcePath: string,
  appearance: TableAppearance,
): Promise<{ html: string; text: string }> {
  const document = new DOMParser().parseFromString(structuralTableToHtml(table), "text/html");
  const output = document.querySelector("table")!;
  output.style.borderCollapse = "collapse";
  output.style.color = "#000000";
  output.style.maxWidth = "100%";
  const textTable: StructuralTable = { ...table, rows: table.rows.map((row) => ({
    ...row, cells: row.cells.map((cell) => ({ ...cell })),
  })) };
  const component = new Component();
  component.load();
  try {
    let index = 0;
    const elements = Array.from(output.querySelectorAll<HTMLTableCellElement>("th, td"));
    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (cell.covered) continue;
        const element = elements[index++]!;
        const rendered = window.document.createElement("div");
        await MarkdownRenderer.render(app, cell.content, rendered, sourcePath, component);
        element.replaceChildren();
        for (const child of rendered.childNodes) appendPortableContent(child, element);
        textTable.rows[cell.row]!.cells[cell.column]!.content = portableText(element);
        element.style.padding = "4pt 6pt";
        element.style.verticalAlign = "middle";
        if (!element.style.textAlign) element.style.textAlign = "left";
        element.style.border = appearance === "grid" ? "0.5pt solid #808080" : "none";
        if (appearance === "three-line") {
          if (cell.row === 0) element.style.borderTop = "1.5pt solid #000000";
          if (cell.row + cell.rowSpan === table.rows.length) element.style.borderBottom = "1.5pt solid #000000";
          else if (cell.row < table.headerRowCount) {
            if (cell.row + cell.rowSpan === table.headerRowCount) element.style.borderBottom = "1pt solid #000000";
            else if (cell.columnSpan > 1) element.style.borderBottom = "0.5pt solid #000000";
          }
        }
      }
    }
    return { html: output.outerHTML, text: structuralTableToDelimited(textTable, "\t") };
  } finally {
    component.unload();
  }
}
