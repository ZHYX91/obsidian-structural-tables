import type { SourceRange } from "./model";
import { ignoredMarkdownLines, sourceLines } from "./source-lines";

export interface HtmlTableSource {
  range: SourceRange;
  source: string;
  startLine: number;
  endLine: number;
}

const OPEN = /^ {0,3}<table(?:[ \t]+[^<>]*?)?>/iu;
const TABLE_TAG = /<\/table[ \t]*>|<table(?:[ \t]+[^<>]*?)?>/giu;

/**
 * Only own complete, standalone HTML table blocks, never an embedded tag in
 * prose, a fenced example, a comment, or another HTML block.
 */
export function htmlTableSources(source: string): HtmlTableSource[] {
  const { lines, offsets } = sourceLines(source);
  const result: HtmlTableSource[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    if (!OPEN.test(lines[start] ?? "")) continue;
    // HTML blocks are deliberately ignored by the Markdown-line scanner.
    // Substitute the opener to distinguish a genuine HTML block from an
    // identical-looking line inside a code fence, comment, or parent HTML block.
    const probe = [...lines];
    probe[start] = "STRUCTURAL_TABLE_HTML_PROBE";
    if (ignoredMarkdownLines(probe).has(start)) continue;
    let depth = 0;
    let end = -1;
    let invalid = false;
    for (let line = start; line < lines.length; line += 1) {
      const value = lines[line] ?? "";
      if (value.trim() === "") { invalid = true; break; }
      const tags = [...value.matchAll(TABLE_TAG)];
      if (line === start && (tags[0]?.index ?? -1) > 3) { invalid = true; break; }
      for (const tag of tags) {
        if (tag[0].startsWith("</")) {
          depth -= 1;
          if (depth < 0 || depth === 0 && value.slice(tag.index + tag[0].length).trim() !== "") {
            invalid = true;
            break;
          }
          if (depth === 0) end = line;
        } else {
          depth += 1;
          if (depth > 1 || end >= 0) { invalid = true; break; }
        }
      }
      if (invalid || end >= 0) break;
      if (line > start && OPEN.test(value)) { invalid = true; break; }
    }
    if (invalid || end < 0 || depth !== 0) continue;
    const from = offsets[start] ?? 0;
    const to = (offsets[end] ?? 0) + (lines[end]?.length ?? 0);
    result.push({ range: { from, to }, source: source.slice(from, to), startLine: start, endLine: end });
    start = end;
  }
  return result;
}

export function htmlTableSourceAt(source: string, offset: number): HtmlTableSource | null {
  return htmlTableSources(source).find(({ range }) => offset >= range.from && offset <= range.to) ?? null;
}
