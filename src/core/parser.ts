import type {
  CellRole,
  ColumnAlignment,
  MergeMarker,
  ParseResult,
  StructuralCell,
  StructuralRow,
  StructuralTable,
  TableDiagnostic,
} from "./model";
import { ignoredMarkdownLines, sourceLines, sourcePrefix } from "./source-lines";
import { splitTablePipeRow, type ParsedTablePipeRow } from "./table-cell-syntax";

interface ParsedDelimiter {
  alignments: ColumnAlignment[];
  columnCount: number;
  diagnostics: TableDiagnostic[];
  rowHeaderColumnCount: number;
}

const DELIMITER_CELL = /^:?-+:?$/u;

function alignmentFor(token: string): ColumnAlignment {
  const trimmed = token.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.startsWith(":")) return "left";
  if (trimmed.endsWith(":")) return "right";
  return "default";
}

function parseDelimiter(line: string, sourceLine: number): ParsedDelimiter | null {
  const parsed = splitTablePipeRow(line);
  if (parsed === null) return null;
  const diagnostics: TableDiagnostic[] = [];
  const boundaryIndexes = parsed.cells.flatMap((cell, index) => cell.trim() === "" ? [index] : []);
  const nonExactEmpty = parsed.cells.findIndex((cell) => cell !== "" && cell.trim() === "");
  if (nonExactEmpty >= 0) {
    diagnostics.push({
      code: "boundary-token",
      message: "A row-header divider must be an adjacent || with no spaces between the pipes.",
      row: sourceLine,
      column: nonExactEmpty,
    });
  }
  if (boundaryIndexes.length > 1) {
    diagnostics.push({
      code: "boundary-count",
      message: "A delimiter row can contain at most one row-header divider (||).",
      row: sourceLine,
    });
  }
  const boundary = boundaryIndexes[0];
  if (boundary !== undefined && (boundary === 0 || boundary === parsed.cells.length - 1)) {
    diagnostics.push({
      code: "boundary-at-edge",
      message: "The row-header divider (||) must be between two delimiter cells.",
      row: sourceLine,
      column: boundary,
    });
  }
  const tokens = parsed.cells.filter((_cell, index) => !boundaryIndexes.includes(index));
  if (tokens.length === 0 || tokens.some((token) => !DELIMITER_CELL.test(token.trim()))) return null;
  const rowHeaderColumnCount = boundary === undefined ? 0 : boundary;
  return {
    alignments: tokens.map(alignmentFor),
    columnCount: tokens.length,
    diagnostics,
    rowHeaderColumnCount,
  };
}

function roleFor(row: number, column: number, headerRows: number, rowHeaders: number): CellRole {
  if (row < headerRows) return column < rowHeaders ? "corner_header" : "column_header";
  return column < rowHeaders ? "row_header" : "data";
}

function markerFor(raw: string): { content: string; marker?: MergeMarker } {
  const trimmed = raw.trim();
  if (trimmed === "<") return { content: "", marker: "left" };
  if (trimmed === "^") return { content: "", marker: "up" };
  if (trimmed === "\\<") return { content: "<" };
  if (trimmed === "\\<\\<") return { content: "<<" };
  if (trimmed === "\\^\\^") return { content: "^^" };
  if (trimmed === "\\^") return { content: "^" };
  return { content: trimmed };
}

function resolveMerges(rows: StructuralRow[], diagnostics: TableDiagnostic[]): void {
  const anchors = new Map<string, StructuralCell[]>();
  const key = (row: number, column: number): string => `${row}:${column}`;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.marker === undefined) {
        cell.anchorRow = cell.row;
        cell.anchorColumn = cell.column;
      } else {
        const targetRow = cell.marker === "up" ? cell.row - 1 : cell.row;
        const targetColumn = cell.marker === "left" ? cell.column - 1 : cell.column;
        const target = rows[targetRow]?.cells[targetColumn];
        if (target === undefined) {
          diagnostics.push({
            code: "merge-missing-anchor",
            message: `Merge marker ${cell.marker === "left" ? "<" : "^"} has no cell to merge with.`,
            row: rows[cell.row]?.sourceLine ?? cell.row,
            column: cell.column,
          });
          continue;
        }
        cell.anchorRow = target.anchorRow;
        cell.anchorColumn = target.anchorColumn;
        const anchor = rows[cell.anchorRow]?.cells[cell.anchorColumn];
        if (anchor === undefined || anchor.marker !== undefined) {
          diagnostics.push({
            code: "merge-missing-anchor",
            message: "Merge markers must resolve to a content cell.",
            row: rows[cell.row]?.sourceLine ?? cell.row,
            column: cell.column,
          });
          continue;
        }
        if (anchor.role !== cell.role) {
          diagnostics.push({
            code: "merge-boundary",
            message: "A merged cell cannot cross header or data-region boundaries.",
            row: rows[cell.row]?.sourceLine ?? cell.row,
            column: cell.column,
          });
        }
      }
      const anchorKey = key(cell.anchorRow, cell.anchorColumn);
      const group = anchors.get(anchorKey) ?? [];
      group.push(cell);
      anchors.set(anchorKey, group);
    }
  }
  for (const [anchorKey, group] of anchors) {
    if (group.length === 1) continue;
    const [anchorRowText, anchorColumnText] = anchorKey.split(":");
    const anchorRow = Number(anchorRowText);
    const anchorColumn = Number(anchorColumnText);
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = Number.NEGATIVE_INFINITY;
    let minColumn = Number.POSITIVE_INFINITY;
    let maxColumn = Number.NEGATIVE_INFINITY;
    for (const cell of group) {
      if (cell.row < minRow) minRow = cell.row;
      if (cell.row > maxRow) maxRow = cell.row;
      if (cell.column < minColumn) minColumn = cell.column;
      if (cell.column > maxColumn) maxColumn = cell.column;
    }
    let rectangular = minRow === anchorRow && minColumn === anchorColumn;
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        const cell = rows[row]?.cells[column];
        if (cell === undefined || cell.anchorRow !== anchorRow || cell.anchorColumn !== anchorColumn) {
          rectangular = false;
        }
      }
    }
    if (!rectangular) {
      diagnostics.push({
        code: "merge-nonrectangular",
        message: "Merged cells must form one complete rectangle.",
        row: rows[anchorRow]?.sourceLine ?? anchorRow,
        column: anchorColumn,
      });
      continue;
    }
    const anchor = rows[anchorRow]?.cells[anchorColumn];
    if (anchor !== undefined) {
      anchor.rowSpan = maxRow - minRow + 1;
      anchor.columnSpan = maxColumn - minColumn + 1;
    }
    for (const cell of group) cell.covered = cell !== anchor;
  }
}

function parseTables(source: string, includeOrdinary: boolean): ParseResult {
  const { lines: originalLines, offsets } = sourceLines(source);
  const ignored = ignoredMarkdownLines(originalLines);
  const prefixes = originalLines.map(sourcePrefix);
  const lines = originalLines.map((line, index) => line.slice(prefixes[index]?.length ?? 0));
  const tables: StructuralTable[] = [];
  const consumed = new Set<number>();
  let sourceTableIndex = 0;
  for (let delimiterLine = 0; delimiterLine < lines.length; delimiterLine += 1) {
    if (ignored.has(delimiterLine) || consumed.has(delimiterLine)) continue;
    const delimiter = parseDelimiter(lines[delimiterLine] ?? "", delimiterLine);
    if (delimiter === null) continue;
    const prefix = prefixes[delimiterLine] ?? "";
    const sameContainer = (line: number): boolean => prefixes[line] === prefix;
    const compactHeaders: { line: number; parsed: ParsedTablePipeRow }[] = [];
    const immediateLine = delimiterLine - 1;
    const immediateHeader = ignored.has(immediateLine) || !sameContainer(immediateLine)
      ? null : splitTablePipeRow(lines[immediateLine] ?? "");
    if (immediateHeader !== null) {
      compactHeaders.push({ line: immediateLine, parsed: immediateHeader });
      if (immediateHeader.cells.length === delimiter.columnCount) {
        for (let line = delimiterLine - 2; line >= 0; line -= 1) {
          const parsed = ignored.has(line) || !sameContainer(line) ? null : splitTablePipeRow(lines[line] ?? "");
          if (parsed === null || parsed.cells.length !== delimiter.columnCount) break;
          compactHeaders.unshift({ line, parsed });
        }
      }
    }
    const bodyRows: { line: number; parsed: ParsedTablePipeRow }[] = [];
    for (let line = delimiterLine + 1; line < lines.length; line += 1) {
      if (ignored.has(line) || !sameContainer(line) || (lines[line] ?? "").trim() === "") break;
      const parsed = splitTablePipeRow(lines[line] ?? "");
      if (parsed === null) break;
      bodyRows.push({ line, parsed });
    }
    if (compactHeaders.length === 0 && bodyRows.length === 0) continue;

    // A compatible table has exactly one physical GFM header row immediately
    // above its normal delimiter; extra semantic headers appear below it.
    const compatibleRows = immediateHeader === null
      ? [] : [{ line: immediateLine, parsed: immediateHeader }, ...bodyRows];
    const physicalWidth = delimiter.columnCount;
    const compatibleWidth = compatibleRows.length > 0
      && compatibleRows.every(({ parsed }) => parsed.cells.length === physicalWidth);
    const boundaryColumns = compatibleWidth && delimiter.rowHeaderColumnCount === 0
      ? Array.from({ length: physicalWidth - 2 }, (_unused, column) => column + 1)
        .filter((column) => compatibleRows.every(({ parsed }) => parsed.cells[column]?.trim() === "<<"))
      : [];
    const boundaryColumn = boundaryColumns.length === 1 ? boundaryColumns[0] : undefined;
    const markerRows = compatibleWidth && delimiter.rowHeaderColumnCount === 0
      ? compatibleRows.flatMap(({ parsed }, index) => (
        parsed.cells.every((raw, column) => raw.trim() === (column === boundaryColumn ? "<<" : "^^"))
          ? [index] : []
      )) : [];
    const compatible = compatibleWidth && delimiter.rowHeaderColumnCount === 0
      && (markerRows.length > 0 || boundaryColumn !== undefined);
    const headerRowCount = compatible
      ? (markerRows[0] ?? 1) : compactHeaders.length;
    const sourceRows = compatible
      ? compatibleRows.filter((_row, index) => index !== markerRows[0])
      : [...compactHeaders, ...bodyRows];
    const firstLine = compatible ? immediateLine : compactHeaders[0]?.line ?? delimiterLine;
    const lastLine = bodyRows[bodyRows.length - 1]?.line ?? delimiterLine;
    for (let line = firstLine; line <= lastLine; line += 1) consumed.add(line);
    const tableIndex = sourceTableIndex;
    sourceTableIndex += 1;
    const controlColumn = compatible ? boundaryColumn : undefined;
    const columnCount = physicalWidth - (controlColumn === undefined ? 0 : 1);
    const rowHeaderColumnCount = compatible ? boundaryColumn ?? 0 : delimiter.rowHeaderColumnCount;
    const alignments = delimiter.alignments.filter((_alignment, column) => column !== controlColumn);
    const hasMerge = sourceRows.some(({ parsed }) => parsed.cells.some((raw) => {
      const trimmed = raw.trim();
      return trimmed === "<" || trimmed === "^";
    }));
    const structural = compatible || hasMerge || rowHeaderColumnCount > 0
      || (!compatible && compactHeaders.length !== 1) || delimiter.diagnostics.length > 0;
    if (!structural && !includeOrdinary) continue;
    const diagnostics = [...delimiter.diagnostics];
    if (compatible && (markerRows.length > 1 || boundaryColumns.length > 1)) {
      diagnostics.push({
        code: "boundary-count",
        message: "A compatible table must have at most one complete ^^ row and one << column.",
        row: compatibleRows[markerRows[1] ?? 0]?.line ?? delimiterLine,
      });
    }
    if (compatible && controlColumn !== undefined && (controlColumn === 0 || controlColumn >= physicalWidth - 1)) {
      diagnostics.push({
        code: "boundary-at-edge",
        message: "The << control column must leave at least one real column on either side.",
        row: firstLine,
        column: controlColumn,
      });
    }
    const rows: StructuralRow[] = sourceRows.map(({ line, parsed }, row) => {
      const sourceCellCount = parsed.cells.length - (controlColumn === undefined ? 0 : 1);
      if (parsed.cells.length !== physicalWidth
        && (compatible || row < compactHeaders.length || structural)) {
        diagnostics.push({
          code: "row-width",
          message: "Expected " + physicalWidth + " cells, received " + parsed.cells.length + ".",
          row: line,
        });
      }
      const values = parsed.cells.filter((_cell, column) => column !== controlColumn);
      const cells = Array.from({ length: columnCount }, (_unused, column) => values[column] ?? "")
        .map((raw, column): StructuralCell => {
          const marker = markerFor(raw);
          return {
            row, column, raw,
            content: marker.content,
            role: roleFor(row, column, headerRowCount, rowHeaderColumnCount),
            ...(marker.marker === undefined ? {} : { marker: marker.marker }),
            anchorRow: row, anchorColumn: column, rowSpan: 1, columnSpan: 1, covered: false,
          };
        });
      return { sourceLine: line, sourceCellCount, cells };
    });
    if (rows.every((row) => row.cells.length === columnCount)) resolveMerges(rows, diagnostics);
    const from = offsets[firstLine] ?? 0;
    const to = (offsets[lastLine] ?? from) + (originalLines[lastLine]?.length ?? 0);
    tables.push({
      sourcePrefix: prefix,
      sourceSyntax: compatible ? "compatible" : "compact",
      range: { from, to },
      sourceTableIndex: tableIndex,
      startLine: firstLine,
      endLine: lastLine,
      delimiterLine,
      columnCount,
      headerRowCount,
      rowHeaderColumnCount,
      alignments,
      rows,
      diagnostics,
      structural,
      valid: diagnostics.length === 0,
      source: source.slice(from, to),
    });
  }
  return { tables };
}

export function parseStructuralTables(source: string): ParseResult {
  return parseTables(source, false);
}

export function parseEditableTables(source: string): ParseResult {
  return parseTables(source, true);
}
