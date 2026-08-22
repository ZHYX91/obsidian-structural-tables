import type { Editor, EditorPosition, EditorSelection } from "obsidian";

import { cellColumnAt } from "../core/operations";
import { parseStructuralTables } from "../core/parser";
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
  const tables = parseStructuralTables(editor.getValue()).tables;
  let table: StructuralTable | null = null;
  const selected = new Map<string, StructuralCell>();
  for (const selection of selections) {
    const { from, to } = ordered(selection);
    const candidate = tables.find((item) => item.rows.some((row) => row.sourceLine === from.line));
    if (candidate === undefined || (table !== null && candidate !== table)) return null;
    const cells = cellsForSelection(editor, candidate, { anchor: from, head: to });
    if (cells === null) return null;
    table = candidate;
    for (const cell of cells) selected.set(`${cell.row}:${cell.column}`, cell);
  }
  const cells = [...selected.values()];
  if (table === null || cells.length === 0) return null;
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  const minColumn = Math.min(...cells.map((cell) => cell.column));
  const maxColumn = Math.max(...cells.map((cell) => cell.column));
  const rectangular = cells.length === (maxRow - minRow + 1) * (maxColumn - minColumn + 1);
  return { table, cells, minRow, maxRow, minColumn, maxColumn, rectangular };
}
