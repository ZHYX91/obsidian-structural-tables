import type { StructuralTable } from "./model";
import { transposeTable, type OperationResult } from "./operations";
import { parseEditableTables } from "./parser";
import { reparseUnchangedTable } from "./table-snapshot";

function isExactTranspose(before: StructuralTable, after: StructuralTable): boolean {
  if (!after.valid || after.sourcePrefix !== before.sourcePrefix || after.rows.length !== before.columnCount
    || after.columnCount !== before.rows.length || after.headerRowCount !== before.rowHeaderColumnCount
    || after.rowHeaderColumnCount !== before.headerRowCount) return false;
  const uniform = before.alignments.every((value) => value === before.alignments[0]);
  if (after.alignments.some((value) => value !== (uniform ? before.alignments[0] : "default"))) return false;
  const roles = { corner_header: "corner_header", column_header: "row_header", row_header: "column_header", data: "data" } as const;
  return before.rows.every((row, rowIndex) => row.cells.every((cell, column) => {
    const next = after.rows[column]?.cells[rowIndex];
    return next !== undefined && next.content === cell.content && next.covered === cell.covered
      && next.role === roles[cell.role] && next.anchorRow === cell.anchorColumn && next.anchorColumn === cell.anchorRow
      && (cell.covered || (next.rowSpan === cell.columnSpan && next.columnSpan === cell.rowSpan));
  }));
}

/** Validate a transpose in the complete note, where neighboring pipe lines matter. */
export function transposeTableInDocument(source: string, table: StructuralTable): OperationResult {
  const result = transposeTable(table);
  if (!result.changed) return result;
  const refusal: OperationResult = { changed: false, code: "transpose-boundary-unsafe", source: table.source,
    message: "This transpose would change where the table starts or ends. Add a blank line before and after the table, then try again." };
  if (reparseUnchangedTable(source, table) === null) return refusal;
  const before = parseEditableTables(source).tables;
  const updated = source.slice(0, table.range.from) + result.source + source.slice(table.range.to);
  const after = parseEditableTables(updated).tables;
  const index = before.findIndex((candidate) => candidate.range.from === table.range.from && candidate.range.to === table.range.to);
  const target = after[index];
  if (after.length !== before.length || target === undefined || target.range.from !== table.range.from
    || target.range.to !== table.range.from + result.source.length || target.startLine !== table.startLine
    || target.source !== result.source || !isExactTranspose(table, target)) return refusal;
  // Reparse the complete note as well as the replacement. A new delimiter must
  // not absorb adjacent prose or change any neighboring table's boundaries.
  const delta = result.source.length - table.source.length;
  if (before.some((original, otherIndex) => {
    if (otherIndex === index) return false;
    const candidate = after[otherIndex]; const shift = original.range.from >= table.range.to ? delta : 0;
    return candidate === undefined || candidate.range.from !== original.range.from + shift
      || candidate.range.to !== original.range.to + shift || candidate.source !== original.source;
  })) return refusal;
  return result;
}
