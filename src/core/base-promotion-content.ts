import type { StructuralCell, StructuralTable } from "./model";
import { closedCodeSpanEnd } from "./table-cell-syntax";
import type { PromotionColumn, PromotionRecord } from "./base-promotion";

export type BasePromotionContentKind =
  | "visual-break"
  | "code-literal"
  | "escaped-literal"
  | "entity-literal"
  | "math-uncertain"
  | "html-uncertain"
  | "syntax-uncertain";

export interface BasePromotionContentOccurrence {
  kind: BasePromotionContentKind;
  source: string;
  from: number;
  to: number;
}

export interface BasePromotionHeaderTarget {
  type: "header";
  sourceColumn: number;
  key: string;
  displayName: string;
}

export interface BasePromotionRecordTarget {
  type: "record";
  recordIndex: number;
  key: string;
  value: string;
}

export type BasePromotionContentTarget = BasePromotionHeaderTarget | BasePromotionRecordTarget;

export interface BasePromotionContentNotice {
  row: number;
  column: number;
  sourceLine: number;
  source: string;
  occurrences: BasePromotionContentOccurrence[];
  targets: BasePromotionContentTarget[];
}

export interface BasePromotionContentReport {
  notices: BasePromotionContentNotice[];
  sourceCellCount: number;
  targetCount: number;
  requiresAcceptance: boolean;
}

interface Range {
  from: number;
  to: number;
}

interface HtmlTagRange extends Range {
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

interface BrCandidate extends Range {
  source: string;
  entity: boolean;
  exact: boolean;
}

function escapedAt(source: string, index: number): boolean {
  let backslashes = 0;
  for (let offset = index - 1; offset >= 0 && source[offset] === "\\"; offset -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function containingRange(ranges: readonly Range[], from: number, to: number): Range | null {
  return ranges.find((range) => from >= range.from && to <= range.to) ?? null;
}

function codeRanges(source: string): Range[] {
  const ranges: Range[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "`" || escapedAt(source, index)) continue;
    const end = closedCodeSpanEnd(source, index);
    if (end === null) continue;
    ranges.push({ from: index, to: end });
    index = end - 1;
  }
  return ranges;
}

function parseHtmlTagAt(source: string, start: number): HtmlTagRange | null {
  if (source[start] !== "<" || source.startsWith("<!--", start)) return null;
  const prefix = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)/u.exec(source.slice(start));
  if (prefix === null) return null;
  let quote: "\"" | "'" | null = null;
  for (let index = start + prefix[0].length; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character !== ">") continue;
    const raw = source.slice(start, index + 1);
    return {
      from: start,
      to: index + 1,
      name: prefix[2]!.toLowerCase(),
      closing: prefix[1] === "/",
      selfClosing: /\/\s*>$/u.test(raw),
    };
  }
  return null;
}

function htmlRanges(source: string): {
  comments: Range[];
  rawText: Range[];
  tags: HtmlTagRange[];
} {
  const comments: Range[] = [];
  const rawText: Range[] = [];
  const tags: HtmlTagRange[] = [];
  const rawNames = new Set(["pre", "script", "style", "textarea"]);
  for (let index = 0; index < source.length;) {
    if (source.startsWith("<!--", index)) {
      const close = source.indexOf("-->", index + 4);
      const to = close < 0 ? source.length : close + 3;
      comments.push({ from: index, to });
      index = to;
      continue;
    }
    const tag = parseHtmlTagAt(source, index);
    if (tag === null) {
      index += 1;
      continue;
    }
    tags.push(tag);
    if (!tag.closing && !tag.selfClosing && rawNames.has(tag.name)) {
      const lower = source.toLowerCase();
      let search = tag.to;
      let closing: HtmlTagRange | null = null;
      while (search < source.length) {
        const candidate = lower.indexOf(`</${tag.name}`, search);
        if (candidate < 0) break;
        const parsed = parseHtmlTagAt(source, candidate);
        if (parsed !== null && parsed.closing && parsed.name === tag.name) {
          closing = parsed;
          tags.push(parsed);
          break;
        }
        search = candidate + 2;
      }
      const to = closing?.to ?? source.length;
      rawText.push({ from: tag.from, to });
      index = to;
      continue;
    }
    index = tag.to;
  }
  return { comments, rawText, tags };
}

function mathRanges(source: string, code: readonly Range[]): Range[] {
  const ranges: Range[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const codeRange = containingRange(code, index, index + 1);
    if (codeRange !== null) {
      index = codeRange.to - 1;
      continue;
    }
    if (source[index] !== "$" || escapedAt(source, index)) continue;
    let run = 1;
    while (source[index + run] === "$") run += 1;
    if (run > 2) {
      index += run - 1;
      continue;
    }
    const delimiter = "$".repeat(run);
    let close = -1;
    for (let search = index + run; search < source.length;) {
      const next = source.indexOf(delimiter, search);
      if (next < 0) break;
      if (!escapedAt(source, next) && containingRange(code, next, next + run) === null) {
        close = next + run;
        break;
      }
      search = next + run;
    }
    const to = close < 0 ? source.length : close;
    ranges.push({ from: index, to });
    index = to - 1;
  }
  return ranges;
}

function brCandidateAt(source: string, index: number): BrCandidate | null {
  if (source[index] === "<") {
    const prefix = /^<\s*\/?\s*br\b/iu.exec(source.slice(index));
    if (prefix === null) return null;
    const close = source.indexOf(">", index + prefix[0].length);
    const to = close < 0 ? source.length : close + 1;
    const value = source.slice(index, to);
    return {
      from: index,
      to,
      source: value,
      entity: false,
      exact: /^<br(?:>|\/>| \/>)$/iu.test(value),
    };
  }
  if (source.slice(index, index + 4).toLowerCase() === "&lt;") {
    const close = source.toLowerCase().indexOf("&gt;", index + 4);
    const to = close < 0 ? Math.min(source.length, index + 96) : close + 4;
    const value = source.slice(index, to);
    if (!/^&lt;\s*\/?\s*br\b/iu.test(value)) return null;
    return {
      from: index,
      to,
      source: value,
      entity: true,
      exact: /^&lt;br(?:&gt;|\/&gt;| \/&gt;)$/iu.test(value),
    };
  }
  return null;
}

export function analyzeBrRelatedContent(source: string): BasePromotionContentOccurrence[] {
  const code = codeRanges(source);
  const html = htmlRanges(source);
  const math = mathRanges(source, code);
  const occurrences: BasePromotionContentOccurrence[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const candidate = brCandidateAt(source, index);
    if (candidate === null) continue;
    let kind: BasePromotionContentKind;
    if (containingRange(code, candidate.from, candidate.to) !== null) {
      kind = "code-literal";
    } else if (
      containingRange(html.comments, candidate.from, candidate.to) !== null
      || containingRange(html.rawText, candidate.from, candidate.to) !== null
    ) {
      kind = "html-uncertain";
    } else {
      const containingTag = containingRange(html.tags, candidate.from, candidate.to);
      if (containingTag !== null && (containingTag.from !== candidate.from || containingTag.to !== candidate.to)) {
        kind = "html-uncertain";
      } else if (containingRange(math, candidate.from, candidate.to) !== null) {
        kind = "math-uncertain";
      } else if (candidate.entity) {
        kind = candidate.exact ? "entity-literal" : "syntax-uncertain";
      } else if (escapedAt(source, candidate.from)) {
        kind = "escaped-literal";
      } else if (candidate.exact) {
        kind = "visual-break";
      } else {
        kind = "syntax-uncertain";
      }
    }
    occurrences.push({ kind, source: candidate.source, from: candidate.from, to: candidate.to });
    index = Math.max(index, candidate.to - 1);
  }
  return occurrences;
}

function anchorFor(table: StructuralTable, cell: StructuralCell): StructuralCell {
  return table.rows[cell.anchorRow]?.cells[cell.anchorColumn] ?? cell;
}

function sourceKey(cell: StructuralCell): string {
  return `${cell.anchorRow}:${cell.anchorColumn}`;
}

function targetKey(target: BasePromotionContentTarget): string {
  return target.type === "header"
    ? `header:${target.sourceColumn}:${target.key}`
    : `record:${target.recordIndex}:${target.key}`;
}

export function analyzeBasePromotionContent(
  table: StructuralTable,
  columns: readonly PromotionColumn[],
  records: readonly PromotionRecord[],
): BasePromotionContentReport {
  const sources = new Map<string, { cell: StructuralCell; targets: BasePromotionContentTarget[] }>();
  const addTarget = (cell: StructuralCell, target: BasePromotionContentTarget): void => {
    const anchor = anchorFor(table, cell);
    const key = sourceKey(anchor);
    const entry = sources.get(key) ?? { cell: anchor, targets: [] };
    if (!entry.targets.some((existing) => targetKey(existing) === targetKey(target))) entry.targets.push(target);
    sources.set(key, entry);
  };

  for (const column of columns) {
    let previousAnchor = "";
    for (let row = 0; row < table.headerRowCount; row += 1) {
      const cell = table.rows[row]?.cells[column.sourceColumn];
      if (cell === undefined) continue;
      const anchor = anchorFor(table, cell);
      const key = sourceKey(anchor);
      if (key !== previousAnchor && anchor.content.trim() !== "") {
        addTarget(anchor, {
          type: "header",
          sourceColumn: column.sourceColumn,
          key: column.key,
          displayName: column.displayName,
        });
      }
      previousAnchor = key;
    }
  }

  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const row = table.rows[table.headerRowCount + recordIndex];
    const record = records[recordIndex];
    if (row === undefined || record === undefined) continue;
    for (const column of columns) {
      const cell = row.cells[column.sourceColumn];
      if (cell === undefined) continue;
      addTarget(cell, {
        type: "record",
        recordIndex,
        key: column.key,
        value: record.values[column.key] ?? "",
      });
    }
  }

  const notices = [...sources.values()].flatMap(({ cell, targets }): BasePromotionContentNotice[] => {
    const source = cell.raw.trim();
    const occurrences = analyzeBrRelatedContent(source);
    if (occurrences.length === 0) return [];
    return [{
      row: cell.row + 1,
      column: cell.column + 1,
      sourceLine: (table.rows[cell.row]?.sourceLine ?? cell.row) + 1,
      source,
      occurrences,
      targets,
    }];
  }).sort((left, right) => left.row - right.row || left.column - right.column);

  const targetCount = notices.reduce((sum, notice) => sum + notice.targets.length, 0);
  return {
    notices,
    sourceCellCount: notices.length,
    targetCount,
    requiresAcceptance: notices.length > 0,
  };
}
