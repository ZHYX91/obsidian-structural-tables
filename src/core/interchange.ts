import type { ColumnAlignment, StructuralCell, StructuralTable } from "./model";
import { parseEditableTables } from "./parser";
import { serializeStructuralTable } from "./serializer";

export interface TabularProjection {
  columnNames: string[];
  rows: string[][];
  alignments: ColumnAlignment[];
}

export interface SheetsExtendedMigration {
  separatorColumn: number;
  source: string;
}

export interface ImportedHtmlCell {
  text: string;
  rowSpan: number;
  columnSpan: number;
  header: boolean;
}

export interface ImportedHtmlRow {
  cells: ImportedHtmlCell[];
  section: "head" | "body";
}

interface ImportedAnchor extends ImportedHtmlCell {
  row: number;
  column: number;
}

const CONFLICTING_PLUGIN_IDS = new Map<string, string>([
  ["sheets", "Sheets Extended"],
  ["sheets-extended", "Sheets Extended"],
  ["table-extended", "Table Extended"],
  ["table-master", "Table Master"],
]);

function anchorFor(table: StructuralTable, cell: StructuralCell): StructuralCell {
  return table.rows[cell.anchorRow]?.cells[cell.anchorColumn] ?? cell;
}

function portableCell(content: string): string {
  const singleLine = content.replace(/\r?\n|\r/gu, " ").trim();
  let output = "";
  for (let index = 0; index < singleLine.length; index += 1) {
    const character = singleLine[index] ?? "";
    if (character !== "|") {
      output += character;
      continue;
    }
    let slashes = 0;
    for (let before = index - 1; before >= 0 && singleLine[before] === "\\"; before -= 1) slashes += 1;
    output += slashes % 2 === 0 ? "\\|" : "|";
  }
  if (output === "<" || output === "^") return `\\${output}`;
  return output;
}

function delimiterFor(alignment: ColumnAlignment): string {
  if (alignment === "left") return ":---";
  if (alignment === "center") return ":---:";
  if (alignment === "right") return "---:";
  return "---";
}

function columnName(table: StructuralTable, column: number): string {
  const parts: string[] = [];
  let previousAnchor = "";
  for (let row = 0; row < table.headerRowCount; row += 1) {
    const cell = table.rows[row]?.cells[column];
    if (cell === undefined) continue;
    const anchor = anchorFor(table, cell);
    const anchorKey = `${anchor.row}:${anchor.column}`;
    const content = anchor.content.trim();
    if (anchorKey !== previousAnchor && content !== "") parts.push(content);
    previousAnchor = anchorKey;
  }
  return parts.join(" / ") || `Column ${column + 1}`;
}

export function projectStructuralTable(table: StructuralTable): TabularProjection {
  if (!table.valid) throw new Error("Cannot project an invalid structural table.");
  const rows = table.rows.slice(table.headerRowCount).map((row) => row.cells.map((cell) => {
    return anchorFor(table, cell).content;
  }));
  return {
    columnNames: Array.from({ length: table.columnCount }, (_value, column) => columnName(table, column)),
    rows,
    alignments: [...table.alignments],
  };
}

export function structuralTableToPlainGfm(table: StructuralTable): string {
  const projection = projectStructuralTable(table);
  const lines = [
    `| ${projection.columnNames.map(portableCell).join(" | ")} |`,
    `| ${projection.alignments.map(delimiterFor).join(" | ")} |`,
    ...projection.rows.map((row) => `| ${row.map(portableCell).join(" | ")} |`),
  ];
  return lines.join(table.source.includes("\r\n") ? "\r\n" : table.source.includes("\r") ? "\r" : "\n");
}

function delimitedCell(value: string, delimiter: "," | "\t"): string {
  const normalized = value.replace(/\r?\n|\r/gu, " ");
  if (delimiter === "\t") return normalized.replace(/\t/gu, " ");
  return /[",\r\n]/u.test(normalized) ? `"${normalized.replace(/"/gu, "\"\"")}"` : normalized;
}

export function structuralTableToDelimited(table: StructuralTable, delimiter: "," | "\t"): string {
  const projection = projectStructuralTable(table);
  return [projection.columnNames, ...projection.rows]
    .map((row) => row.map((value) => delimitedCell(value, delimiter)).join(delimiter))
    .join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function htmlCell(table: StructuralTable, cell: StructuralCell): string {
  const tag = cell.role === "data" ? "td" : "th";
  const attributes: string[] = [];
  if (cell.rowSpan > 1) attributes.push(`rowspan="${cell.rowSpan}"`);
  if (cell.columnSpan > 1) attributes.push(`colspan="${cell.columnSpan}"`);
  const alignment = table.alignments[cell.column] ?? "default";
  if (alignment !== "default") attributes.push(`style="text-align: ${alignment}"`);
  if (cell.role === "row_header") attributes.push(`scope="${cell.rowSpan > 1 ? "rowgroup" : "row"}"`);
  if (cell.role === "column_header") attributes.push(`scope="${cell.columnSpan > 1 ? "colgroup" : "col"}"`);
  const suffix = attributes.length === 0 ? "" : ` ${attributes.join(" ")}`;
  return `    <${tag}${suffix}>${escapeHtml(cell.content)}</${tag}>`;
}

export function structuralTableToHtml(table: StructuralTable): string {
  if (!table.valid) throw new Error("Cannot export an invalid structural table.");
  const sections: string[] = ["<table>"];
  const headRows = table.rows.slice(0, table.headerRowCount);
  const bodyRows = table.rows.slice(table.headerRowCount);
  const appendRows = (tag: "thead" | "tbody", rows: typeof table.rows): void => {
    if (rows.length === 0) return;
    sections.push(`  <${tag}>`);
    for (const row of rows) {
      sections.push("  <tr>");
      for (const cell of row.cells) if (!cell.covered) sections.push(htmlCell(table, cell));
      sections.push("  </tr>");
    }
    sections.push(`  </${tag}>`);
  };
  appendRows("thead", headRows);
  appendRows("tbody", bodyRows);
  sections.push("</table>");
  return sections.join("\n");
}

function sourceWithoutColumn(table: StructuralTable, separatorColumn: number): string {
  const alignments = table.alignments.filter((_alignment, column) => column !== separatorColumn);
  const rows = table.rows.map((row) => row.cells
    .filter((_cell, column) => column !== separatorColumn)
    .map((cell) => cell.raw.trim()));
  const delimiter = alignments.map(delimiterFor);
  const delimiterText = `| ${delimiter.slice(0, separatorColumn).join(" | ")} || ${delimiter.slice(separatorColumn).join(" | ")} |`;
  const lines = rows.map((row) => `| ${row.join(" | ")} |`);
  lines.splice(table.headerRowCount, 0, delimiterText);
  return lines.join(table.source.includes("\r\n") ? "\r\n" : table.source.includes("\r") ? "\r" : "\n");
}

export function migrateSheetsExtendedTable(table: StructuralTable): SheetsExtendedMigration | null {
  if (!table.valid || table.columnCount < 3) return null;
  const separatorColumns = Array.from({ length: table.columnCount }, (_value, column) => column)
    .filter((column) => table.rows.every((row) => row.cells[column]?.raw.trim() === "-"));
  if (separatorColumns.length !== 1) return null;
  const separatorColumn = separatorColumns[0];
  if (separatorColumn === undefined || separatorColumn === 0 || separatorColumn === table.columnCount - 1) return null;
  const candidate = sourceWithoutColumn(table, separatorColumn);
  const parsed = parseEditableTables(candidate).tables[0];
  if (parsed === undefined || !parsed.valid) return null;
  return { separatorColumn, source: serializeStructuralTable(parsed) };
}

export function enabledConflictingPlugins(enabledPluginIds: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const id of enabledPluginIds) {
    const name = CONFLICTING_PLUGIN_IDS.get(id);
    if (name !== undefined) names.add(name);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

export function importedHtmlTableToStructuralSource(rows: readonly ImportedHtmlRow[]): string | null {
  if (rows.length === 0 || rows.every((row) => row.cells.length === 0)) return null;
  const owners: (ImportedAnchor | undefined)[][] = rows.map(() => []);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const sourceRow = rows[rowIndex];
    if (sourceRow === undefined) continue;
    const rowOwners = owners[rowIndex] ?? [];
    let column = 0;
    for (const sourceCell of sourceRow.cells) {
      while (rowOwners[column] !== undefined) column += 1;
      const rowSpan = Math.max(1, Math.min(sourceCell.rowSpan, rows.length - rowIndex));
      const columnSpan = Math.max(1, sourceCell.columnSpan);
      const anchor: ImportedAnchor = { ...sourceCell, rowSpan, columnSpan, row: rowIndex, column };
      for (let coveredRow = rowIndex; coveredRow < rowIndex + rowSpan; coveredRow += 1) {
        const target = owners[coveredRow] ?? [];
        owners[coveredRow] = target;
        for (let coveredColumn = column; coveredColumn < column + columnSpan; coveredColumn += 1) {
          if (target[coveredColumn] !== undefined) return null;
          target[coveredColumn] = anchor;
        }
      }
      column += columnSpan;
    }
  }
  const columnCount = Math.max(...owners.map((row) => row.length));
  if (columnCount < 2) return null;
  for (let row = 0; row < owners.length; row += 1) {
    const target = owners[row] ?? [];
    for (let column = 0; column < columnCount; column += 1) {
      if (target[column] === undefined) {
        target[column] = {
          text: "",
          rowSpan: 1,
          columnSpan: 1,
          header: false,
          row,
          column,
        };
      }
    }
  }
  let headerRowCount = 0;
  for (const [rowIndex, row] of rows.entries()) {
    if (row.section !== "head" && !row.cells.every((cell) => cell.header)) break;
    headerRowCount = rowIndex + 1;
  }
  if (headerRowCount === 0) headerRowCount = 1;
  const bodyOwners = owners.slice(headerRowCount);
  let rowHeaderColumnCount = 0;
  for (let column = 0; column < columnCount - 1 && bodyOwners.length > 0; column += 1) {
    if (!bodyOwners.every((row) => row[column]?.header === true)) break;
    rowHeaderColumnCount = column + 1;
  }
  const values = owners.map((row, rowIndex) => row.map((anchor, columnIndex) => {
    if (anchor === undefined) return "";
    if (anchor.row === rowIndex && anchor.column === columnIndex) return portableCell(anchor.text);
    return anchor.row === rowIndex ? "<" : "^";
  }));
  const delimiters = Array.from({ length: columnCount }, () => "---");
  const delimiter = rowHeaderColumnCount === 0
    ? `| ${delimiters.join(" | ")} |`
    : `| ${delimiters.slice(0, rowHeaderColumnCount).join(" | ")} || ${delimiters.slice(rowHeaderColumnCount).join(" | ")} |`;
  const lines = values.map((row) => `| ${row.join(" | ")} |`);
  lines.splice(headerRowCount, 0, delimiter);
  const candidate = lines.join("\n");
  const parsed = parseEditableTables(candidate).tables[0];
  return parsed !== undefined && parsed.valid ? serializeStructuralTable(parsed) : null;
}
