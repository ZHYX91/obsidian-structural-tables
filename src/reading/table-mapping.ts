import { withoutSourcePrefixes } from "../core/source-lines";
import type { StructuralTable } from "../core/model";

export function renderedTableFor<T>(candidates: readonly T[], table: StructuralTable): T | undefined {
  return candidates[table.sourceTableIndex];
}

function renderedSourceText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeName === "BR") return "\n";
  return Array.from(node.childNodes, (child) => renderedSourceText(child)).join("");
}

function normalizeSourceBlock(source: string): string {
  return source
    .replace(/\u00a0/gu, " ")
    .replace(/\s+/gu, "");
}

function normalizeExpectedSourceBlock(source: string): string {
  const visible = source
    .replace(/\[\[([^\]\n]+)\]\]/gu, (_match, target: string) => {
      const separator = target.lastIndexOf("|");
      return (separator >= 0 ? target.slice(separator + 1) : target).replace(/\\\|/gu, "|");
    })
    .replace(/(`+)([^`\n]*?)\1/gu, "$2")
    .replace(/<br\s*\/?>/giu, "")
    .replace(/\\\|/gu, "|");
  return normalizeSourceBlock(visible);
}

export function rawStructuralTableElement(
  container: HTMLElement,
  table: StructuralTable,
  ownsSourceRange?: (element: HTMLElement) => boolean,
): HTMLElement | undefined {
  const expected = normalizeExpectedSourceBlock(withoutSourcePrefixes(table.source));
  const delimiter = normalizeSourceBlock(withoutSourcePrefixes(table.source).split(/\r\n|\r|\n/u)[table.delimiterLine - table.startLine] ?? "");
  const elements = [container, ...container.querySelectorAll<HTMLElement>("p, div")];
  return elements.reverse().find((element) => {
    if (element.closest("pre, code, table") !== null || element.querySelector("pre, table") !== null) return false;
    const visible = normalizeSourceBlock(renderedSourceText(element));
    // Source identity survives arbitrary inline Markdown rendering; the delimiter keeps
    // nested embeds sharing their parent's section metadata from becoming the target.
    return (delimiter.length > 0 && visible.includes(delimiter) && ownsSourceRange?.(element) === true)
      || visible === expected;
  });
}
