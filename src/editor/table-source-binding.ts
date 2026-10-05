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
  const local = tableCellContentOffset(sourceLine.slice(prefix.length), anchor.column);
  return local === null ? null : lineOffset + prefix.length + local;
}
