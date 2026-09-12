import { App, Component, MarkdownRenderer } from "obsidian";
import type { StructuralTable } from "../core/model";
import { withoutSourcePrefixes } from "../core/source-lines";

export interface RenderedBlock {
  element: HTMLElement;
  signature: string;
}

function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeName === "BR") return "\n";
  return Array.from(node.childNodes, visibleText).join("");
}

function text(node: Node): string {
  return visibleText(node).replace(/\s+/gu, " ").trim();
}

export function blockSignature(element: HTMLElement): string {
  const table = element.matches("table") ? element : element.querySelector("table");
  if (table !== null) {
    return JSON.stringify(["table", Array.from(table.rows, (row) => Array.from(row.cells,
      (cell) => [text(cell), cell.rowSpan, cell.colSpan]))]);
  }
  return JSON.stringify(["raw", text(element)]);
}

/** Inline formatting is interpreted by the same renderer as the native callout. */
export async function renderTableSignatures(app: App, table: StructuralTable, sourcePath: string): Promise<string[]> {
  const component = new Component();
  const container = createDiv({ cls: "structural-tables-container" });
  // Keep our own postprocessor out of this detached native-render comparison.
  component.load();
  try {
    await MarkdownRenderer.render(app, withoutSourcePrefixes(table.source), container, sourcePath, component);
    return Array.from(container.children, (child) => blockSignature(child as HTMLElement));
  } finally {
    component.unload();
  }
}

/** Never inspect embedded notes, code blocks, or another editor's document. */
export function calloutBlocks(root: HTMLElement, originals: ReadonlyMap<HTMLElement, readonly HTMLElement[]>): RenderedBlock[][] {
  const groups: RenderedBlock[][] = [];
  for (const content of root.querySelectorAll<HTMLElement>(".callout-content")) {
    if (content.closest(".internal-embed, .markdown-embed, .cm-editor")
      !== root.closest(".internal-embed, .markdown-embed, .cm-editor")) continue;
    let group: RenderedBlock[] = [];
    const flush = (): void => { if (group.length > 0) groups.push(group); group = []; };
    for (const child of Array.from(content.children) as HTMLElement[]) {
      const saved = originals.get(child);
      if (saved !== undefined) {
        group.push(...saved.map((element) => ({ element: child, signature: blockSignature(element) })));
      } else if (!child.matches(".callout, .internal-embed, .markdown-embed, pre, .cm-editor")
        && (child.matches("p, table") || (child.querySelectorAll("table").length === 1
        && !child.querySelector(".callout, .internal-embed, .markdown-embed, pre, .cm-editor")))) {
        group.push({ element: child, signature: blockSignature(child) });
      } else {
        flush();
      }
    }
    flush();
  }
  return groups;
}

export function matchingBlocks(groups: readonly RenderedBlock[][], signatures: readonly string[]): HTMLElement[][] {
  if (signatures.length === 0) return [];
  const matches: HTMLElement[][] = [];
  for (const group of groups) {
    for (let index = 0; index <= group.length - signatures.length; index += 1) {
      if (!signatures.every((signature, offset) => signature === group[index + offset]!.signature)) continue;
      matches.push([...new Set(group.slice(index, index + signatures.length).map((block) => block.element))]);
    }
  }
  return matches.sort((left, right) => {
    const position = left[0]!.compareDocumentPosition(right[0]!);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : 0;
  });
}
