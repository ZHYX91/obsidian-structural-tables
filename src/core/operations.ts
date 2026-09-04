import type { ColumnAlignment, StructuralTable } from "./model";
import { parseEditableTables, parseStructuralTables } from "./parser";
import { serializeStructuralTable } from "./serializer";

export type MergeDirection = "left" | "up";

export type OperationCode =
  | "already-merged"
  | "cell-unavailable"
  | "cell-edited"
  | "column-aligned"
  | "column-inserted"
  | "column-moved"
  | "columns-deleted"
  | "content-would-be-lost"
  | "header-count-invalid"
  | "header-rows-set"
  | "invalid-result"
  | "merge-crosses-role"
  | "merge-invalid-selection"
  | "merge-partial-existing"
  | "merged"
  | "no-adjacent-cell"
  | "not-merged"
  | "row-header-count-invalid"
  | "row-headers-set"
  | "row-inserted"
  | "row-moved"
  | "rows-deleted"
  | "row-unavailable"
  | "split"
  | "split-unsafe"
  | "table-invalid";

export interface OperationResult {
  changed: boolean;
  code: OperationCode;
  message: string;
  source: string;
}

function sourceWithRawCells(
  table: StructuralTable,
  values: string[][],
  headerRowCount = table.headerRowCount,
  rowHeaderColumnCount = table.rowHeaderColumnCount,
): string {
  const provisional = table.rows.map((row, rowIndex) => {
    const cells = row.cells.map((cell, columnIndex) => values[rowIndex]?.[columnIndex] ?? cell.raw.trim());
    return `| ${cells.join(" | ")} |`;
  });
  const delimiter = table.alignments.map((alignment) => {
    if (alignment === "left") return ":---";
    if (alignment === "center") return ":---:";
    if (alignment === "right") return "---:";
    return "---";
  });
  const delimiterText = rowHeaderColumnCount === 0
    ? `| ${delimiter.join(" | ")} |`
    : `| ${delimiter.slice(0, rowHeaderColumnCount).join(" | ")} || ${delimiter.slice(rowHeaderColumnCount).join(" | ")} |`;
  provisional.splice(headerRowCount, 0, delimiterText);
  return provisional.join(lineEnding(table.source));
}

function rawValues(table: StructuralTable): string[][] {
  return table.rows.map((row) => row.cells.map((cell) => cell.raw.trim()));
}

type InsertDirection = "before" | "after";
type MoveDirection = "backward" | "forward";

interface OwnedGrid {
  contents: Map<string, string>;
  owners: string[][];
}

function lineEnding(source: string): "\r\n" | "\r" | "\n" {
  if (source.includes("\r\n")) return "\r\n";
  if (source.includes("\r")) return "\r";
  return "\n";
}

function sourceFromGrid(
  values: string[][],
  headerRowCount: number,
  rowHeaderColumnCount: number,
  alignments: readonly ColumnAlignment[],
  ending: string,
): string {
  const rows = values.map((cells) => `| ${cells.join(" | ")} |`);
  const delimiter = alignments.map((alignment) => {
    if (alignment === "left") return ":---";
    if (alignment === "center") return ":---:";
    if (alignment === "right") return "---:";
    return "---";
  });
  const delimiterText = rowHeaderColumnCount === 0
    ? `| ${delimiter.join(" | ")} |`
    : `| ${delimiter.slice(0, rowHeaderColumnCount).join(" | ")} || ${delimiter.slice(rowHeaderColumnCount).join(" | ")} |`;
  rows.splice(headerRowCount, 0, delimiterText);
  return rows.join(ending);
}

function ownedGrid(table: StructuralTable): OwnedGrid {
  const contents = new Map<string, string>();
  const owners = table.rows.map((row) => row.cells.map((cell) => {
    const key = `${cell.anchorRow}:${cell.anchorColumn}`;
    if (!contents.has(key)) {
      const anchor = table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
      contents.set(key, anchor?.raw.trim() ?? "");
    }
    return key;
  }));
  return { contents, owners };
}

function valuesFromOwnedGrid(grid: OwnedGrid): string[][] | null {
  const positions = new Map<string, { rows: number[]; columns: number[] }>();
  for (let row = 0; row < grid.owners.length; row += 1) {
    for (let column = 0; column < (grid.owners[row]?.length ?? 0); column += 1) {
      const owner = grid.owners[row]?.[column];
      if (owner === undefined) return null;
      const position = positions.get(owner) ?? { rows: [], columns: [] };
      position.rows.push(row);
      position.columns.push(column);
      positions.set(owner, position);
    }
  }
  const values = grid.owners.map((row) => row.map(() => ""));
  for (const [owner, position] of positions) {
    const minRow = Math.min(...position.rows);
    const maxRow = Math.max(...position.rows);
    const minColumn = Math.min(...position.columns);
    const maxColumn = Math.max(...position.columns);
    const expected = (maxRow - minRow + 1) * (maxColumn - minColumn + 1);
    if (position.rows.length !== expected) return null;
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        if (grid.owners[row]?.[column] !== owner) return null;
        const rowValues = values[row];
        if (rowValues === undefined) return null;
        rowValues[column] = row === minRow && column === minColumn
          ? grid.contents.get(owner) ?? ""
          : row === minRow ? "<" : "^";
      }
    }
  }
  return values;
}

function resultFromOwnedGrid(
  table: StructuralTable,
  grid: OwnedGrid,
  code: OperationCode,
  message: string,
  headerRowCount: number,
  rowHeaderColumnCount: number,
  alignments: readonly ColumnAlignment[],
): OperationResult {
  const values = valuesFromOwnedGrid(grid);
  if (values === null) {
    return { changed: false, code: "invalid-result", message: "That operation would split an existing merged cell.", source: table.source };
  }
  const candidateSource = sourceFromGrid(
    values,
    headerRowCount,
    rowHeaderColumnCount,
    alignments,
    lineEnding(table.source),
  );
  const parsed = parseEditableTables(candidateSource).tables[0] ?? null;
  if (parsed === null || !parsed.valid) {
    return {
      changed: false,
      code: "invalid-result",
      message: parsed?.diagnostics[0]?.message ?? "That operation would create an invalid table.",
      source: table.source,
    };
  }
  return { changed: true, code, message, source: serializeStructuralTable(parsed) };
}

function unavailable(table: StructuralTable, row?: number, column?: number): OperationResult | null {
  if (!table.valid) {
    return { changed: false, code: "table-invalid", message: "The table must be valid before changing its structure.", source: table.source };
  }
  if (row !== undefined && table.rows[row] === undefined) {
    return { changed: false, code: "row-unavailable", message: "The selected row is unavailable.", source: table.source };
  }
  if (column !== undefined && (column < 0 || column >= table.columnCount)) {
    return { changed: false, code: "cell-unavailable", message: "The selected column is unavailable.", source: table.source };
  }
  return null;
}

/** Escapes Markdown table separators while preserving existing escapes and code spans. */
export function normalizeTableCellInput(input: string): string {
  const singleLine = input.replace(/\r\n|\r|\n/gu, "<br>").trim();
  let output = "";
  let codeTicks = 0;
  for (let index = 0; index < singleLine.length; index += 1) {
    const character = singleLine[index] ?? "";
    if (character === "\\") {
      let run = 1;
      while (singleLine[index + run] === "\\") run += 1;
      output += "\\".repeat(run);
      const next = singleLine[index + run];
      if (next === "|" && run % 2 === 1) {
        output += "|";
        index += run;
      } else {
        index += run - 1;
      }
      continue;
    }
    if (character === "`") {
      let run = 1;
      while (singleLine[index + run] === "`") run += 1;
      output += "`".repeat(run);
      if (codeTicks === 0) codeTicks = run;
      else if (codeTicks === run) codeTicks = 0;
      index += run - 1;
      continue;
    }
    output += character === "|" && codeTicks === 0 ? "\\|" : character;
  }
  return output === "<" || output === "^" ? `\\${output}` : output;
}

export function editCellContent(
  table: StructuralTable,
  row: number,
  column: number,
  input: string,
): OperationResult {
  const blocked = unavailable(table, row, column);
  if (blocked !== null) return blocked;
  const cell = table.rows[row]?.cells[column];
  const anchor = cell === undefined ? undefined : table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
  if (anchor === undefined) {
    return { changed: false, code: "cell-unavailable", message: "The selected cell is unavailable.", source: table.source };
  }
  const normalized = normalizeTableCellInput(input);
  if (normalized === anchor.raw.trim()) {
    return { changed: false, code: "cell-edited", message: "The cell is unchanged.", source: table.source };
  }
  const values = rawValues(table);
  const anchorValues = values[anchor.row];
  if (anchorValues === undefined) {
    return { changed: false, code: "row-unavailable", message: "The selected row is unavailable.", source: table.source };
  }
  anchorValues[anchor.column] = normalized;
  const candidateSource = sourceWithRawCells(table, values);
  const parsed = parseEditableTables(candidateSource).tables[0] ?? null;
  if (parsed === null || !parsed.valid) {
    return { changed: false, code: "invalid-result", message: "That edit would create an invalid table.", source: table.source };
  }
  return { changed: true, code: "cell-edited", message: "Cell updated.", source: serializeStructuralTable(parsed) };
}

export function insertTableRow(
  table: StructuralTable,
  row: number,
  direction: InsertDirection,
): OperationResult {
  const blocked = unavailable(table, row);
  if (blocked !== null) return blocked;
  const index = row + (direction === "after" ? 1 : 0);
  const grid = ownedGrid(table);
  const inserted = Array.from({ length: table.columnCount }, (_unused, column) => {
    const above = grid.owners[index - 1]?.[column];
    const below = grid.owners[index]?.[column];
    if (above !== undefined && above === below) return above;
    const owner = `new-row:${index}:${column}`;
    grid.contents.set(owner, "");
    return owner;
  });
  grid.owners.splice(index, 0, inserted);
  const headerRowCount = table.headerRowCount + (row < table.headerRowCount ? 1 : 0);
  return resultFromOwnedGrid(table, grid, "row-inserted", "Row inserted.", headerRowCount, table.rowHeaderColumnCount, table.alignments);
}

export function insertTableColumn(
  table: StructuralTable,
  column: number,
  direction: InsertDirection,
): OperationResult {
  const blocked = unavailable(table, undefined, column);
  if (blocked !== null) return blocked;
  const index = column + (direction === "after" ? 1 : 0);
  const grid = ownedGrid(table);
  for (let row = 0; row < grid.owners.length; row += 1) {
    const rowOwners = grid.owners[row];
    if (rowOwners === undefined) continue;
    const left = rowOwners[index - 1];
    const right = rowOwners[index];
    const owner = left !== undefined && left === right ? left : `new-column:${row}:${index}`;
    if (!grid.contents.has(owner)) grid.contents.set(owner, "");
    rowOwners.splice(index, 0, owner);
  }
  const alignments = [...table.alignments];
  alignments.splice(index, 0, "default");
  const rowHeaderColumnCount = table.rowHeaderColumnCount + (column < table.rowHeaderColumnCount ? 1 : 0);
  return resultFromOwnedGrid(table, grid, "column-inserted", "Column inserted.", table.headerRowCount, rowHeaderColumnCount, alignments);
}

function removedOwnersHaveContent(grid: OwnedGrid, nextOwners: string[][]): boolean {
  const remaining = new Set(nextOwners.flat());
  return [...new Set(grid.owners.flat())].some((owner) => !remaining.has(owner) && (grid.contents.get(owner) ?? "").trim().length > 0);
}

export function deleteTableRows(table: StructuralTable, startRow: number, endRow: number): OperationResult {
  const min = Math.min(startRow, endRow);
  const max = Math.max(startRow, endRow);
  const blocked = unavailable(table, min);
  if (blocked !== null || table.rows[max] === undefined) return blocked ?? { changed: false, code: "row-unavailable", message: "The selected row is unavailable.", source: table.source };
  if (max - min + 1 >= table.rows.length) {
    return { changed: false, code: "invalid-result", message: "A table must keep at least one row.", source: table.source };
  }
  const grid = ownedGrid(table);
  const owners = grid.owners.filter((_row, index) => index < min || index > max);
  if (removedOwnersHaveContent(grid, owners)) {
    return { changed: false, code: "content-would-be-lost", message: "Clear the selected rows before deleting them so no content is lost.", source: table.source };
  }
  const removedHeaderRows = Math.max(0, Math.min(max, table.headerRowCount - 1) - min + 1);
  const headerRowCount = Math.max(1, table.headerRowCount - removedHeaderRows);
  return resultFromOwnedGrid(table, { ...grid, owners }, "rows-deleted", "Rows deleted.", headerRowCount, table.rowHeaderColumnCount, table.alignments);
}

export function deleteTableColumns(table: StructuralTable, startColumn: number, endColumn: number): OperationResult {
  const min = Math.min(startColumn, endColumn);
  const max = Math.max(startColumn, endColumn);
  const blocked = unavailable(table, undefined, min);
  if (blocked !== null || max >= table.columnCount) return blocked ?? { changed: false, code: "cell-unavailable", message: "The selected column is unavailable.", source: table.source };
  if (max - min + 1 >= table.columnCount) {
    return { changed: false, code: "invalid-result", message: "A table must keep at least one column.", source: table.source };
  }
  const grid = ownedGrid(table);
  const owners = grid.owners.map((row) => row.filter((_owner, index) => index < min || index > max));
  if (removedOwnersHaveContent(grid, owners)) {
    return { changed: false, code: "content-would-be-lost", message: "Clear the selected columns before deleting them so no content is lost.", source: table.source };
  }
  const alignments = table.alignments.filter((_alignment, index) => index < min || index > max);
  const removedRowHeaders = Math.max(0, Math.min(max, table.rowHeaderColumnCount - 1) - min + 1);
  const rowHeaderColumnCount = Math.min(table.columnCount - (max - min + 1) - 1, table.rowHeaderColumnCount - removedRowHeaders);
  return resultFromOwnedGrid(table, { ...grid, owners }, "columns-deleted", "Columns deleted.", table.headerRowCount, Math.max(0, rowHeaderColumnCount), alignments);
}

function movedIndexes(length: number, start: number, end: number, direction: MoveDirection): number[] | null {
  if (start < 0 || end < start || end >= length) return null;
  const indexes = Array.from({ length }, (_unused, index) => index);
  if (direction === "backward") {
    if (start === 0) return null;
    const preceding = indexes[start - 1];
    if (preceding === undefined) return null;
    indexes.splice(start - 1, end - start + 2, ...indexes.slice(start, end + 1), preceding);
  } else {
    if (end === length - 1) return null;
    const following = indexes[end + 1];
    if (following === undefined) return null;
    indexes.splice(start, end - start + 2, following, ...indexes.slice(start, end + 1));
  }
  return indexes;
}

export function moveTableRows(
  table: StructuralTable,
  startRow: number,
  endRow: number,
  direction: MoveDirection,
): OperationResult {
  const min = Math.min(startRow, endRow);
  const max = Math.max(startRow, endRow);
  const blocked = unavailable(table, min);
  if (blocked !== null || table.rows[max] === undefined) return blocked ?? { changed: false, code: "row-unavailable", message: "The selected row is unavailable.", source: table.source };
  const target = direction === "backward" ? min - 1 : max + 1;
  if (target < 0 || target >= table.rows.length || (min < table.headerRowCount) !== (target < table.headerRowCount)) {
    return { changed: false, code: "invalid-result", message: "Rows cannot move across the column-header boundary.", source: table.source };
  }
  const indexes = movedIndexes(table.rows.length, min, max, direction);
  if (indexes === null) return { changed: false, code: "invalid-result", message: "The selected rows cannot move farther.", source: table.source };
  const grid = ownedGrid(table);
  const owners = indexes.map((index) => grid.owners[index] ?? []);
  return resultFromOwnedGrid(table, { ...grid, owners }, "row-moved", "Rows moved.", table.headerRowCount, table.rowHeaderColumnCount, table.alignments);
}

export function moveTableColumns(
  table: StructuralTable,
  startColumn: number,
  endColumn: number,
  direction: MoveDirection,
): OperationResult {
  const min = Math.min(startColumn, endColumn);
  const max = Math.max(startColumn, endColumn);
  const blocked = unavailable(table, undefined, min);
  if (blocked !== null || max >= table.columnCount) return blocked ?? { changed: false, code: "cell-unavailable", message: "The selected column is unavailable.", source: table.source };
  const target = direction === "backward" ? min - 1 : max + 1;
  if (target < 0 || target >= table.columnCount || (min < table.rowHeaderColumnCount) !== (target < table.rowHeaderColumnCount)) {
    return { changed: false, code: "invalid-result", message: "Columns cannot move across the row-header boundary.", source: table.source };
  }
  const indexes = movedIndexes(table.columnCount, min, max, direction);
  if (indexes === null) return { changed: false, code: "invalid-result", message: "The selected columns cannot move farther.", source: table.source };
  const grid = ownedGrid(table);
  const owners = grid.owners.map((row) => indexes.map((index) => row[index] ?? ""));
  const alignments = indexes.map((index) => table.alignments[index] ?? "default");
  return resultFromOwnedGrid(table, { ...grid, owners }, "column-moved", "Columns moved.", table.headerRowCount, table.rowHeaderColumnCount, alignments);
}

export function alignTableColumns(
  table: StructuralTable,
  startColumn: number,
  endColumn: number,
  alignment: ColumnAlignment,
): OperationResult {
  const min = Math.min(startColumn, endColumn);
  const max = Math.max(startColumn, endColumn);
  const blocked = unavailable(table, undefined, min);
  if (blocked !== null || max >= table.columnCount) return blocked ?? { changed: false, code: "cell-unavailable", message: "The selected column is unavailable.", source: table.source };
  const alignments = [...table.alignments];
  for (let column = min; column <= max; column += 1) alignments[column] = alignment;
  if (table.alignments.every((value, index) => value === alignments[index])) {
    return { changed: false, code: "column-aligned", message: "Those columns already use that alignment.", source: table.source };
  }
  return resultFromOwnedGrid(table, ownedGrid(table), "column-aligned", "Column alignment updated.", table.headerRowCount, table.rowHeaderColumnCount, alignments);
}

export function mergeCell(
  table: StructuralTable,
  row: number,
  column: number,
  direction: MergeDirection,
): OperationResult {
  if (!table.valid) return { changed: false, code: "table-invalid", message: "The table must be valid before editing merges.", source: table.source };
  const cell = table.rows[row]?.cells[column];
  const target = direction === "left" ? table.rows[row]?.cells[column - 1] : table.rows[row - 1]?.cells[column];
  if (cell === undefined || target === undefined) {
    return { changed: false, code: "no-adjacent-cell", message: `There is no cell ${direction === "left" ? "to the left" : "above"}.`, source: table.source };
  }
  if (cell.content.length > 0 && cell.marker === undefined) {
    return { changed: false, code: "content-would-be-lost", message: "Clear the current cell before merging so no content is lost.", source: table.source };
  }
  if (cell.role !== target.role) {
    return { changed: false, code: "merge-crosses-role", message: "A merge cannot cross a header or data-region boundary.", source: table.source };
  }
  const values = rawValues(table);
  const rowValues = values[row];
  if (rowValues === undefined) return { changed: false, code: "row-unavailable", message: "The current row is unavailable.", source: table.source };
  rowValues[column] = direction === "left" ? "<" : "^";
  const candidateSource = sourceWithRawCells(table, values);
  const parsed = parseStructuralTables(candidateSource).tables[0] ?? null;
  if (parsed === null || !parsed.valid) {
    return { changed: false, code: "invalid-result", message: parsed?.diagnostics[0]?.message ?? "That merge would create an invalid table.", source: table.source };
  }
  return { changed: true, code: "merged", message: "Cells merged.", source: serializeStructuralTable(parsed) };
}

export function mergeCellRange(
  table: StructuralTable,
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
): OperationResult {
  if (!table.valid) return { changed: false, code: "table-invalid", message: "The table must be valid before editing merges.", source: table.source };
  const minRow = Math.min(startRow, endRow);
  const maxRow = Math.max(startRow, endRow);
  const minColumn = Math.min(startColumn, endColumn);
  const maxColumn = Math.max(startColumn, endColumn);
  if (minRow === maxRow && minColumn === maxColumn) {
    return { changed: false, code: "merge-invalid-selection", message: "Select at least two cells to merge.", source: table.source };
  }
  const selected = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const cell = table.rows[row]?.cells[column];
      if (cell === undefined) {
        return { changed: false, code: "merge-invalid-selection", message: "The selected cells are unavailable.", source: table.source };
      }
      selected.push(cell);
    }
  }
  const role = selected[0]?.role;
  if (role === undefined || selected.some((cell) => cell.role !== role)) {
    return { changed: false, code: "merge-crosses-role", message: "A merge cannot cross a header or data-region boundary.", source: table.source };
  }
  if (selected.some((cell) => {
    const anchor = table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
    if (anchor === undefined) return true;
    const anchorMaxRow = anchor.anchorRow + anchor.rowSpan - 1;
    const anchorMaxColumn = anchor.anchorColumn + anchor.columnSpan - 1;
    return anchor.anchorRow < minRow || anchor.anchorColumn < minColumn
      || anchorMaxRow > maxRow || anchorMaxColumn > maxColumn;
  })) {
    return { changed: false, code: "merge-partial-existing", message: "The selection must include each existing merged cell in full.", source: table.source };
  }
  const topLeft = table.rows[minRow]?.cells[minColumn];
  if (topLeft === undefined) {
    return { changed: false, code: "cell-unavailable", message: "The current cell is unavailable.", source: table.source };
  }
  if (topLeft.rowSpan === maxRow - minRow + 1 && topLeft.columnSpan === maxColumn - minColumn + 1) {
    return { changed: false, code: "already-merged", message: "The selected cells are already merged.", source: table.source };
  }
  const anchors = selected.filter((cell) => !cell.covered);
  if (anchors.some((cell) => cell !== topLeft && cell.content.length > 0)) {
    return { changed: false, code: "content-would-be-lost", message: "Clear every selected cell except the top-left cell before merging so no content is lost.", source: table.source };
  }
  const values = rawValues(table);
  for (let row = minRow; row <= maxRow; row += 1) {
    const rowValues = values[row];
    if (rowValues === undefined) {
      return { changed: false, code: "row-unavailable", message: "The current row is unavailable.", source: table.source };
    }
    for (let column = minColumn; column <= maxColumn; column += 1) {
      if (row === minRow && column === minColumn) continue;
      rowValues[column] = row === minRow ? "<" : "^";
    }
  }
  const candidateSource = sourceWithRawCells(table, values);
  const parsed = parseStructuralTables(candidateSource).tables[0] ?? null;
  if (parsed === null || !parsed.valid) {
    return { changed: false, code: "invalid-result", message: parsed?.diagnostics[0]?.message ?? "That merge would create an invalid table.", source: table.source };
  }
  return { changed: true, code: "merged", message: "Cells merged.", source: serializeStructuralTable(parsed) };
}

export function splitCell(table: StructuralTable, row: number, column: number): OperationResult {
  if (!table.valid) return { changed: false, code: "table-invalid", message: "The table must be valid before splitting cells.", source: table.source };
  const cell = table.rows[row]?.cells[column];
  if (cell === undefined) return { changed: false, code: "cell-unavailable", message: "The current cell is unavailable.", source: table.source };
  const anchor = table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
  if (anchor === undefined || (anchor.rowSpan === 1 && anchor.columnSpan === 1)) {
    return { changed: false, code: "not-merged", message: "The current cell is not merged.", source: table.source };
  }
  const values = rawValues(table);
  for (const candidateRow of table.rows) {
    for (const candidate of candidateRow.cells) {
      if (
        candidate.anchorRow === anchor.row
        && candidate.anchorColumn === anchor.column
        && candidate !== anchor
      ) {
        const rowValues = values[candidate.row];
        if (rowValues !== undefined) rowValues[candidate.column] = "";
      }
    }
  }
  const candidateSource = sourceWithRawCells(table, values);
  const parsed = parseStructuralTables(candidateSource).tables[0] ?? null;
  if (parsed !== null && !parsed.valid) {
    return { changed: false, code: "split-unsafe", message: "The split could not be represented safely.", source: table.source };
  }
  return {
    changed: true,
    code: "split",
    message: "Merged cell split.",
    source: parsed === null ? candidateSource : serializeStructuralTable(parsed),
  };
}

export function setHeaderRowCount(table: StructuralTable, count: number): OperationResult {
  if (!table.valid) return { changed: false, code: "table-invalid", message: "The table must be valid before changing headers.", source: table.source };
  if (!Number.isInteger(count) || count < 1 || count > table.rows.length) {
    return { changed: false, code: "header-count-invalid", message: "Column headers must use one or more rows from the top of the table.", source: table.source };
  }
  if (count === table.headerRowCount) {
    return { changed: false, code: "header-rows-set", message: "Those rows are already column headers.", source: table.source };
  }
  const candidateSource = sourceWithRawCells(table, rawValues(table), count);
  const parsed = parseStructuralTables(candidateSource).tables[0] ?? null;
  if (parsed !== null && !parsed.valid) {
    return { changed: false, code: "invalid-result", message: parsed.diagnostics[0]?.message ?? "That header boundary would create an invalid table.", source: table.source };
  }
  return {
    changed: true,
    code: "header-rows-set",
    message: "Column-header rows updated.",
    source: parsed === null ? candidateSource : serializeStructuralTable(parsed),
  };
}

export function setRowHeaderColumnCount(table: StructuralTable, count: number): OperationResult {
  if (!table.valid) return { changed: false, code: "table-invalid", message: "The table must be valid before changing headers.", source: table.source };
  if (!Number.isInteger(count) || count < 0 || count >= table.columnCount) {
    return { changed: false, code: "row-header-count-invalid", message: "Row headers must use consecutive columns from the left and leave at least one data column.", source: table.source };
  }
  if (count === table.rowHeaderColumnCount) {
    return { changed: false, code: "row-headers-set", message: "Those columns are already row headers.", source: table.source };
  }
  const candidateSource = sourceWithRawCells(table, rawValues(table), table.headerRowCount, count);
  const parsed = parseStructuralTables(candidateSource).tables[0] ?? null;
  if (parsed !== null && !parsed.valid) {
    return { changed: false, code: "invalid-result", message: parsed.diagnostics[0]?.message ?? "That row-header boundary would create an invalid table.", source: table.source };
  }
  return {
    changed: true,
    code: "row-headers-set",
    message: "Row-header columns updated.",
    source: parsed === null ? candidateSource : serializeStructuralTable(parsed),
  };
}

export function cellColumnAt(line: string, character: number): number | null {
  let column = line.trimStart().startsWith("|") ? -1 : 0;
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < Math.min(character, line.length); index += 1) {
    const current = line[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (current === "\\") {
      escaped = true;
      continue;
    }
    if (current === "`") {
      let run = 1;
      while (line[index + run] === "`") run += 1;
      if (codeTicks === 0) codeTicks = run;
      else if (codeTicks === run) codeTicks = 0;
      index += run - 1;
    } else if (current === "|" && codeTicks === 0) column += 1;
  }
  return column < 0 ? 0 : column;
}
