import type { StructuralTable } from "./model";

export const TABLE_RANGE_CLIPBOARD_MIME = "application/x-structural-tables-range+json";
export const TABLE_RANGE_CLIPBOARD_WEB_MIME = `web ${TABLE_RANGE_CLIPBOARD_MIME}`;

export interface TableRangeClipboardPayloadV1 {
  version: 1;
  rows: number;
  columns: number;
  owners: string[][];
  rawByOwner: Record<string, string>;
}

export interface TableRangeBounds {
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
}

function validBounds(table: StructuralTable, bounds: TableRangeBounds): boolean {
  return Number.isInteger(bounds.minRow) && Number.isInteger(bounds.maxRow)
    && Number.isInteger(bounds.minColumn) && Number.isInteger(bounds.maxColumn)
    && bounds.minRow >= 0 && bounds.minColumn >= 0
    && bounds.minRow <= bounds.maxRow && bounds.minColumn <= bounds.maxColumn
    && bounds.maxRow < table.rows.length && bounds.maxColumn < table.columnCount;
}

export function tableRangePayload(
  table: StructuralTable,
  bounds: TableRangeBounds,
): TableRangeClipboardPayloadV1 | null {
  if (!table.valid || !validBounds(table, bounds)) return null;
  const ownerIds = new Map<string, string>();
  const rawByOwner: Record<string, string> = {};
  const owners: string[][] = [];
  let nextOwner = 0;

  for (let row = bounds.minRow; row <= bounds.maxRow; row += 1) {
    const outputRow: string[] = [];
    for (let column = bounds.minColumn; column <= bounds.maxColumn; column += 1) {
      const cell = table.rows[row]?.cells[column];
      const anchor = cell === undefined ? undefined : table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
      if (cell === undefined || anchor === undefined) return null;
      const anchorMaxRow = anchor.anchorRow + anchor.rowSpan - 1;
      const anchorMaxColumn = anchor.anchorColumn + anchor.columnSpan - 1;
      if (anchor.anchorRow < bounds.minRow || anchor.anchorColumn < bounds.minColumn
        || anchorMaxRow > bounds.maxRow || anchorMaxColumn > bounds.maxColumn) return null;
      const sourceOwner = `${anchor.anchorRow}:${anchor.anchorColumn}`;
      let owner = ownerIds.get(sourceOwner);
      if (owner === undefined) {
        owner = `o${nextOwner}`;
        nextOwner += 1;
        ownerIds.set(sourceOwner, owner);
        rawByOwner[owner] = anchor.raw.trim();
      }
      outputRow.push(owner);
    }
    owners.push(outputRow);
  }

  return {
    version: 1,
    rows: bounds.maxRow - bounds.minRow + 1,
    columns: bounds.maxColumn - bounds.minColumn + 1,
    owners,
    rawByOwner,
  };
}

export function parseTableRangePayload(source: string): TableRangeClipboardPayloadV1 | null {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  const candidate = value as Partial<TableRangeClipboardPayloadV1>;
  if (candidate.version !== 1
    || !Number.isInteger(candidate.rows) || !Number.isInteger(candidate.columns)
    || (candidate.rows ?? 0) < 1 || (candidate.columns ?? 0) < 1
    || !Array.isArray(candidate.owners)
    || candidate.rawByOwner === null || typeof candidate.rawByOwner !== "object"
    || Array.isArray(candidate.rawByOwner)) return null;

  const rows = candidate.rows!;
  const columns = candidate.columns!;
  if (candidate.owners.length !== rows) return null;
  const firstSeen = new Map<string, number>();
  let next = 0;
  for (const row of candidate.owners) {
    if (!Array.isArray(row) || row.length !== columns) return null;
    for (const owner of row) {
      if (typeof owner !== "string") return null;
      if (!Object.prototype.hasOwnProperty.call(candidate.rawByOwner, owner)
        || typeof candidate.rawByOwner[owner] !== "string") return null;
      if (!firstSeen.has(owner)) {
        if (owner !== `o${next}`) return null;
        firstSeen.set(owner, next);
        next += 1;
      }
    }
  }
  if (Object.keys(candidate.rawByOwner).length !== firstSeen.size) return null;
  return candidate as TableRangeClipboardPayloadV1;
}

export function sameTableRangeTopology(
  left: TableRangeClipboardPayloadV1,
  right: TableRangeClipboardPayloadV1,
): boolean {
  if (left.rows !== right.rows || left.columns !== right.columns) return false;
  return left.owners.every((row, rowIndex) =>
    row.every((owner, columnIndex) => owner === right.owners[rowIndex]?.[columnIndex]));
}

function markerFor(
  payload: TableRangeClipboardPayloadV1,
  row: number,
  column: number,
): string {
  const owner = payload.owners[row]![column]!;
  if (column > 0 && payload.owners[row]![column - 1] === owner) return "<";
  if (row > 0 && payload.owners[row - 1]![column] === owner) return "^";
  return payload.rawByOwner[owner] ?? "";
}

function markdownRow(values: readonly string[]): string {
  return `| ${values.join(" | ")} |`;
}

/**
 * Portable plain-text contract: a copied range becomes a standalone GFM-like
 * table whose first copied row is the external header. Structural merge
 * markers are retained where representable.
 */
export function tableRangePlainText(payload: TableRangeClipboardPayloadV1): string {
  const rows = payload.owners.map((_row, row) =>
    Array.from({ length: payload.columns }, (_unused, column) => markerFor(payload, row, column)));
  const delimiter = Array.from({ length: payload.columns }, () => "---");
  return [markdownRow(rows[0] ?? []), markdownRow(delimiter), ...rows.slice(1).map(markdownRow)].join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

/**
 * Synchronous HTML contract for clipboard events. Markdown raw tokens are
 * escaped as text; geometry is represented with rowspan/colspan. All copied
 * rows share one row group so a rowspan from the first copied row stays valid.
 */
export function tableRangeHtml(payload: TableRangeClipboardPayloadV1): string {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (let row = 0; row < payload.rows; row += 1) {
    const cells: string[] = [];
    for (let column = 0; column < payload.columns; column += 1) {
      const owner = payload.owners[row]![column]!;
      if (seen.has(owner)) continue;
      seen.add(owner);
      let rowSpan = 1;
      while (row + rowSpan < payload.rows && payload.owners[row + rowSpan]![column] === owner) rowSpan += 1;
      let columnSpan = 1;
      while (column + columnSpan < payload.columns && payload.owners[row]![column + columnSpan] === owner) columnSpan += 1;
      const tag = row === 0 ? "th" : "td";
      const span = `${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ""}${columnSpan > 1 ? ` colspan="${columnSpan}"` : ""}`;
      cells.push(`<${tag}${span}>${escapeHtml(payload.rawByOwner[owner] ?? "")}</${tag}>`);
    }
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  return `<table><tbody>${rows.join("")}</tbody></table>`;
}
