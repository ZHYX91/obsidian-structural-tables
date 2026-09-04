import type { ColumnAlignment, StructuralTable } from "./model";

function delimiterFor(alignment: ColumnAlignment): string {
  if (alignment === "left") return ":---";
  if (alignment === "center") return ":---:";
  if (alignment === "right") return "---:";
  return "---";
}

function escapedContent(content: string): string {
  if (content === "<" || content === "^") return `\\${content}`;
  return content;
}

interface SegmenterResult {
  segment: string;
}

interface SegmenterLike {
  segment(input: string): Iterable<SegmenterResult>;
}

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: "grapheme" },
) => SegmenterLike;

const Segmenter = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor }).Segmenter;
const graphemeSegmenter = Segmenter === undefined ? null : new Segmenter(undefined, { granularity: "grapheme" });
const ZERO_WIDTH_CHARACTER = /^(?:\p{Mark}|\p{Cf})$/u;
const EMOJI_GRAPHEME = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  );
}

function codePointWidth(character: string): number {
  if (character === "\t") return 4;
  if (ZERO_WIDTH_CHARACTER.test(character)) return 0;
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined || codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0)) return 0;
  return isWideCodePoint(codePoint) ? 2 : 1;
}

export function markdownSourceDisplayWidth(value: string): number {
  const segments = graphemeSegmenter === null
    ? Array.from(value, (segment) => ({ segment }))
    : Array.from(graphemeSegmenter.segment(value));
  return segments.reduce((width, { segment }) => {
    if (EMOJI_GRAPHEME.test(segment)) return width + 2;
    return width + Array.from(segment).reduce((segmentWidth, character) => (
      segmentWidth + codePointWidth(character)
    ), 0);
  }, 0);
}

function padCell(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - markdownSourceDisplayWidth(value)))}`;
}

function serializeRow(cells: string[], widths: number[]): string {
  return `| ${cells.map((cell, column) => padCell(cell, widths[column] ?? 0)).join(" | ")} |`;
}

function serializeDelimiter(
  delimiters: string[],
  widths: number[],
  rowHeaderColumnCount: number,
): string {
  if (rowHeaderColumnCount === 0) return serializeRow(delimiters, widths);
  const left = delimiters.slice(0, rowHeaderColumnCount).map((cell, column) => {
    const width = (widths[column] ?? 0) - (column === rowHeaderColumnCount - 1 ? 1 : 0);
    return padCell(cell, width);
  });
  const right = delimiters.slice(rowHeaderColumnCount).map((cell, offset) => (
    padCell(cell, widths[rowHeaderColumnCount + offset] ?? 0)
  ));
  return `| ${left.join(" | ")} || ${right.join(" | ")} |`;
}

export function serializeStructuralTable(table: StructuralTable): string {
  if (!table.valid) throw new Error("Cannot format an invalid structural table.");
  const delimiters = table.alignments.map(delimiterFor);
  const rows = table.rows.map((row) => row.cells.map((cell) => {
      if (!cell.covered) return escapedContent(cell.content);
      if (cell.row === cell.anchorRow) return "<";
      return "^";
    }));
  const widths = delimiters.map((delimiter, column) => Math.max(
    markdownSourceDisplayWidth(delimiter),
    ...rows.map((cells) => markdownSourceDisplayWidth(cells[column] ?? "")),
  ));
  if (table.rowHeaderColumnCount > 0) {
    const boundaryColumn = table.rowHeaderColumnCount - 1;
    widths[boundaryColumn] = Math.max(
      (widths[boundaryColumn] ?? 0) + 1,
      markdownSourceDisplayWidth(delimiters[boundaryColumn] ?? "") + 1,
    );
  }
  const delimiter = serializeDelimiter(delimiters, widths, table.rowHeaderColumnCount);
  const lines: string[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    if (rowIndex === table.headerRowCount) lines.push(delimiter);
    const cells = rows[rowIndex];
    if (cells === undefined) continue;
    lines.push(serializeRow(cells, widths));
  }
  if (table.rows.length === table.headerRowCount) lines.push(delimiter);
  return lines.join(sourceLineEnding(table.source));
}

function sourceLineEnding(source: string): "\r\n" | "\r" | "\n" {
  if (source.includes("\r\n")) return "\r\n";
  if (source.includes("\r")) return "\r";
  return "\n";
}
