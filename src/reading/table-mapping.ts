import { withoutSourcePrefixes } from "../core/source-lines";
import type { StructuralTable } from "../core/model";

function renderedSourceText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeName === "BR") return "\n";
  return Array.from(node.childNodes, (child) => renderedSourceText(child)).join("");
}

function normalizeSourceBlock(source: string): string {
  return source
    .replace(/\r\n|\r/gu, "\n")
    .replace(/\n+/gu, "\n")
    .trim();
}

function normalizeExpectedSourceBlock(source: string): string {
  const visible = source
    .replace(/\[\[([^\]\n]+)\]\]/gu, (_match, target: string) => {
      const separator = target.lastIndexOf("|");
      return (separator >= 0 ? target.slice(separator + 1) : target).replace(/\\\|/gu, "|");
    })
    .replace(/(`+)([^`\n]*?)\1/gu, "$2")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/\\\|/gu, "|");
  return normalizeSourceBlock(visible);
}

interface SectionRange { lineStart: number; lineEnd: number }

/** A null entry means ambiguous raw ownership. Keep it out of later native and deferred mappings. */
export function rawStructuralTableTargets(
  container: HTMLElement,
  tables: readonly StructuralTable[],
  sectionFor?: (element: HTMLElement) => SectionRange | null,
): Map<StructuralTable, HTMLElement | null> {
  const result = new Map<StructuralTable, HTMLElement | null>();
  if (tables.length === 0) return result;
  const boundary = ".internal-embed, .markdown-embed, .cm-editor";
  const childBlocks = "p, div, pre, table, blockquote, ol, ul, h1, h2, h3, h4, h5, h6";
  const owner = container.closest(boundary);
  // Scan leaf render blocks once. Ancestors can repeat their child's text or
  // include neighboring content whose DOM must survive the replacement.
  const blocks = [container, ...container.querySelectorAll<HTMLElement>("p, div")]
    .filter(element => element.closest(boundary) === owner && !element.querySelector(boundary)
      && !element.closest("pre, code, table") && !element.querySelector(childBlocks))
    .map(element => ({
      element,
      text: normalizeSourceBlock(renderedSourceText(element)),
      range: sectionFor?.(element),
      hasMedia: element.querySelector("img, svg, iframe, input, audio, video, .math") !== null,
    }));
  if (blocks.length === 0) return result;
  const claims = new Map<HTMLElement, number>();
  const choices = tables.map(table => {
    const source = withoutSourcePrefixes(table.source);
    const expected = normalizeExpectedSourceBlock(source);
    const delimiter = normalizeSourceBlock(source.split(/\r\n|\r|\n/u)[table.delimiterLine - table.startLine] ?? "");
    const exact: HTMLElement[] = [];
    const byText: HTMLElement[] = [];
    for (const { element, range, text, hasMedia } of blocks) {
      if (range && (range.lineStart > table.startLine || range.lineEnd < table.endLine)) continue;
      if (range?.lineStart === table.startLine && range.lineEnd === table.endLine
        && delimiter && text.split("\n").some(line => line.trim() === delimiter)) exact.push(element);
      else if (!hasMedia && text === expected) byText.push(element);
    }
    const candidates = exact.length > 0 ? exact : byText;
    for (const element of candidates) claims.set(element, (claims.get(element) ?? 0) + 1);
    return { table, candidates };
  });
  for (const { table, candidates } of choices) {
    if (candidates.length === 0) continue;
    const first = candidates[0]!;
    result.set(table, candidates.length === 1 && claims.get(first) === 1 ? first : null);
  }
  return result;
}
