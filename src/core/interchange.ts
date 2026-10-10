import type { ColumnAlignment, StructuralCell, StructuralTable } from "./model";
import { parseTableWrite } from "./table-write-validation";
import { serializeStructuralTable } from "./serializer";
import { existingTableCellText, mathCellInputProblem } from "./table-cell-syntax";
import { hasHiddenGfmOverflow } from "./table-write-safety";

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
  return existingTableCellText(content);
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
  const header = table.headerRowCount === 0
    ? Array.from({ length: table.columnCount }, () => "")
    : projection.columnNames;
  const lines = [
    `| ${header.map(portableCell).join(" | ")} |`,
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
  const rows = table.headerRowCount === 0 ? projection.rows : [projection.columnNames, ...projection.rows];
  return rows
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

interface HtmlCellHeaders {
  id: string | undefined;
  headers: string[];
}

function htmlHeaderAssociations(table: StructuralTable, idPrefix: string): Map<StructuralCell, HtmlCellHeaders> {
  const cells = table.rows.flatMap((row) => row.cells.filter((cell) => !cell.covered));
  const headers = cells.filter((cell) => cell.role !== "data");
  const result = new Map<StructuralCell, HtmlCellHeaders>();
  if (headers.length === 0 || (table.headerRowCount <= 1 && table.rowHeaderColumnCount <= 1
    && cells.every((cell) => cell.rowSpan === 1 && cell.columnSpan === 1))) return result;

  const ids = new Map(headers.map((cell) => [cell, `${idPrefix}-r${cell.row}-c${cell.column}`]));
  const columns: StructuralCell[][] = Array.from({ length: table.columnCount }, () => []);
  const corners: StructuralCell[][] = Array.from({ length: table.columnCount }, () => []);
  const rows: StructuralCell[][] = Array.from({ length: table.rows.length }, () => []);
  for (const header of headers) {
    if (header.role === "row_header") {
      for (let row = header.row; row < header.row + header.rowSpan; row += 1) rows[row]!.push(header);
    } else {
      const index = header.role === "corner_header" ? corners : columns;
      for (let column = header.column; column < header.column + header.columnSpan; column += 1) index[column]!.push(header);
    }
  }
  for (const cell of cells) {
    const associated = new Set<StructuralCell>();
    // Corner titles label the row-header columns beneath them. They do not
    // describe every data cell merely because they sit in the table's corner.
    const columnIndex = cell.role === "row_header" || cell.role === "corner_header" ? corners : columns;
    for (let column = cell.column; column < cell.column + cell.columnSpan; column += 1) {
      for (const header of columnIndex[column]!) {
        if (header.row + header.rowSpan <= cell.row) associated.add(header);
      }
    }
    if (cell.role === "data" || cell.role === "row_header") {
      for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) {
        for (const header of rows[row]!) {
          if (header.column + header.columnSpan <= cell.column) associated.add(header);
        }
      }
    }
    result.set(cell, {
      id: ids.get(cell),
      headers: [...associated].sort((left, right) => left.row - right.row || left.column - right.column)
        .map((header) => ids.get(header)!),
    });
  }
  return result;
}

function htmlCell(table: StructuralTable, cell: StructuralCell, association?: HtmlCellHeaders): string {
  const tag = cell.role === "data" ? "td" : "th";
  const attributes: string[] = [];
  if (cell.rowSpan > 1) attributes.push(`rowspan="${cell.rowSpan}"`);
  if (cell.columnSpan > 1) attributes.push(`colspan="${cell.columnSpan}"`);
  const alignment = table.alignments[cell.column] ?? "default";
  if (alignment !== "default") attributes.push(`style="text-align: ${alignment}"`);
  if (cell.role === "row_header" && cell.rowSpan === 1) attributes.push('scope="row"');
  if (cell.role === "column_header" && cell.columnSpan === 1) attributes.push('scope="col"');
  if (association?.id !== undefined) attributes.push(`id="${association.id}"`);
  // An explicit empty list also suppresses implicit header guessing for
  // top-level headers and corner titles in a complex table.
  if (association !== undefined) attributes.push(`headers="${association.headers.join(" ")}"`);
  const suffix = attributes.length === 0 ? "" : ` ${attributes.join(" ")}`;
  const content = cell.content
    .split(/(<br\s*\/?>)/giu)
    .map((part) => /^<br\s*\/?>$/iu.test(part) ? "<br>" : escapeHtml(part))
    .join("");
  return `    <${tag}${suffix}>${content}</${tag}>`;
}

/** The caller supplies a document-wide unique prefix; no host state is used here. */
export function structuralTableToHtml(table: StructuralTable, headerIdPrefix: string): string {
  if (!table.valid) throw new Error("Cannot export an invalid structural table.");
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(headerIdPrefix)) throw new Error("Invalid HTML header ID prefix.");
  const associations = htmlHeaderAssociations(table, headerIdPrefix);
  const sections: string[] = ["<table>"];
  const headRows = table.rows.slice(0, table.headerRowCount);
  const bodyRows = table.rows.slice(table.headerRowCount);
  const appendRows = (tag: "thead" | "tbody", rows: typeof table.rows): void => {
    if (rows.length === 0) return;
    sections.push(`  <${tag}>`);
    for (const row of rows) {
      sections.push("  <tr>");
      for (const cell of row.cells) if (!cell.covered) sections.push(htmlCell(table, cell, associations.get(cell)));
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
  if (!table.valid || hasHiddenGfmOverflow(table) || table.columnCount < 3) return null;
  const separatorColumns = Array.from({ length: table.columnCount }, (_value, column) => column)
    .filter((column) => table.rows.every((row) => row.cells[column]?.raw.trim() === "-"));
  if (separatorColumns.length !== 1) return null;
  const separatorColumn = separatorColumns[0];
  if (separatorColumn === undefined || separatorColumn === 0 || separatorColumn === table.columnCount - 1) return null;
  const candidate = sourceWithoutColumn(table, separatorColumn);
  const values = table.rows.map((row) => row.cells
    .filter((_cell, column) => column !== separatorColumn).map((cell) => cell.raw.trim()));
  const alignments = table.alignments.filter((_alignment, column) => column !== separatorColumn);
  const parsed = parseTableWrite(candidate, values, table.headerRowCount, separatorColumn, alignments);
  if (parsed === null) return null;
  return { separatorColumn, source: serializeStructuralTable({ ...parsed, sourcePrefix: table.sourcePrefix }) };
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
  if (rows.some((row) => row.cells.some((cell) => mathCellInputProblem(cell.text) !== null))) return null;
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
  let columnCount = 0;
  for (const row of owners) if (row.length > columnCount) columnCount = row.length;
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
  const parsed = parseTableWrite(candidate, values, headerRowCount, rowHeaderColumnCount, Array.from({ length: columnCount }, () => "default"));
  return parsed !== null ? serializeStructuralTable(parsed) : null;
}
