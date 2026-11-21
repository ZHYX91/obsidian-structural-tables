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

interface CellCodeScan {
  references?: MarkdownReferences | undefined;
  source: string;
  spans: { from: number; to: number; replacement: string }[];
}

type InlineState = InstanceType<MarkdownIt["inline"]["State"]>;

let cellMarkdown: MarkdownIt | undefined;

// The Markdown reader decodes character references after parsing the angle destination and quoted title.
function encodeLinkAttribute(value: string): string {
  return value.replace(/[&<>"\\|\r\n]/gu, (character) => `&#${character.charCodeAt(0)};`);
}

/** Preserve the parsed destination across isolated previews, pastes and GFM's table-level pipe unescaping. */
function recordCodeReference(state: InlineState, scan: CellCodeScan, from: number, firstToken: number, image: boolean): void {
  const endLabel = state.md.helpers.parseLinkLabel(state, from + (image ? 1 : 0), !image);
  const after = endLabel + 1;
  if (state.src[after] === "(" && state.pos > after) return; // inline destination
  const id = state.pos > after + 2 ? state.src.slice(after + 1, state.pos - 1)
    : state.src.slice(from + (image ? 2 : 1), endLabel);
  if (!id.includes("`") || !id.includes("|")) return;
  const idScan: CellCodeScan = { source: id, spans: [] };
  state.md.inline.parse(id, state.md, idScan, []);
  if (idScan.spans.length === 0) return;
  // A link or image can flush pending text before emitting its opening token.
  const token = state.tokens.slice(firstToken).find(item => item.type === (image ? "image" : "link_open"));
  if (!token) return;
  const href = token.attrGet(image ? "src" : "href");
  if (href == null) return;
  const title = token.attrGet("title");
  scan.spans.push({ from: after, to: state.pos,
    replacement: "(<" + encodeLinkAttribute(href) + ">" + (title ? ' "' + encodeLinkAttribute(title) + '"' : "") + ")" });
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
      const scan = state.env as CellCodeScan;
      if (state.src !== scan.source) return true; // Image alt text has its own offsets.
      const marker = state.src[from];
      if (marker === "`") {
        const token = state.tokens[state.tokens.length - 1]!;
        if (token.type === "code_inline" && token.content.includes("|")) {
          const raw = state.src.slice(from + token.markup.length, state.pos - token.markup.length);
          scan.spans.push({ from, to: state.pos, replacement: codeSpanAsHtml(raw) });
        }
      } else if (scan.references && (marker === "[" || marker === "!")) {
        recordCodeReference(state, scan, from, firstToken, marker === "!");
      }
      return true;
    });
    ruler.enableOnly("structural_tables_source_positions");
  }
  return cellMarkdown;
}

export function mayUseCodeReferences(table: StructuralTable): boolean {
  return table.rows.some(row => row.cells.some(({ content }) => {
    const open = content.indexOf("[");
    if (open < 0) return false;
    const close = content.lastIndexOf("]");
    const tick = content.indexOf("`", open + 1);
    const pipe = content.indexOf("|", open + 1);
    return tick >= 0 && tick < close && pipe >= 0 && pipe < close;
  }));
}

/** Let the existing note scanner establish block ownership and markdown-it resolve actual definitions. */
export function documentCodeReferences(source: string): MarkdownReferences | undefined {
  if (!source.includes("]:")) return undefined;
  const env: { references: MarkdownReferences } = { references: Object.create(null) as MarkdownReferences };
  const md = cellParser();
  ignoredMarkdownLines(sourceLines(source).lines, undefined, undefined, definition => {
    md.block.parse(definition.replace(/\0/gu, "\uFFFD"), md, env, []);
  });
  return env.references;
}

export function portableCell(content: string, references?: MarkdownReferences): string {
  const source = existingTableCellText(content);
  const scan: CellCodeScan = { source, spans: [], references };
  if (source.includes("`") && source.includes("|")) {
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
