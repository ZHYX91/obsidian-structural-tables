import { closedCodeSpanEnd } from "./table-cell-syntax";

/** Source lines exclude their terminators; offsets always address the original text. */
export function sourceLines(source: string): { lines: string[]; offsets: number[] } {
  const lines: string[] = [];
  const offsets: number[] = [];
  let from = 0;
  for (const match of source.matchAll(/\r\n|\r|\n/gu)) {
    offsets.push(from);
    lines.push(source.slice(from, match.index));
    from = match.index + match[0].length;
  }
  offsets.push(from);
  lines.push(source.slice(from));
  return { lines, offsets };
}

export function sourcePrefix(line: string): string {
  return /^(?:[ \t]*>[ \t]?)*[ \t]*/u.exec(line)?.[0] ?? "";
}

export function withoutSourcePrefixes(source: string): string {
  return source.split(/\r\n|\r|\n/u).map((line) => line.slice(sourcePrefix(line).length)).join("\n");
}

export function withSourcePrefix(source: string, prefix: string): string {
  return source.split(/(\r\n|\r|\n)/u).map((part, index) => index % 2 === 0 ? prefix + part : part).join("");
}

type ProtectedBlock = "%%" | "<!--" | "$$";

const RAW_LITERAL_HTML_START = /^ {0,3}<(?:pre|script|style|textarea)(?=[\t >]|$)/iu;
const RAW_LITERAL_HTML_END = /<\/(?:pre|script|style|textarea)>/iu;

export function startsRawLiteralHtmlBlock(line: string): boolean {
  return RAW_LITERAL_HTML_START.test(line);
}

export function endsRawLiteralHtmlBlock(line: string): boolean {
  return RAW_LITERAL_HTML_END.test(line);
}

function scanProtectedLine(line: string, block: ProtectedBlock | null): {
  block: ProtectedBlock | null;
  ignored: boolean;
} {
  const continued = block !== null;
  let protectedText = false;
  let visible = "";
  for (let index = 0; index < line.length;) {
    if (block !== null) {
      protectedText = true;
      const end = block === "<!--" ? "-->" : block;
      if (block === "$$" && line[index] === "\\") { index += 2; continue; }
      if (line.startsWith(end, index)) { block = null; index += end.length; }
      else index += 1;
      continue;
    }
    if (line[index] === "\\") { visible += line.slice(index, index + 2); index += 2; continue; }
    if (line[index] === "`") {
      let end = closedCodeSpanEnd(line, index);
      if (end === null) {
        end = index + 1;
        while (line[end] === "`") end += 1;
      }
      visible += line.slice(index, end);
      index = end;
      continue;
    }
    const opening = (["%%", "<!--", "$$"] as const).find((token) => line.startsWith(token, index));
    if (opening !== undefined) { block = opening; protectedText = true; index += opening.length; continue; }
    // Comments written as literal TeX inside a closed inline formula are not Markdown comments.
    if (line[index] === "$") {
      let end = index + 1;
      while (end < line.length && line[end] !== "$") end += line[end] === "\\" ? 2 : 1;
      if (end < line.length) { visible += line.slice(index, end + 1); index = end + 1; continue; }
    }
    visible += line[index];
    index += 1;
  }
  return { block, ignored: continued || block !== null || (protectedText && visible.trim() === "") };
}

export function ignoredMarkdownLines(
  lines: readonly string[],
  visibleFenceInfo: ReadonlySet<string> = new Set<string>(),
): Set<number> {
  const ignored = new Set<number>();
  let fence: { character: "`" | "~"; length: number; listIndent: number } | null = null;
  let protectedBlock: ProtectedBlock | null = null;
  let protectedIndent = 0;
  let rawLiteralHtml = false;
  let rawLiteralIndent = 0;
  let frontmatter = /^---[\t ]*$/u.test(lines[0]?.replace(/^\uFEFF/u, "") ?? "");
  let quoteDepth = 0;
  let listIndents: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const original = lines[index] ?? "";
    if (frontmatter) {
      ignored.add(index);
      if (index > 0 && /^(?:---|\.\.\.)[\t ]*$/u.test(original)) frontmatter = false;
      continue;
    }
    let quote = /^(?: {0,3}>[\t ]?)*/u.exec(original)?.[0] ?? "";
    let depth = quote.split(">").length - 1;
    if ((fence !== null || protectedBlock !== null) && depth >= quoteDepth) {
      quote = (quote.match(/ {0,3}>[\t ]?/gu) ?? []).slice(0, quoteDepth).join("");
      depth = quoteDepth;
    }
    if (depth !== quoteDepth) {
      fence = null;
      protectedBlock = null;
      rawLiteralHtml = false;
      listIndents = [];
      quoteDepth = depth;
    }
    const unquoted = original.slice(quote.length);
    const indent = /^ */u.exec(unquoted)?.[0].length ?? 0;
    if (unquoted.trim() !== "") {
      while (listIndents.length > 0 && indent < listIndents[listIndents.length - 1]!) listIndents.pop();
    }
    let listIndent = listIndents[listIndents.length - 1] ?? 0;
    let line = unquoted.slice(listIndent);
    if (line.trim() !== "" && listIndent < protectedIndent) protectedBlock = null;
    if (line.trim() !== "" && listIndent < rawLiteralIndent) rawLiteralHtml = false;
    if (line.trim() !== "" && fence !== null && listIndent < fence.listIndent) fence = null;

    // A list marker is a container, including when its first content is a fence.
    // Markers inside an active code/comment block remain literal content.
    if (fence === null && protectedBlock === null) {
      let list = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([\t ]{1,4})(?=\S)/u.exec(line);
      // Thematic breaks take precedence over list markers at every container depth.
      const thematicBreak = (value: string): boolean => /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,})$/u.test(value);
      while (list !== null && !thematicBreak(line)) {
        listIndent += list[0].length;
        listIndents.push(listIndent);
        line = line.slice(list[0].length);
        list = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([\t ]{1,4})(?=\S)/u.exec(line);
      }
    }

    if (fence !== null) {
      ignored.add(index);
      const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/u.exec(line);
      const run = closing?.[1];
      if (run?.[0] === fence.character && run.length >= fence.length) fence = null;
      continue;
    }
    if (rawLiteralHtml) {
      ignored.add(index);
      if (endsRawLiteralHtmlBlock(line)) rawLiteralHtml = false;
      continue;
    }

    const indentedCode = /^(?: {4}|\t)/u.test(line);
    if (
      !indentedCode
      && protectedBlock === null
      && startsRawLiteralHtmlBlock(line)
    ) {
      ignored.add(index);
      rawLiteralHtml = !endsRawLiteralHtmlBlock(line);
      rawLiteralIndent = listIndent;
      continue;
    }

    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    const run = opening?.[1];
    const info = (opening?.[2] ?? "").trim();
    if (protectedBlock === null && run !== undefined && (run[0] === "~" || !info.includes("`"))) {
      fence = { character: run[0] as "`" | "~", length: run.length, listIndent };
      if (!visibleFenceInfo.has(info)) ignored.add(index);
      continue;
    }

    if (!indentedCode || protectedBlock !== null) {
      const protection = scanProtectedLine(line, protectedBlock);
      protectedBlock = protection.block;
      protectedIndent = listIndent;
      if (protection.ignored) ignored.add(index);
    }
    if (indentedCode) ignored.add(index);
  }
  return ignored;
}

export function calloutRanges(source: string): { from: number; to: number }[] {
  const { lines, offsets } = sourceLines(source);
  const ranges: { from: number; to: number }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^([\t ]*(?:>[\t ]*)+)\[![^\]]+\]/u.exec(lines[index] ?? "");
    if (opening === null) continue;
    const depth = opening[1]!.split(">").length - 1;
    let end = index;
    while (end + 1 < lines.length && sourcePrefix(lines[end + 1] ?? "").split(">").length - 1 >= depth) end += 1;
    ranges.push({ from: offsets[index]!, to: offsets[end]! + lines[end]!.length });
    index = end;
  }
  return ranges;
}
