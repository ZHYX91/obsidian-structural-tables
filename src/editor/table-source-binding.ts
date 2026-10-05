import type { StructuralTable } from "../core/model";
import { sourceLines } from "../core/source-lines";
import { tableCellContentOffset } from "../core/table-cell-syntax";
import type { TableCellCoordinate } from "./table-selection";

export function tableCellSourceOffset(
  source: string,
  table: StructuralTable,
  coordinate: TableCellCoordinate,
): number | null {
  const cell = table.rows[coordinate.row]?.cells[coordinate.column];
  if (cell === undefined) return null;
  const anchor = table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
  const row = anchor === undefined ? undefined : table.rows[anchor.row];
  if (anchor === undefined || row === undefined) return null;
  const { lines, offsets } = sourceLines(source);
  const sourceLine = lines[row.sourceLine];
  const lineOffset = offsets[row.sourceLine];
  if (sourceLine === undefined || lineOffset === undefined) return null;
  const prefix = table.sourcePrefix;
  if (!sourceLine.startsWith(prefix)) return null;
  const tableLast = Math.max(table.range.from, table.range.to - 1);
  const sourceCellCount = row.sourceCellCount ?? row.cells.length;
  if (anchor.column >= sourceCellCount) {
    // GFM renders missing trailing body cells as empty visual cells. They have
    // no literal source slot, so hand source-oriented commands to the nearest
    // stable position on the owning row while remaining inside the table range.
    const rowStart = lineOffset + prefix.length;
    const rowLast = Math.max(rowStart, lineOffset + sourceLine.length - 1);
    return Math.min(tableLast, rowLast);
  }
  const local = tableCellContentOffset(sourceLine.slice(prefix.length), anchor.column);
  if (local === null) return null;
  return Math.min(tableLast, lineOffset + prefix.length + local);
}
