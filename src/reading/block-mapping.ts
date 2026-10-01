import { ownReadingLayout } from "./layout-owner";
import { App, Component, MarkdownRenderChild, MarkdownRenderer, type MarkdownPostProcessorContext,
  type MarkdownSectionInformation } from "obsidian";

import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { withoutSourcePrefixes } from "../core/source-lines";
import { renderStructuralTable } from "../rendering/table-renderer";

const barriers = ".callout, .internal-embed, .markdown-embed, pre, code, .cm-editor, .structural-tables-container";

class SectionSession extends MarkdownRenderChild {
  active = true;
  override onunload(): void { this.active = false; }
}

interface Section {
  element: HTMLElement;
  context: MarkdownPostProcessorContext;
  info: MarkdownSectionInformation;
  session: SectionSession;
}

interface TextPosition { node: Text; offset: number; visibleOffset: number }
interface TextIndex { text: string; compact: string; positions: TextPosition[] }
interface Target { element: HTMLElement; range?: Range }

/** Obsidian annotates text direction after postprocessors start deferred work. */
function snapshotHtml(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  for (const child of clone.querySelectorAll("[dir]")) child.removeAttribute("dir");
  return clone.innerHTML;
}

/** Index rendered characters, retaining exact DOM endpoints and line boundaries. */
function textIndex(element: HTMLElement): TextIndex {
  const result: TextIndex = { text: "", compact: "", positions: [] };
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset]!;
        if (!/\s/u.test(character)) {
          result.compact += character;
          result.positions.push({ node: node as Text, offset, visibleOffset: result.text.length });
        }
        result.text += character;
      }
    } else if (node.nodeName === "BR") result.text += "\n";
    else for (const child of node.childNodes) visit(child);
  };
  visit(element);
  return result;
}

/** Compare inline structure and destinations, not just link labels or cell text. */
function contentSignature(root: Node): string {
  const parts: (string | string[])[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s/gu, "");
      if (!text) return;
      const last = parts[parts.length - 1];
      if (typeof last === "string") parts[parts.length - 1] = last + text;
      else parts.push(text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      parts.push([element.tagName, ...["href", "data-href", "src", "alt", "rowspan", "colspan"]
        .map((attribute) => element.getAttribute(attribute) ?? "")]);
      for (const child of element.childNodes) visit(child);
      parts.push(["/" + element.tagName]);
    }
  };
  for (const child of root.childNodes) visit(child);
  return JSON.stringify(parts);
}

function rawTarget(element: HTMLElement, expected: HTMLElement, allowPrefix: boolean, allowSuffix: boolean): Target | undefined {
  const actual = textIndex(element);
  const wanted = textIndex(expected).compact;
  const start = actual.compact.indexOf(wanted);
  if (wanted.length === 0 || start < 0 || actual.compact.indexOf(wanted, start + 1) >= 0) return undefined;
  if ((!allowPrefix && start !== 0) || (!allowSuffix && start + wanted.length !== actual.compact.length)) return undefined;
  const first = actual.positions[start]!;
  const last = actual.positions[start + wanted.length - 1]!;
  // A substring of prose is not a source block. Only acquire complete rendered lines.
  const before = actual.text.slice(0, first.visibleOffset);
  const after = actual.text.slice(last.visibleOffset + 1);
  if ((before.trim().length > 0 && !/\n[^\S\n]*$/u.test(before))
    || (after.trim().length > 0 && !/^[^\S\n]*\n/u.test(after))) return undefined;
  const range = element.ownerDocument.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  // Embedded/media/widget content is not represented by the text index.
  if (Array.from(element.querySelectorAll("img, svg, iframe, input, audio, video, .math, .internal-embed, .markdown-embed"))
    .some((child) => range.intersectsNode(child))) return undefined;
  if (contentSignature(range.cloneContents()) !== contentSignature(expected)) return undefined;
  return { element, range };
}

/** Only transparent section wrappers may be traversed; foreign blocks split groups. */
function blockGroups(sections: readonly Section[]): HTMLElement[][] {
  const groups: HTMLElement[][] = [];
  let group: HTMLElement[] = [];
  const flush = (): void => { if (group.length > 0) groups.push(group); group = []; };
  const visit = (element: HTMLElement): void => {
    if (element.matches(barriers)) { flush(); return; }
    if (element.matches("p, table")) {
      if (element.querySelector(barriers.replace(", code", "")) !== null) flush();
      else group.push(element);
      return;
    }
    if (element.tagName !== "DIV") { flush(); return; }
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) visit(child as HTMLElement);
      else if (child.textContent?.trim()) flush();
    }
  };
  for (const section of sections) visit(section.element);
  flush();
  return groups;
}

function matchingTargets(groups: readonly HTMLElement[][], templates: readonly HTMLElement[]): Target[][] {
  const matches: Target[][] = [];
  for (const group of groups) for (let start = 0; start <= group.length - templates.length; start += 1) {
    const targets: Target[] = [];
    for (let offset = 0; offset < templates.length; offset += 1) {
      const expected = templates[offset]!;
      const element = group[start + offset]!;
      if (expected.tagName !== element.tagName) break;
      const target = expected.tagName === "TABLE"
        ? (contentSignature(element) === contentSignature(expected) ? { element } : undefined)
        : rawTarget(element, expected, offset === 0, offset === templates.length - 1);
      if (target === undefined) break;
      targets.push(target);
    }
    if (targets.length === templates.length) matches.push(targets);
  }
  return matches;
}

function trimBoundary(element: HTMLElement, edge: "start" | "end"): void {
  // One source-line separator belongs to the removed table. Additional BRs
  // can be intentional inline HTML in the surviving prose.
  let removedBreak = false;
  let node = edge === "start" ? element.firstChild : element.lastChild;
  while (node !== null) {
    if (node.nodeName === "BR" && !removedBreak) removedBreak = true;
    else if (node.nodeType !== Node.TEXT_NODE || node.textContent?.trim()) break;
    node.remove();
    node = edge === "start" ? element.firstChild : element.lastChild;
  }
}

function replaceTarget(target: Target, replacement?: HTMLElement): void {
  const { element, range } = target;
  if (range === undefined) {
    if (replacement !== undefined) element.before(replacement);
    element.remove();
    return;
  }
  const tail = element.cloneNode(false) as HTMLElement;
  tail.removeAttribute("id");
  const tailRange = element.ownerDocument.createRange();
  tailRange.selectNodeContents(element);
  tailRange.setStart(range.endContainer, range.endOffset);
  tail.append(tailRange.extractContents());
  range.deleteContents();
  trimBoundary(element, "end");
  trimBoundary(tail, "start");
  if (tail.hasChildNodes()) element.after(tail);
  if (replacement !== undefined) element.after(replacement);
  if (!element.hasChildNodes()) element.remove();
}

/** Fallback for structural tables whose source and native block boundaries differ. */
export class ReadingBlockMapper {
  private readonly sections = new WeakMap<HTMLElement, Section>();

  constructor(private readonly app: App, private readonly getSettings: () => StructuralTablesSettings) {}

  process(element: HTMLElement, context: MarkdownPostProcessorContext, info: MarkdownSectionInformation,
    tables: readonly StructuralTable[]): void {
    this.sections.get(element)?.session.unload();
    const session = new SectionSession(element);
    // Also support hosts/test doubles that run registered teardown without onunload.
    session.register(() => { session.active = false; });
    const section: Section = { element, context, info: { ...info }, session };
    this.sections.set(element, section);
    context.addChild(session);
    void this.replaceTables(section, tables);
  }

  private async replaceTables(section: Section, tables: readonly StructuralTable[]): Promise<void> {
    // A replacement can split a paragraph shared by another table. Map the next
    // table against the resulting DOM rather than dropping a stale parallel plan.
    for (const table of tables) {
      if (!section.session.active || this.sections.get(section.element) !== section) return;
      const scope = this.scope(section, table);
      if (scope !== undefined) await this.replace(scope, table);
    }
  }

  private scope(current: Section, table: StructuralTable): Section[] | undefined {
    if (current.info.lineStart <= table.startLine && current.info.lineEnd >= table.endLine) return [current];
    const parent = current.element.parentElement;
    if (parent === null) return undefined;
    const scope: Section[] = [];
    for (const child of parent.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        if (scope.length > 0 && child.textContent?.trim()) break;
        continue;
      }
      const section = this.sections.get(child as HTMLElement);
      if (section === undefined || section.info.lineEnd < table.startLine || section.info.lineStart > table.endLine) {
        if (scope.length > 0) break;
        continue;
      }
      if (!section.session.active || section.info.text !== current.info.text
        || section.context.sourcePath !== current.context.sourcePath || section.context.docId !== current.context.docId
        || (scope.length > 0 && scope[scope.length - 1]!.info.lineEnd + 1 !== section.info.lineStart)) return undefined;
      scope.push(section);
    }
    return scope.includes(current) && scope[0]!.info.lineStart <= table.startLine
      && scope[scope.length - 1]!.info.lineEnd >= table.endLine ? scope : undefined;
  }

  private async replace(scope: readonly Section[], table: StructuralTable): Promise<void> {
    const owner = scope[0]!;
    const snapshots = scope.map((section) => ({ html: snapshotHtml(section.element), parent: section.element.parentElement }));
    const comparison = new Component();
    const staging = owner.element.ownerDocument.adoptNode(createEl("div"));
    staging.className = "structural-tables-container";
    comparison.load();
    let templates: HTMLElement[];
    try {
      await MarkdownRenderer.render(this.app, withoutSourcePrefixes(table.source), staging, owner.context.sourcePath, comparison);
      templates = Array.from(staging.children, (element) => element.cloneNode(true) as HTMLElement);
    } catch { return; }
    finally { comparison.unload(); }
    if (templates.length === 0 || templates.some((element) => !element.matches("p, table"))) return;
    if (!this.getSettings().enableReadingView || scope.some((section, index) => {
      const info = section.context.getSectionInfo(section.element);
      return !section.session.active || this.sections.get(section.element) !== section
        || section.element.parentElement !== snapshots[index]!.parent || snapshotHtml(section.element) !== snapshots[index]!.html
        || info?.text !== section.info.text || info.lineStart !== section.info.lineStart || info.lineEnd !== section.info.lineEnd;
    })) return;
    const currentScope = this.scope(owner, table);
    if (currentScope?.length !== scope.length || currentScope.some((section, index) => section !== scope[index])) return;
    const matches = matchingTargets(blockGroups(scope), templates);
    // Repeated text/coarse ownership is ambiguous. Never choose by position alone.
    if (matches.length !== 1) return;
    const targets = matches[0]!;
    const component = new MarkdownRenderChild(staging);
    const rendered = renderStructuralTable(this.app, table, staging, owner.context.sourcePath, component);
    const wrapper = rendered.parentElement;
    if (wrapper === null) { component.unload(); return; }
    const settings = this.getSettings();
    wrapper.dataset.layout = settings.layout;
    wrapper.dataset.appearance = settings.appearance;
    wrapper.dataset.density = settings.density;
    wrapper.dataset.zebra = String(settings.zebraRows);
    wrapper.dataset.tableKind = "structural";
    wrapper.dataset.structuralTablesProcessed = "true";
    component.containerEl = wrapper;
    targets.forEach((target, index) => replaceTarget(target, index === 0 ? wrapper : undefined));
    ownReadingLayout(wrapper, component);
    owner.context.addChild(component);
  }
}
