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


export type TableGridDirection = "up" | "down" | "left" | "right";

/** Move one visible owner in a logical grid direction, resolving covered slots back to their anchor. */
export function tableCellInDirection(
  table: StructuralTable,
  coordinate: TableCellCoordinate,
  direction: TableGridDirection,
): TableCellCoordinate | null {
  const current = table.rows[coordinate.row]?.cells[coordinate.column];
  const anchor = current === undefined
    ? undefined
    : table.rows[current.anchorRow]?.cells[current.anchorColumn];
  if (anchor === undefined) return null;

  let row = anchor.anchorRow;
  let column = anchor.anchorColumn;
  if (direction === "up") row -= 1;
  else if (direction === "down") row += anchor.rowSpan;
  else if (direction === "left") column -= 1;
  else column += anchor.columnSpan;

  if (row < 0 || row >= table.rows.length || column < 0 || column >= table.columnCount) return null;
  const target = table.rows[row]?.cells[column];
  if (target === undefined) return null;
  return { row: target.anchorRow, column: target.anchorColumn };
}
