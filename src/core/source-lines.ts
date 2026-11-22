import { closedCodeSpanEnd, splitTablePipeRow } from "./table-cell-syntax";
import { referenceDefinitionEnd } from "./reference-definition";

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
interface ListScope { indent: number; marker: string; emptyLine?: number }
interface ParagraphScope {
  quoteDepth: number;
  listIndent: number;
  quoteIndents: number[];
  listsByQuote: ListScope[][];
}

function listPrefix(line: string): { marker: string; length: number; indent: number; padding: number; empty: boolean } | null {
  const match = /^( {0,3})([-+*]|\d{1,9}[.)])(?:( {1,4})(?=\S)| *$)/u.exec(line);
  if (match === null) return null;
  const empty = match[3] === undefined;
  return { marker: match[2]!, length: match[0].length, padding: match[1]!.length, empty,
    indent: match[1]!.length + match[2]!.length + (empty ? 1 : match[3]!.length) };
}

const RAW_LITERAL_HTML_START = /^ {0,3}<(?:pre|script|style|textarea)(?=[\t >]|$)/iu;
const RAW_LITERAL_HTML_END = /<\/(?:pre|script|style|textarea)>/iu;
// CommonMark HTML block type 6: block tags own following literal lines
// until the next blank line. Type 1 raw-text tags retain close-tag semantics.
const HTML_BLOCK_START = /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[\t />]|$)/iu;
// Conservative CommonMark type-7 standalone tags: never interrupt ordinary prose.
const HTML_STANDALONE_TAG = /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:[\t ]+[A-Za-z_:][A-Za-z0-9:._-]*(?:[\t ]*=[\t ]*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*[\t ]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[\t ]*>)[\t ]*$/u;

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

function expandedTabs(line: string): string {
  let column = 0;
  return line.replace(/[^\t]|\t/gu, (character) => {
    const width = character === "\t" ? 4 - column % 4 : 1;
    column += width;
    return character === "\t" ? " ".repeat(width) : character;
  });
}

/** Strip an expanded container prefix, preserving tabs inside reference content. */
function referenceContent(source: string, prefixColumns: number): string {
  let column = 0;
  let index = 0;
  while (index < source.length && (column < prefixColumns || /[\t ]/u.test(source[index]!))) {
    column += source[index] === "\t" ? 4 - column % 4 : 1;
    index += 1;
  }
  // A container can consume only part of a tab. The remaining indentation
  // still counts in columns; destination, label and title bytes stay literal.
  return " ".repeat(Math.max(0, column - prefixColumns)) + source.slice(index);
}

/** Continue quotes through their owning list indentation without reading literal inner markers. */
function quotePrefix(line: string, inheritedIndents: readonly number[], maximumDepth = Number.POSITIVE_INFINITY): {
  length: number;
  indents: number[];
  padding: number[];
  retainedDepth: number;
} {
  const indents: number[] = [];
  const padding: number[] = [];
  let length = 0;
  let retainedDepth = 0;
  let inherited = true;
  while (indents.length < maximumDepth) {
    const spaces = /^ */u.exec(line.slice(length))![0].length;
    if (line[length + spaces] !== ">") break;
    let indent = inherited ? inheritedIndents[indents.length] ?? 0 : 0;
    const continuation = inherited && indents.length < inheritedIndents.length;
    // Only an existing quote owns deeply indented continuation markers. A
    // fresh quote still needs at most three spaces beyond its parent list.
    if (spaces < indent || (!continuation && spaces > indent + 3)) {
      // A quote outside the old list starts a new container, even at the same depth.
      inherited = false;
      indent = 0;
      if (spaces > 3) break;
    }
    if (inherited && indents.length < inheritedIndents.length) retainedDepth += 1;
    indents.push(indent);
    padding.push(spaces);
    length += spaces + 1;
    if (line[length] === " ") length += 1;
  }
  return { length, indents, padding, retainedDepth };
}

function isGfmHeader(line: string, next: string | null): boolean {
  if (next === null || !line.includes("|") || !next.includes("|") || /^ {4}|^ {0,3}[-+*](?:[\t ]|$)/u.test(next)) return false;
  const header = splitTablePipeRow(line, false);
  const delimiter = splitTablePipeRow(next);
  return header !== null && delimiter !== null && header.cells.length === delimiter.cells.length
    && delimiter.cells.every((cell) => /^:?-+:?$/u.test(cell.trim()));
}

/** Reference continuations can be indented or lazy, but cannot consume a new block. */
function referenceContinuation(lines: readonly string[], index: number, quoteIndents: readonly number[], listIndent: number, requireQuotePrefix = false): string | null {
  const contentAt = (at: number): { line: string; source: string; lazyQuote: boolean } | null => {
    const source = lines[at];
    if (source === undefined) return null;
    const expanded = expandedTabs(source);
    const quote = quotePrefix(expanded, quoteIndents, quoteIndents.length);
    if (quote.retainedDepth < quote.indents.length) return null;
    const unquoted = expanded.slice(quote.length);
    if (/^[\t ]*$/u.test(unquoted)) return null;
    const spaces = /^ */u.exec(unquoted)![0].length;
    const indent = Math.min(spaces, listIndent);
    return { line: unquoted.slice(indent), source: referenceContent(source, quote.length + indent),
      lazyQuote: quote.indents.length < quoteIndents.length };
  };
  const content = contentAt(index);
  if (content === null || (requireQuotePrefix && content.lazyQuote)) return null;
  const { line } = content;
  if (/^ {4}/u.test(line)) return content.source;
  const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  const next = contentAt(index + 1);
  if (/^ {0,3}(?:>|#{1,6}(?:[\t ]|$)|<!--|<\?|<![A-Za-z]|<!\[CDATA\[)/u.test(line)
    || /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,})$/u.test(line)
    || listPrefix(line) !== null || startsRawLiteralHtmlBlock(line) || HTML_BLOCK_START.test(line)
    || (fence !== null && (fence[1]![0] === "~" || !fence[2]!.includes("`")))
    // GFM tables cannot interrupt a quote's lazy reference continuation.
    // Both header and delimiter must carry their owning quote markers.
    || (!content.lazyQuote && isGfmHeader(line, next === null || next.lazyQuote ? null : next.line))) return null;
  return content.source;
}

export function ignoredMarkdownLines(
  lines: readonly string[],
  visibleFenceInfo: ReadonlySet<string> = new Set<string>(),
  onHtmlLine?: (line: string, index: number) => void,
  onReference?: (definition: string) => void,
): Set<number> {
  const ignored = new Set<number>();
  let fence: { character: "`" | "~"; length: number; listIndent: number } | null = null;
  let protectedBlock: ProtectedBlock | null = null;
  let protectedIndent = 0;
  let rawLiteralHtml = false;
  let rawLiteralIndent = 0;
  let htmlBlock = false;
  let htmlBlockIndent = 0;
  let htmlSpecial: { end: string; indent: number } | null = null;
  let frontmatter = /^---[\t ]*$/u.test(lines[0]?.replace(/^\uFEFF/u, "") ?? "");
  let quoteDepth = 0;
  let quoteIndents: number[] = [];
  const listsByQuote: ListScope[][] = [[]];
  let listIndents = listsByQuote[0]!;
  // CommonMark type-7 HTML may begin immediately after a completed block.
  // Track paragraph continuity within the same quote/list container instead
  // of requiring a blank line before every standalone HTML tag.
  let paragraph: ParagraphScope | null = null;
  let referenceEnd = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (index <= referenceEnd) { ignored.add(index); continue; }
    // Tabs advance to four-column stops for container recognition only. Source
    // prefixes, replacement ranges and serializers still use the original bytes.
    const original = expandedTabs(lines[index] ?? "");
    if (frontmatter) {
      paragraph = null;
      ignored.add(index);
      if (index > 0 && /^(?:---|\.\.\.)[\t ]*$/u.test(original)) frontmatter = false;
      continue;
    }
    const protectedRegion = fence !== null || protectedBlock !== null || rawLiteralHtml || htmlBlock || htmlSpecial !== null;
    // A lazy paragraph line can omit quote markers without closing their
    // containers. Retain their ownership until a blank line or new block ends
    // the paragraph, including list scopes inside those omitted quotes.
    const lazyParagraph: ParagraphScope | null = paragraph !== null && paragraph.quoteDepth > quoteDepth ? paragraph : null;
    const quote = quotePrefix(original, lazyParagraph?.quoteIndents ?? quoteIndents, protectedRegion ? quoteDepth : undefined);
    const depth = quote.indents.length;
    if (lazyParagraph !== null && quote.retainedDepth > quoteDepth) {
      listsByQuote.length = lazyParagraph.listsByQuote.length;
      lazyParagraph.listsByQuote.forEach((scopes, level) => { listsByQuote[level] = scopes.slice(); });
    }
    if (quote.retainedDepth < depth) {
      // A newly opened quote belongs only to lists whose content indentation
      // it actually reaches. Do this before hiding the prefix, or a top-level
      // quote could revive an exited list and expose later code as a table.
      const parentLists = listsByQuote[quote.retainedDepth];
      if (parentLists !== undefined) {
        while (parentLists.length > 0 && (parentLists[parentLists.length - 1]!.indent > quote.padding[quote.retainedDepth]!
          || index > (parentLists[parentLists.length - 1]!.emptyLine ?? index) + 1)) {
          parentLists.pop();
        }
        for (const scope of parentLists) delete scope.emptyLine;
        quote.indents[quote.retainedDepth] = parentLists[parentLists.length - 1]?.indent ?? 0;
      }
    }
    if (depth !== quoteDepth || quote.retainedDepth < quoteDepth) {
      fence = null;
      protectedBlock = null;
      rawLiteralHtml = false;
      htmlBlock = false;
      htmlSpecial = null;
      // A missing quote prefix can be a lazy continuation of its paragraph.
      // Block starters below still end that paragraph; a new deeper quote cannot.
      if (paragraph === null || depth > paragraph.quoteDepth || quote.retainedDepth < depth) paragraph = null;
      listsByQuote.length = quote.retainedDepth + 1;
      while (listsByQuote.length <= depth) listsByQuote.push([]);
      listIndents = listsByQuote[depth]!;
      quoteIndents = quote.indents;
      quoteDepth = depth;
    }
    const unquoted = original.slice(quote.length);
    const indent = /^ */u.exec(unquoted)?.[0].length ?? 0;
    let exitedList: ListScope | undefined;
    if (unquoted.trim() !== "") {
      while (listIndents.length > 0 && (indent < listIndents[listIndents.length - 1]!.indent
        || index > (listIndents[listIndents.length - 1]!.emptyLine ?? index) + 1)) exitedList = listIndents.pop();
      for (const scope of listIndents) delete scope.emptyLine;
    }
    let listIndent = listIndents[listIndents.length - 1]?.indent ?? 0;
    let line = unquoted.slice(listIndent);
    if (line.trim() !== "" && listIndent < protectedIndent) protectedBlock = null;
    if (line.trim() !== "" && listIndent < rawLiteralIndent) rawLiteralHtml = false;
    if (line.trim() !== "" && listIndent < htmlBlockIndent) htmlBlock = false;
    if (line.trim() !== "" && htmlSpecial !== null && listIndent < htmlSpecial.indent) htmlSpecial = null;
    if (line.trim() !== "" && fence !== null && listIndent < fence.listIndent) fence = null;

    // Lists and quotes can alternate on the same opening line. Resolve their
    // containers before classifying HTML, fences, comments or ordinary prose.
    // Markers inside an active code/comment block remain literal content.
    if (fence === null && protectedBlock === null && !rawLiteralHtml && !htmlBlock && htmlSpecial === null) {
      for (;;) {
        let list = listPrefix(line);
        // Thematic breaks take precedence over list markers at every container depth.
        const thematicBreak = (value: string): boolean => /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,})$/u.test(value);
        while (list !== null && !thematicBreak(line)) {
          const marker = list.marker;
          const markerIndent = listIndent + list.padding;
          const sibling = exitedList !== undefined && exitedList.marker === marker[marker.length - 1]
            && markerIndent < exitedList.indent;
          // GFM recognizes an immediate equal-width table header before a
          // list marker. Do not create a list scope from that cell's text.
          const next = lines[index + 1] ?? "";
          const prefix = sourcePrefix(lines[index] ?? "");
          const header = splitTablePipeRow(line, false);
          const nextContent = next.slice(prefix.length);
          const delimiter = sourcePrefix(next) === prefix && !/^[-+*](?:[\t ]|$)/u.test(nextContent)
            ? splitTablePipeRow(nextContent) : null;
          if (!sibling && header !== null && delimiter !== null && header.cells.length === delimiter.cells.length
            && delimiter.cells.every((cell) => /^:?-+:?$/u.test(cell.trim()))) {
            paragraph = null;
            break;
          }
          // Only an ordered list beginning with 1 can interrupt a paragraph
          // within the same quote. Once a quote exits, any valid list marker
          // can begin the next block instead of continuing its old paragraph.
          // Outdenting from the preceding item starts a distinct list paragraph.
          if (paragraph !== null && paragraph.quoteDepth === quoteDepth && paragraph.listIndent <= listIndent
            && (list.empty || /^\d/u.test(marker) && !/^1[.)]$/u.test(marker))) break;
          // Sibling list items may have identical indentation but distinct paragraphs.
          paragraph = null;
          listIndent += list.indent;
          listIndents.push({ indent: listIndent, marker: marker[marker.length - 1]!, ...(list.empty ? { emptyLine: index } : {}) });
          exitedList = undefined;
          line = line.slice(list.length);
          list = listPrefix(line);
        }
        const nestedQuote = quotePrefix(line, []);
        if (nestedQuote.indents.length === 0) break;
        // Keep the outer list scope so an unclosed protected block ends when
        // its quote exits, and ordinary list content can resume afterwards.
        quoteIndents.push(listIndent, ...nestedQuote.indents.slice(1));
        quoteDepth = quoteIndents.length;
        while (listsByQuote.length <= quoteDepth) listsByQuote.push([]);
        listIndents = listsByQuote[quoteDepth]!;
        exitedList = undefined;
        line = line.slice(nestedQuote.length);
        listIndent = 0;
        paragraph = null;
      }
    }

    if (fence !== null) {
      paragraph = null;
      ignored.add(index);
      const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/u.exec(line);
      const run = closing?.[1];
      if (run?.[0] === fence.character && run.length >= fence.length) fence = null;
      continue;
    }
    if (rawLiteralHtml) {
      paragraph = null;
      ignored.add(index);
      if (endsRawLiteralHtmlBlock(line)) rawLiteralHtml = false;
      continue;
    }
    if (htmlBlock) {
      paragraph = null;
      // A blank line ends this HTML block; subsequent Markdown can be parsed.
      if (line.trim() === "") htmlBlock = false;
      else { ignored.add(index); onHtmlLine?.(line, index); }
      continue;
    }
    if (htmlSpecial !== null) {
      paragraph = null;
      ignored.add(index);
      if (line.includes(htmlSpecial.end)) htmlSpecial = null;
      continue;
    }

    const indentedCode = /^(?: {4}|\t)/u.test(line);
    if (
      !indentedCode
      && protectedBlock === null
      && startsRawLiteralHtmlBlock(line)
    ) {
      paragraph = null;
      ignored.add(index);
      rawLiteralHtml = !endsRawLiteralHtmlBlock(line);
      rawLiteralIndent = listIndent;
      continue;
    }

    // HTML blocks 3–5 can span lines; they must not lend their pipe text to a table.
    if (!indentedCode && protectedBlock === null) {
      const end = /^ {0,3}<\?/u.test(line) ? "?>"
        : /^ {0,3}<!\[CDATA\[/u.test(line) ? "]]>"
          : /^ {0,3}<![A-Za-z]/u.test(line) ? ">" : null;
      if (end !== null) {
        paragraph = null;
        ignored.add(index);
        if (!line.includes(end)) htmlSpecial = { end, indent: listIndent };
        continue;
      }
    }
    const continuesParagraph: boolean = paragraph !== null
      && (paragraph.quoteDepth > quoteDepth
        || (paragraph.quoteDepth === quoteDepth && paragraph.listIndent >= listIndent));
    if (!indentedCode && protectedBlock === null
      && (HTML_BLOCK_START.test(line) || (!continuesParagraph && HTML_STANDALONE_TAG.test(line)))) {
      onHtmlLine?.(line, index);
      paragraph = null;
      ignored.add(index);
      htmlBlock = true;
      htmlBlockIndent = listIndent;
      continue;
    }

    const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    const run = opening?.[1];
    const info = (opening?.[2] ?? "").trim();
    if (protectedBlock === null && run !== undefined && (run[0] === "~" || !info.includes("`"))) {
      paragraph = null;
      fence = { character: run[0] as "`" | "~", length: run.length, listIndent };
      if (!visibleFenceInfo.has(info)) ignored.add(index);
      continue;
    }

    // Reference labels and titles are literal block syntax, so recognize a
    // complete definition before looking for inline comments or math in it.
    const reference: number | null = !continuesParagraph && !indentedCode && protectedBlock === null && /^ {0,3}\[/u.test(line)
      && !isGfmHeader(line, referenceContinuation(lines, index + 1, quoteIndents, listIndent, true))
      ? referenceDefinitionEnd(referenceContent(lines[index] ?? "", original.length - line.length),
        (offset) => referenceContinuation(lines, index + offset, quoteIndents, listIndent)) : null;
    if (reference !== null) {
      if (onReference !== undefined) {
        const definition = [referenceContent(lines[index]!, original.length - line.length)];
        for (let offset = 1; offset <= reference; offset += 1) {
          definition.push(referenceContinuation(lines, index + offset, quoteIndents, listIndent)!);
        }
        onReference(definition.join("\n"));
      }
      referenceEnd = index + reference;
      ignored.add(index);
      paragraph = null;
      continue;
    }

    if (!indentedCode || protectedBlock !== null) {
      const protection = scanProtectedLine(line, protectedBlock);
      protectedBlock = protection.block;
      protectedIndent = listIndent;
      if (protection.ignored) { paragraph = null; ignored.add(index); continue; }
    }
    if (indentedCode) ignored.add(index);
    const atxHeading = /^ {0,3}#{1,6}(?:[\t ]|$)/u.test(line);
    const thematicBreak = /^ {0,3}(?:(?:\*[\t ]*){3,}|(?:-[\t ]*){3,}|(?:_[\t ]*){3,})$/u.test(line);
    const setextUnderline: boolean = continuesParagraph && /^ {0,3}(?:=+|-+)[\t ]*$/u.test(line);
    // Missing container markers can continue a paragraph lazily, but cannot
    // open a table outside that paragraph. Indents belong to their quote
    // scope, so a restored outer list must not reset the inner paragraph.
    if (continuesParagraph && paragraph !== null
      && (paragraph.quoteDepth > quoteDepth || paragraph.listIndent > listIndent)
      && !atxHeading && !thematicBreak) ignored.add(index);
    paragraph = line.trim() === "" || (indentedCode && !continuesParagraph) || protectedBlock !== null
      || atxHeading || thematicBreak || setextUnderline
      ? null : continuesParagraph ? paragraph : {
        quoteDepth, listIndent, quoteIndents: quoteIndents.slice(), listsByQuote: listsByQuote.map((scopes) => scopes.slice()),
      };
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
