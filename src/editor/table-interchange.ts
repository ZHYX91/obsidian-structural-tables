import type { ImportedHtmlRow } from "../core/interchange";
import { importedHtmlTableToStructuralSource } from "../core/interchange";

function positiveSpan(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
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
        text: cell.textContent ?? "",
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
