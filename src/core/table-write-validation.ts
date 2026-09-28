import type { ColumnAlignment, StructuralTable } from "./model";
import { parseEditableTables } from "./parser";

/** A valid prefix is insufficient when replacing a whole table. */
export function parseTableWrite(
  source: string,
  values: readonly (readonly string[])[],
  headerRowCount: number,
  rowHeaderColumnCount: number,
  alignments: readonly ColumnAlignment[],
): StructuralTable | null {
  const tables = parseEditableTables(source).tables;
  const table = tables[0];
  if (tables.length !== 1 || table === undefined || !table.valid
    || table.range.from !== 0 || table.range.to !== source.length
    || table.rows.length !== values.length || table.columnCount !== alignments.length
    || table.headerRowCount !== headerRowCount || table.rowHeaderColumnCount !== rowHeaderColumnCount
    || table.alignments.some((value, index) => value !== alignments[index])
    || table.rows.some((row, index) => row.cells.length !== values[index]?.length
      || row.cells.some((cell, column) => cell.raw.trim() !== values[index]?.[column]?.trim()))) return null;
  return table;
}
