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

interface ParsedRow {
  cells: string[];
  exactEmptySegments: number[];
}

interface ParsedDelimiter {
  alignments: ColumnAlignment[];
  columnCount: number;
  diagnostics: TableDiagnostic[];
  rowHeaderColumnCount: number;
}

const DELIMITER_CELL = /^:?-+:?$/u;

function parsePipeRow(line: string): ParsedRow | null {
  if (!line.includes("|")) return null;
  const segments: string[] = [];
  let current = "";
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === "`") {
      let run = 1;
      while (line[index + run] === "`") run += 1;
      current += "`".repeat(run);
      if (codeTicks === 0) codeTicks = run;
      else if (codeTicks === run) codeTicks = 0;
      index += run - 1;
      continue;
    }
    if (character === "|" && codeTicks === 0) {
      segments.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  segments.push(current);
  if (segments.length < 2) return null;
  if ((segments[0] ?? "").trim() === "") segments.shift();
  if ((segments[segments.length - 1] ?? "").trim() === "") segments.pop();
  if (segments.length === 0) return null;
  return {
    cells: segments,
    exactEmptySegments: segments.flatMap((segment, index) => segment === "" ? [index] : []),
  };
}

function alignmentFor(token: string): ColumnAlignment {
  const trimmed = token.trim();
  if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
  if (trimmed.startsWith(":")) return "left";
  if (trimmed.endsWith(":")) return "right";
  return "default";
}

function parseDelimiter(line: string, sourceLine: number): ParsedDelimiter | null {
  const parsed = parsePipeRow(line);
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
            row: cell.row,
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
            row: cell.row,
            column: cell.column,
          });
          continue;
        }
        if (anchor.role !== cell.role) {
          diagnostics.push({
            code: "merge-boundary",
            message: "A merged cell cannot cross header or data-region boundaries.",
            row: cell.row,
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
    const minRow = Math.min(...group.map((cell) => cell.row));
    const maxRow = Math.max(...group.map((cell) => cell.row));
    const minColumn = Math.min(...group.map((cell) => cell.column));
    const maxColumn = Math.max(...group.map((cell) => cell.column));
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
        row: anchorRow,
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

function lineOffsets(source: string): { lines: string[]; offsets: number[] } {
  const lines = source.split("\n");
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return { lines, offsets };
}

function ignoredLines(lines: string[]): Set<number> {
  const ignored = new Set<number>();
  let fence: { character: "`" | "~"; length: number } | null = null;
  let frontmatter = lines[0]?.trim() === "---";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (frontmatter) {
      ignored.add(index);
      if (index > 0 && line.trim() === "---") frontmatter = false;
      continue;
    }
    if (fence !== null) {
      ignored.add(index);
      const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/u.exec(line);
      const run = closing?.[1];
      if (run?.[0] === fence.character && run.length >= fence.length) fence = null;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    const run = opening?.[1];
    const info = opening?.[2] ?? "";
    if (run !== undefined && (run[0] === "~" || !info.includes("`"))) {
      fence = { character: run[0] as "`" | "~", length: run.length };
      ignored.add(index);
      continue;
    }
    if (/^(?: {4}|\t)/u.test(line)) ignored.add(index);
  }
  return ignored;
}

export function parseStructuralTables(source: string): ParseResult {
  const { lines, offsets } = lineOffsets(source);
  const ignored = ignoredLines(lines);
  const tables: StructuralTable[] = [];
  const consumed = new Set<number>();
  let sourceTableIndex = 0;
  for (let delimiterLine = 0; delimiterLine < lines.length; delimiterLine += 1) {
    if (ignored.has(delimiterLine) || consumed.has(delimiterLine)) continue;
    const delimiter = parseDelimiter(lines[delimiterLine] ?? "", delimiterLine);
    if (delimiter === null) continue;
    const headerRows: { line: number; parsed: ParsedRow }[] = [];
    const immediateLine = delimiterLine - 1;
    const immediateHeader = ignored.has(immediateLine) ? null : parsePipeRow(lines[immediateLine] ?? "");
    if (immediateHeader === null) continue;
    headerRows.push({ line: immediateLine, parsed: immediateHeader });
    if (immediateHeader.cells.length === delimiter.columnCount) {
      for (let line = delimiterLine - 2; line >= 0; line -= 1) {
        const parsed = ignored.has(line) ? null : parsePipeRow(lines[line] ?? "");
        if (parsed === null || parsed.cells.length !== delimiter.columnCount) break;
        headerRows.unshift({ line, parsed });
      }
    }
    const bodyRows: { line: number; parsed: ParsedRow }[] = [];
    for (let line = delimiterLine + 1; line < lines.length; line += 1) {
      if (ignored.has(line) || (lines[line] ?? "").trim() === "") break;
      const parsed = parsePipeRow(lines[line] ?? "");
      if (parsed === null) break;
      bodyRows.push({ line, parsed });
    }
    const rowSources = [...headerRows, ...bodyRows];
    const hasMarker = rowSources.some(({ parsed }) => parsed.cells.some((raw) => {
      const trimmed = raw.trim();
      return trimmed === "<" || trimmed === "^";
    }));
    const structural = hasMarker
      || delimiter.rowHeaderColumnCount > 0
      || headerRows.length > 1
      || delimiter.diagnostics.length > 0;
    const startLine = headerRows[0]?.line ?? delimiterLine;
    const endLine = bodyRows[bodyRows.length - 1]?.line ?? delimiterLine;
    for (let line = startLine; line <= endLine; line += 1) consumed.add(line);
    const tableIndex = sourceTableIndex;
    sourceTableIndex += 1;
    if (!structural) continue;
    const diagnostics = [...delimiter.diagnostics];
    const rows: StructuralRow[] = rowSources.map(({ line, parsed }, row) => {
      if (parsed.cells.length !== delimiter.columnCount) {
        diagnostics.push({
          code: "row-width",
          message: `Expected ${delimiter.columnCount} cells, received ${parsed.cells.length}.`,
          row,
        });
      }
      const cells = parsed.cells.slice(0, delimiter.columnCount).map((raw, column): StructuralCell => {
        const marker = markerFor(raw);
        return {
          row,
          column,
          raw,
          content: marker.content,
          role: roleFor(row, column, headerRows.length, delimiter.rowHeaderColumnCount),
          ...(marker.marker === undefined ? {} : { marker: marker.marker }),
          anchorRow: row,
          anchorColumn: column,
          rowSpan: 1,
          columnSpan: 1,
          covered: false,
        };
      });
      return { sourceLine: line, cells };
    });
    if (rows.every((row) => row.cells.length === delimiter.columnCount)) resolveMerges(rows, diagnostics);
    const from = offsets[startLine] ?? 0;
    const lastLine = lines[endLine] ?? "";
    const to = (offsets[endLine] ?? from) + lastLine.length;
    tables.push({
      range: { from, to },
      sourceTableIndex: tableIndex,
      startLine,
      endLine,
      delimiterLine,
      columnCount: delimiter.columnCount,
      headerRowCount: headerRows.length,
      rowHeaderColumnCount: delimiter.rowHeaderColumnCount,
      alignments: delimiter.alignments,
      rows,
      diagnostics,
      structural,
      valid: diagnostics.length === 0,
      source: source.slice(from, to),
    });
  }
  return { tables };
}
