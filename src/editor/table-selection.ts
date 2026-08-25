import type { Editor, EditorPosition, EditorSelection } from "obsidian";

import { cellColumnAt } from "../core/operations";
import { parseEditableTables } from "../core/parser";
import type { StructuralCell, StructuralTable } from "../core/model";

export interface StructuralTableSelection {
  table: StructuralTable;
  cells: StructuralCell[];
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
  rectangular: boolean;
}

export interface TableCellCoordinate {
  row: number;
  column: number;
}

export function structuralTableSelectionFromCoordinates(
  table: StructuralTable,
  coordinates: readonly TableCellCoordinate[],
): StructuralTableSelection | null {
  const selected = new Map<string, StructuralCell>();
  for (const coordinate of coordinates) {
    const cell = table.rows[coordinate.row]?.cells[coordinate.column];
    if (cell === undefined) return null;
    selected.set(`${cell.row}:${cell.column}`, cell);
  }
  const cells = [...selected.values()];
  if (cells.length === 0) return null;
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  const minColumn = Math.min(...cells.map((cell) => cell.column));
  const maxColumn = Math.max(...cells.map((cell) => cell.column));
  const rectangular = cells.length === (maxRow - minRow + 1) * (maxColumn - minColumn + 1);
  return { table, cells, minRow, maxRow, minColumn, maxColumn, rectangular };
}

export function structuralTableSelectionFromBounds(
  table: StructuralTable,
  first: TableCellCoordinate,
  last: TableCellCoordinate,
): StructuralTableSelection | null {
  let minRow = Math.min(first.row, last.row);
  let maxRow = Math.max(first.row, last.row);
  let minColumn = Math.min(first.column, last.column);
  let maxColumn = Math.max(first.column, last.column);
  if (minRow < 0 || minColumn < 0 || maxRow >= table.rows.length || maxColumn >= table.columnCount) return null;

  let expanded = true;
  while (expanded) {
    expanded = false;
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cell = table.rows[row]?.cells[column];
        if (cell === undefined) return null;
        const anchor = table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
        if (anchor === undefined) return null;
        const anchorMaxRow = anchor.anchorRow + anchor.rowSpan - 1;
        const anchorMaxColumn = anchor.anchorColumn + anchor.columnSpan - 1;
        const nextMinRow = Math.min(minRow, anchor.anchorRow);
        const nextMaxRow = Math.max(maxRow, anchorMaxRow);
        const nextMinColumn = Math.min(minColumn, anchor.anchorColumn);
        const nextMaxColumn = Math.max(maxColumn, anchorMaxColumn);
        if (nextMinRow !== minRow || nextMaxRow !== maxRow || nextMinColumn !== minColumn || nextMaxColumn !== maxColumn) {
          minRow = nextMinRow;
          maxRow = nextMaxRow;
          minColumn = nextMinColumn;
          maxColumn = nextMaxColumn;
          expanded = true;
        }
      }
    }
  }

  const coordinates: TableCellCoordinate[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) coordinates.push({ row, column });
  }
  return structuralTableSelectionFromCoordinates(table, coordinates);
}

function positionBefore(left: EditorPosition, right: EditorPosition): boolean {
  return left.line < right.line || (left.line === right.line && left.ch <= right.ch);
}

function ordered(selection: EditorSelection): { from: EditorPosition; to: EditorPosition } {
  return positionBefore(selection.anchor, selection.head)
    ? { from: selection.anchor, to: selection.head }
    : { from: selection.head, to: selection.anchor };
}

function cellsForSelection(
  editor: Editor,
  table: StructuralTable,
  selection: EditorSelection,
): StructuralCell[] | null {
  const { from, to } = ordered(selection);
  if (from.line !== to.line) return null;
  const row = table.rows.find((candidate) => candidate.sourceLine === from.line);
  if (row === undefined) return null;
  const line = editor.getLine(from.line);
  const endCharacter = to.ch > from.ch ? to.ch - 1 : to.ch;
  const startColumn = cellColumnAt(line, from.ch);
  const endColumn = cellColumnAt(line, endCharacter);
  if (startColumn === null || endColumn === null) return null;
  const minColumn = Math.max(0, Math.min(startColumn, endColumn));
  const maxColumn = Math.min(table.columnCount - 1, Math.max(startColumn, endColumn));
  if (minColumn > maxColumn) return null;
  return row.cells.slice(minColumn, maxColumn + 1);
}

export function selectedStructuralTableCells(editor: Editor): StructuralTableSelection | null {
  const selections = editor.listSelections();
  if (selections.length === 0) return null;
  const tables = parseEditableTables(editor.getValue()).tables;
  let table: StructuralTable | null = null;
  const selected = new Map<string, TableCellCoordinate>();
  for (const selection of selections) {
    const { from, to } = ordered(selection);
    const candidate = tables.find((item) => item.rows.some((row) => row.sourceLine === from.line));
    if (candidate === undefined || (table !== null && candidate !== table)) return null;
    const cells = cellsForSelection(editor, candidate, { anchor: from, head: to });
    if (cells === null) return null;
    table = candidate;
    for (const cell of cells) selected.set(`${cell.row}:${cell.column}`, { row: cell.row, column: cell.column });
  }
  if (table === null) return null;
  return structuralTableSelectionFromCoordinates(table, [...selected.values()]);
}
