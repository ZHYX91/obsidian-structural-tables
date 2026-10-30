import type { StructuralTable } from "./model";
import { structuralTableToHtml } from "./interchange";
import { hasHiddenGfmOverflow } from "./table-write-safety";

// The current HTML writer preserves plain cell text, <br> and structural spans,
// not arbitrary Markdown inline semantics. Reject rather than silently turn
// links, code, emphasis, formulas or HTML entities into different visible text.
function hasUnrepresentableMarkdown(raw: string): boolean {
  const withoutBreaks = raw.replace(/<br\s*\/?>/giu, "");
  return /[\\\x60*_[\]~]|\$[^$]+\$|&(?:#[xX]?[0-9a-fA-F]+|[A-Za-z]+);|<(?:\/?[A-Za-z]|!--)/u.test(withoutBreaks);
}

export function markdownTableToHtmlSource(table: StructuralTable, idPrefix: string): string | null {
  if (!table.valid || hasHiddenGfmOverflow(table) || table.sourcePrefix !== "") return null;
  if (table.rows.some((row) => row.cells.some((cell) =>
    !cell.covered && hasUnrepresentableMarkdown(cell.raw.trim())))) return null;
  const output = structuralTableToHtml(table, idPrefix);
  const ending = table.source.includes("\r\n") ? "\r\n" : table.source.includes("\r") ? "\r" : "\n";
  return output.replace(/\n/gu, ending);
}
