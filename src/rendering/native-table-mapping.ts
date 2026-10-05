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
export async function renderTableSignatures(app: App, table: StructuralTable, sourcePath: string,
  document: Document): Promise<string[]> {
  const component = new Component();
  const container = document.createElement("div");
  container.className = "structural-tables-container";
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
      } else if (!child.matches(".callout, .internal-embed, .markdown-embed, pre, .cm-editor, .structural-tables-live-preview")
        && child.matches("p, table")) {
        group.push({ element: child, signature: blockSignature(child) });
      } else {
        const hardBoundary = ".callout, .internal-embed, .markdown-embed, pre, .cm-editor";
        const mountedSelector = ".structural-tables-live-preview";
        if (child.matches(hardBoundary) || child.querySelector(hardBoundary) !== null) {
          flush();
          continue;
        }
        const nestedHosts = Array.from(child.querySelectorAll<HTMLElement>(mountedSelector));
        if (nestedHosts.length > 0) {
          if (nestedHosts.length !== 1) {
            flush();
            continue;
          }
          const host = nestedHosts[0]!;
          const savedHost = originals.get(host);
          const foreignTables = Array.from(child.querySelectorAll("table"))
            .some((table) => !host.contains(table));
          if (savedHost === undefined || foreignTables) {
            flush();
            continue;
          }
          group.push(...savedHost.map((element) => ({ element: host, signature: blockSignature(element) })));
          continue;
        }
        if (child.matches(mountedSelector)) {
          flush();
          continue;
        }
        const nestedTables = child.querySelectorAll<HTMLTableElement>("table");
        const nested = nestedTables.length === 1 ? nestedTables[0] : undefined;
        if (nested === undefined) {
          flush();
        } else {
          // A list item or other wrapper can contain text before and after one
          // native table. The table is the owned render target; replacing the
          // wrapper would hide unrelated callout content.
          group.push({ element: nested, signature: blockSignature(nested) });
        }
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
