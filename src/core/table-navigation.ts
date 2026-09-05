import type { StructuralTable, TableCellCoordinate } from "./model";

/** Traverse visible anchors in source order, skipping every covered merge slot. */
export function adjacentTableCell(
  table: StructuralTable,
  coordinate: TableCellCoordinate,
  direction: "forward" | "backward",
): TableCellCoordinate | null {
  const current = table.rows[coordinate.row]?.cells[coordinate.column];
  if (current === undefined) return null;
  const step = direction === "forward" ? 1 : -1;
  const start = current.anchorRow * table.columnCount + current.anchorColumn;
  const end = table.rows.length * table.columnCount;
  for (let index = start + step; index >= 0 && index < end; index += step) {
    const row = Math.floor(index / table.columnCount);
    const column = index % table.columnCount;
    const cell = table.rows[row]?.cells[column];
    if (cell !== undefined && !cell.covered) return { row, column };
  }
  return null;
}
