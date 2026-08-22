import type { StructuralTable } from "./model";
import { parseStructuralTables } from "./parser";
import { serializeStructuralTable } from "./serializer";

export type MergeDirection = "left" | "up";

export interface OperationResult {
  changed: boolean;
  message: string;
  source: string;
}

function sourceWithRawCells(table: StructuralTable, values: string[][]): string {
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
  const delimiterText = table.rowHeaderColumnCount === 0
    ? `| ${delimiter.join(" | ")} |`
    : `| ${delimiter.slice(0, table.rowHeaderColumnCount).join(" | ")} || ${delimiter.slice(table.rowHeaderColumnCount).join(" | ")} |`;
  provisional.splice(table.headerRowCount, 0, delimiterText);
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
  if (!table.valid) return { changed: false, message: "The table must be valid before editing merges.", source: table.source };
  const cell = table.rows[row]?.cells[column];
  const target = direction === "left" ? table.rows[row]?.cells[column - 1] : table.rows[row - 1]?.cells[column];
  if (cell === undefined || target === undefined) {
    return { changed: false, message: `There is no cell ${direction === "left" ? "to the left" : "above"}.`, source: table.source };
  }
  if (cell.content.length > 0 && cell.marker === undefined) {
    return { changed: false, message: "Clear the current cell before merging so no content is lost.", source: table.source };
  }
  if (cell.role !== target.role) {
    return { changed: false, message: "A merge cannot cross a header or data-region boundary.", source: table.source };
  }
  const values = rawValues(table);
  const rowValues = values[row];
  if (rowValues === undefined) return { changed: false, message: "The current row is unavailable.", source: table.source };
  rowValues[column] = direction === "left" ? "<" : "^";
  const candidateSource = sourceWithRawCells(table, values);
  const parsed = parseStructuralTables(candidateSource).tables[0] ?? null;
  if (parsed === null || !parsed.valid) {
    return { changed: false, message: parsed?.diagnostics[0]?.message ?? "That merge would create an invalid table.", source: table.source };
  }
  return { changed: true, message: "Cells merged.", source: serializeStructuralTable(parsed) };
}

export function splitCell(table: StructuralTable, row: number, column: number): OperationResult {
  if (!table.valid) return { changed: false, message: "The table must be valid before splitting cells.", source: table.source };
  const cell = table.rows[row]?.cells[column];
  if (cell === undefined) return { changed: false, message: "The current cell is unavailable.", source: table.source };
  const anchor = table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
  if (anchor === undefined || (anchor.rowSpan === 1 && anchor.columnSpan === 1)) {
    return { changed: false, message: "The current cell is not merged.", source: table.source };
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
    return { changed: false, message: "The split could not be represented safely.", source: table.source };
  }
  return {
    changed: true,
    message: "Merged cell split.",
    source: parsed === null ? candidateSource : serializeStructuralTable(parsed),
  };
}

export function cellColumnAt(line: string, character: number): number | null {
  let column = line.trimStart().startsWith("|") ? -1 : 0;
  let escaped = false;
  let ticks = 0;
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
    if (current === "`") ticks = ticks === 0 ? 1 : 0;
    else if (current === "|" && ticks === 0) column += 1;
  }
  return column < 0 ? 0 : column;
}
