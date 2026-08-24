import type { StructuralTable } from "./model";
import { parseStructuralTables } from "./parser";
import { serializeStructuralTable } from "./serializer";

export type MergeDirection = "left" | "up";

export type OperationCode =
  | "already-merged"
  | "cell-unavailable"
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
  return provisional.join("\n");
}

function rawValues(table: StructuralTable): string[][] {
  return table.rows.map((row) => row.cells.map((cell) => cell.raw.trim()));
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
