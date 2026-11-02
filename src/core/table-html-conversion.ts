import type { StructuralTable } from "./model";
import { structuralTableToHtml } from "./interchange";
import { hasHiddenGfmOverflow } from "./table-write-safety";
import { decodeLiteralTableEntity, TABLE_TEXT_ENTITY_PATTERN } from "./literal-cell-text";

// The current HTML writer preserves plain cell text, <br> and structural spans,
// not arbitrary Markdown inline semantics. Reject rather than silently turn
// links, code, emphasis or formulas into different visible text. Known entities
// represent literal text, even when their decoded characters look like syntax.
function hasUnrepresentableMarkdown(raw: string): boolean {
  const syntax = raw.replace(/<br\s*\/?>/giu, "")
    .replace(TABLE_TEXT_ENTITY_PATTERN, (entity) => decodeLiteralTableEntity(entity) === null ? entity : "");
  return /[\\\x60*_[\]~]|%%|==|\$[^$]+\$|&(?:#[xX]?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);|<(?:\/?[A-Za-z]|!|\?)/u.test(syntax);
}

export function markdownTableToHtmlSource(table: StructuralTable, idPrefix: string): string | null {
  if (!table.valid || hasHiddenGfmOverflow(table) || table.sourcePrefix !== "") return null;
  if (table.rows.some((row) => row.cells.some((cell) =>
    !cell.covered && hasUnrepresentableMarkdown(cell.raw.trim())))) return null;
  const output = structuralTableToHtml(table, idPrefix);
  const ending = table.source.includes("\r\n") ? "\r\n" : table.source.includes("\r") ? "\r" : "\n";
  return output.replace(/\n/gu, ending);
}
