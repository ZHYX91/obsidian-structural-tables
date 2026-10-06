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

/** Exit the current owner span while retaining the orthogonal logical slot. */
export function tableCoordinateInDirection(
  table: StructuralTable,
  coordinate: TableCellCoordinate,
  direction: TableGridDirection,
): TableCellCoordinate | null {
  const current = table.rows[coordinate.row]?.cells[coordinate.column];
  const anchor = current === undefined
    ? undefined
    : table.rows[current.anchorRow]?.cells[current.anchorColumn];
  if (anchor === undefined) return null;

  let row = coordinate.row;
  let column = coordinate.column;
  if (direction === "up") row = anchor.anchorRow - 1;
  else if (direction === "down") row = anchor.anchorRow + anchor.rowSpan;
  else if (direction === "left") column = anchor.anchorColumn - 1;
  else column = anchor.anchorColumn + anchor.columnSpan;

  if (row < 0 || row >= table.rows.length || column < 0 || column >= table.columnCount) return null;
  if (table.rows[row]?.cells[column] === undefined) return null;
  return { row, column };
}

/** Move one visible owner in a logical grid direction, resolving covered slots back to their anchor. */
export function tableCellInDirection(
  table: StructuralTable,
  coordinate: TableCellCoordinate,
  direction: TableGridDirection,
): TableCellCoordinate | null {
  const destination = tableCoordinateInDirection(table, coordinate, direction);
  const target = destination === null ? undefined : table.rows[destination.row]?.cells[destination.column];
  if (target === undefined) return null;
  return { row: target.anchorRow, column: target.anchorColumn };
}
