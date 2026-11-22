import MarkdownIt from "markdown-it";
import { ignoredMarkdownLines, sourceLines } from "./source-lines";
import type { StructuralTable } from "./model";
import { encodeTableCellText } from "./literal-cell-text";
import { existingTableCellText } from "./table-cell-syntax";

function codeSpanDisplayText(raw: string): string {
  const normalized = raw.replace(/\r\n|\r|\n/gu, " ");
  // CommonMark code spans collapse line endings and trim one surrounding
  // space when both ends are spaces and the span is not all whitespace.
  return normalized.startsWith(" ") && normalized.endsWith(" ") && /[^ ]/u.test(normalized)
    ? normalized.slice(1, -1) : normalized;
}

function codeSpanAsHtml(raw: string): string {
  // GFM unescapes code-span pipes in tables, while native Obsidian keeps that
  // backslash. No backtick spelling preserves the same pipe text in both.
  // Inline HTML tags do not shield their contents from the Markdown parser.
  // Encode punctuation so links, emphasis and nested code remain literal text.
  return "<code>" + encodeTableCellText(codeSpanDisplayText(raw)) + "</code>";
}

export type MarkdownReferences = Record<string, { href: string; title: string }>;

export interface MarkdownReferenceDefinitions {
  markdown: string;
  sources: ReadonlyMap<string, string>;
  references: MarkdownReferences;
}

interface CellScan {
  references?: MarkdownReferences | undefined;
  source: string;
  hasPipedCode?: boolean;
  spans: { from: number; to: number; replacement: string }[];
  usedReferences?: Set<string>;
}

type InlineState = InstanceType<MarkdownIt["inline"]["State"]>;

let cellMarkdown: MarkdownIt | undefined;

// The Markdown reader decodes character references after parsing the angle destination and quoted title.
function encodeLinkAttribute(value: string): string {
  return value.replace(/[&<>"\\|\r\n]/gu, (character) => `&#${character.charCodeAt(0)};`);
}

/** Preserve the parsed destination across isolated previews, pastes and GFM's table-level pipe unescaping. */
function recordReference(state: InlineState, scan: CellScan, from: number, firstToken: number, image: boolean): void {
  const endLabel = state.md.helpers.parseLinkLabel(state, from + (image ? 1 : 0), !image);
  const after = endLabel + 1;
  if (state.src[after] === "(" && state.pos > after) return; // inline destination
  const fullReference = state.pos > after + 2;
  const id = fullReference ? state.src.slice(after + 1, state.pos - 1)
    : state.src.slice(from + (image ? 2 : 1), endLabel);
  // A link or image can flush pending text before emitting its opening token.
  const token = state.tokens.slice(firstToken).find(item => item.type === (image ? "image" : "link_open"));
  if (!token) return;
  if (scan.usedReferences !== undefined) {
    scan.usedReferences.add(state.md.utils.normalizeReference(id));
    return;
  }
  if (!id.includes("|")) return;
  // Full references have a separate, opaque identifier. A shortcut or collapsed
  // reference also needs its target when exporting its visible label rewrites that identifier.
  const changedLabel = !fullReference && scan.spans.some(span => span.from > from && span.to <= endLabel);
  if (!changedLabel) {
    if (!id.includes("`")) return;
    const idScan: CellScan = { source: id, spans: [] };
    state.md.inline.parse(id, state.md, idScan, []);
    if (!idScan.hasPipedCode) return;
  }
  const href = token.attrGet(image ? "src" : "href");
  if (href == null) return;
  const title = token.attrGet("title");
  scan.spans.push({ from: after, to: state.pos,
    replacement: "(<" + encodeLinkAttribute(href) + ">" + (title ? ' "' + encodeLinkAttribute(title) + '"' : "") + ")" });
}

function recordAngleSyntax(state: InlineState, scan: CellScan, from: number): void {
  const last = state.tokens.length - 1;
  const token = state.tokens[last]!;
  let replacement: string;
  if (token.type === "html_inline" && /^<[A-Za-z]/u.test(token.content)) {
    // In a parsed opening tag, pipes can only occur in attribute values.
    // HTML preserves a Markdown backslash here, but decodes a character reference.
    replacement = token.content.replace(/\|/gu, "&#124;");
  } else if (token.type === "link_close" && token.markup === "autolink") {
    // The autolink rule emits an opening link, its visible text, and a closing link.
    const href = state.tokens[last - 2]!.attrGet("href")!;
    const label = state.tokens[last - 1]!.content;
    const text = encodeTableCellText(label);
    // A second Markdown link would end the enclosing Markdown label.
    if (state.level > 0) replacement = '<a href="' + encodeLinkAttribute(href) + '">' + text + "</a>";
    else replacement = "[" + text + "](<" + encodeLinkAttribute(href) + ">)";
  } else return;
  scan.spans.push({ from, to: state.pos, replacement });
}

function recordImageAngles(state: InlineState, scan: CellScan, from: number): boolean {
  const image = state.tokens[state.tokens.length - 1]!;
  if (image.type !== "image" || !image.content.includes("<") || !image.content.includes("|")) return false;
  // An image description is parsed as plain alt text. In an autolink, the
  // percent-encoded pipe often yields exactly the same alt in both readers.
  // Compare actual images before choosing a spelling, including nested markup.
  const candidate = image.content.replace(/\|/gu, "%7C");
  const altImage = (label: string) => state.md.renderInline("![" + label + "](image)", { references: scan.references });
  if (altImage(candidate) === altImage(image.content)) {
    scan.spans.push({ from: from + 2, to: from + 2 + image.content.length, replacement: candidate });
    return false;
  }
  // An HTML tag in a description can itself contribute its literal source.
  // In that case neither a Markdown escape nor an entity is transparent.
  const rendered = state.md.renderer.renderInline([image], state.md.options, state.env);
  scan.spans.push({ from, to: state.pos, replacement: rendered.replace(/\|/gu, "&#124;") });
  return true;
}

function cellParser(): MarkdownIt {
  if (cellMarkdown === undefined) {
    cellMarkdown = new MarkdownIt({ html: true });
    const ruler = cellMarkdown.inline.ruler;
    const standardRules = ruler.getRules("");
    // Decorate the registered chain as a whole. Each built-in rule runs with
    // its normal precedence, including silent probes and unmatched delimiters.
    ruler.push("structural_tables_source_positions", (state, silent) => {
      const from = state.pos;
      const firstToken = state.tokens.length;
      const matched = standardRules.some(rule => rule(state, silent));
      if (!matched || silent || state.tokens.length === firstToken) return matched;
      const scan = state.env as CellScan;
      if (state.src !== scan.source) return true; // Image alt text has its own offsets.
      const marker = state.src[from];
      if (scan.usedReferences !== undefined) {
        if (marker === "[" || marker === "!") recordReference(state, scan, from, firstToken, marker === "!");
        return true;
      }
      if (marker === "`") {
        const token = state.tokens[state.tokens.length - 1]!;
        if (token.type === "code_inline" && token.content.includes("|")) {
          scan.hasPipedCode = true;
          const raw = state.src.slice(from + token.markup.length, state.pos - token.markup.length);
          scan.spans.push({ from, to: state.pos, replacement: codeSpanAsHtml(raw) });
        }
      } else if (marker === "<" && state.src.slice(from, state.pos).includes("|")) {
        recordAngleSyntax(state, scan, from);
      } else if (marker === "[" || marker === "!") {
        if (marker === "!" && recordImageAngles(state, scan, from)) return true;
        if (scan.references) recordReference(state, scan, from, firstToken, marker === "!");
      }
      return true;
    });
    ruler.enableOnly("structural_tables_source_positions");
  }
  return cellMarkdown;
}

export function mayUsePipeReferences(table: StructuralTable): boolean {
  return table.rows.some(row => row.cells.some(({ content }) => {
    const open = content.indexOf("[");
    if (open < 0) return false;
    const close = content.lastIndexOf("]");
    const inlineMarkup = /[`<]/u.test(content.slice(open + 1, close));
    const pipe = content.indexOf("|", open + 1);
    return inlineMarkup && pipe >= 0 && pipe < close;
  }));
}

/** Let the existing note scanner establish block ownership and markdown-it resolve actual definitions. */
export function documentPipeReferences(source: string): MarkdownReferences | undefined {
  if (!source.includes("]:")) return undefined;
  const env: { references: MarkdownReferences } = { references: Object.create(null) as MarkdownReferences };
  const md = cellParser();
  ignoredMarkdownLines(sourceLines(source).lines, undefined, undefined, definition => {
    md.block.parse(definition.replace(/\0/gu, "\uFFFD"), md, env, []);
  });
  return env.references;
}

/** A detached render has the note path but does not have its link definitions. */
export function renderReferenceDefinitions(definitions: readonly string[]): MarkdownReferenceDefinitions | undefined {
  if (definitions.length === 0) return undefined;
  const md = cellParser();
  const sources = new Map<string, string>();
  const references = Object.create(null) as MarkdownReferences;
  for (const definition of definitions) {
    const env = { references: Object.create(null) as MarkdownReferences };
    const tokens: Parameters<MarkdownIt["block"]["parse"]>[3] = [];
    md.block.parse(definition.replace(/\0/gu, "\uFFFD"), md, env, tokens);
    if (tokens.length !== 0) continue;
    for (const [label, reference] of Object.entries(env.references)) {
      if (sources.has(label)) continue; // Markdown uses the first definition.
      sources.set(label, definition);
      references[label] = reference;
    }
  }
  return sources.size === 0 ? undefined : { markdown: Array.from(sources.values()).join("\n\n"), sources, references };
}

export function withNoteReferences(source: string, definitions: string | undefined): string {
  // Put complete definitions first so an open fence or block in the isolated
  // excerpt cannot absorb them as visible content.
  return definitions !== undefined && source.includes("[") ? definitions + "\n\n" + source : source;
}

/** Replay only the definitions used by a cell, leaving its original Markdown intact. */
export function withCellReferences(source: string, definitions: MarkdownReferenceDefinitions | undefined): string {
  if (definitions === undefined || !source.includes("[")) return source;
  const usedReferences = new Set<string>();
  const scan: CellScan = { source, references: definitions.references, spans: [], usedReferences };
  const md = cellParser();
  md.inline.parse(source, md, scan, []);
  const matching = Array.from(usedReferences, label => definitions.sources.get(label)).filter(value => value !== undefined);
  return withNoteReferences(source, matching.length > 0 ? matching.join("\n\n") : undefined);
}

export function portableCell(content: string, references?: MarkdownReferences): string {
  const source = existingTableCellText(content);
  const scan: CellScan = { source, spans: [], references };
  if (source.includes("|") && (source.includes("`") || source.includes("<"))) {
    const md = cellParser();
    md.inline.parse(source, md, scan, []);
  }
  let cell = "";
  let from = 0;
  for (const span of scan.spans) {
    cell += source.slice(from, span.from) + span.replacement;
    from = span.to;
  }
  cell += source.slice(from);
  // Pipes outside protected code spans still need GFM delimiter escaping.
  return cell.replace(/(\\*)\|/gu, (_match, slashes: string) =>
    slashes.length % 2 === 0 ? slashes + "\\|" : slashes + "|");
}
