import type { StructuralTable } from "./model";
import type { OperationResult } from "./operations";
import { parseEditableTables } from "./parser";
import { reparseUnchangedTable, TableDocumentSnapshot } from "./table-snapshot";

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

/** A replacement that parses alone may absorb adjacent pipe prose in the complete note. */
export function validateTableOperationInDocument(document: string | TableDocumentSnapshot, expected: StructuralTable, result: OperationResult): OperationResult {
  if (!result.changed) return result;
  const transposed = result.code === "table-transposed";
  const refuse: OperationResult = { changed: false,
    code: transposed ? "transpose-boundary-unsafe" : "invalid-result",
    message: transposed
      ? "This transpose would change where the table starts or ends. Add a blank line before and after the table, then try again."
      : "The operation would change a neighboring table or its boundary. Add a blank line around the table and retry.",
    source: expected.source };
  if (typeof document === "string" && document.slice(expected.range.from, expected.range.to) !== expected.source) return refuse;
  const snapshot = typeof document === "string" ? new TableDocumentSnapshot(document) : document;
  const source = snapshot.source;
  const current = reparseUnchangedTable(snapshot, expected);
  if (current === null) return refuse;
  const before = snapshot.tables;
  const index = before.indexOf(current);
  const updated = source.slice(0, expected.range.from) + result.source + source.slice(expected.range.to);
  const after = parseEditableTables(updated).tables;
  const deleted = result.code === "table-deleted";
  if (after.length !== before.length - (deleted ? 1 : 0)) return refuse;
  if (!deleted) {
    const target = after[index];
    if (target === undefined || !target.valid || target.range.from !== expected.range.from
      || target.range.to !== expected.range.from + result.source.length
      || target.source !== result.source || target.startLine !== expected.startLine
      || target.sourcePrefix !== expected.sourcePrefix) return refuse;
    // Transpose-specific semantics share these exact before/after parses with
    // the common document-boundary and neighboring-table checks.
    if (transposed && !isExactTranspose(current, target)) return refuse;
  }
  const otherBefore = before.filter((_table, i) => i !== index);
  const otherAfter = deleted ? after : after.filter((_table, i) => i !== index);
  const delta = result.source.length - expected.source.length;
  for (const [i, original] of otherBefore.entries()) {
    const candidate = otherAfter[i];
    const shift = original.range.from >= expected.range.to ? delta : 0;
    if (candidate === undefined || candidate.range.from !== original.range.from + shift
      || candidate.range.to !== original.range.to + shift || candidate.source !== original.source
      || candidate.valid !== original.valid) return refuse;
  }
  return result;
}
