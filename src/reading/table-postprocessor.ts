import { App, MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";

import type { StructuralTablesSettings } from "../config/settings";
import { parseEditableTables } from "../core/parser";
import { diagnosticText, renderStructuralTable } from "../rendering/table-renderer";
import { rawStructuralTableElement } from "./table-mapping";
import type { StructuralTable } from "../core/model";
import { calloutBlocks, matchingBlocks, renderTableSignatures } from "../rendering/native-table-mapping";

class CalloutRenderSession extends MarkdownRenderChild {
  active = true;
  override onunload(): void { this.active = false; }
}

function renderedTables(container: HTMLElement): HTMLTableElement[] {
  const tables = Array.from(container.querySelectorAll<HTMLTableElement>("table"));
  if (container.tagName === "TABLE") tables.unshift(container as HTMLTableElement);
  return tables.filter((table) => !table.classList.contains("structural-tables-table"));
}

function sectionSource(
  text: string,
  lineStart: number,
  lineEnd: number,
): string | null {
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd) || lineStart < 0 || lineEnd < lineStart) {
    return null;
  }
  const ending = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
  const lines = text.split(/\r\n|\r|\n/gu);
  if (lineStart >= lines.length) return null;
  return lines.slice(lineStart, Math.min(lineEnd + 1, lines.length)).join(ending);
}

export class StructuralTableReadingProcessor {
  private readonly calloutSessions = new WeakMap<HTMLElement, CalloutRenderSession>();
  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
  ) {}

  process(container: HTMLElement, context: MarkdownPostProcessorContext): void | Promise<void> {
    if (container.closest(".structural-tables-container, [data-structural-tables-processed='true']") !== null) return;
    const settings = this.getSettings();
    if (!settings.enableReadingView) return;
    if (!(container.textContent ?? "").includes("|") && renderedTables(container).length === 0) return;
    const section = context.getSectionInfo(container);
    if (section === null || section === undefined) return;
    const source = sectionSource(section.text, section.lineStart, section.lineEnd);
    if (source === null) return;
    // Parse with the note's container and protected-region context intact, then
    // translate source lines into this renderer section's coordinate system.
    const parsed = parseEditableTables(section.text).tables
      .filter((table) => table.startLine >= section.lineStart && table.endLine <= section.lineEnd)
      .map((table) => ({
        ...table,
        startLine: table.startLine - section.lineStart,
        endLine: table.endLine - section.lineStart,
        delimiterLine: table.delimiterLine - section.lineStart,
      }));
    if (parsed.length === 0) return;
    if (container.matches(".callout") || container.querySelector(".callout") !== null) {
      return this.processCallout(container, context, parsed, section.text);
    }
    const candidates = renderedTables(container);
    let candidateIndex = 0;
    parsed.forEach((table) => {
      const rawSource = rawStructuralTableElement(container, table, (element) => {
        const info = context.getSectionInfo(element);
        return info?.lineStart === section.lineStart + table.startLine
          && info.lineEnd === section.lineStart + table.endLine;
      });
      // An adjacent || delimiter cannot produce a native GFM table. If its raw
      // block cannot be identified, it must never consume a later native table.
      const native = rawSource === undefined && table.rowHeaderColumnCount === 0;
      const existing = rawSource ?? (native ? candidates[candidateIndex] : undefined);
      if (native) candidateIndex += 1;
      if ((!table.structural && !settings.takeOverOrdinaryTables) || existing === undefined) return;
      existing.dataset.structuralTablesProcessed = "true";
      if (!table.valid) {
        if (settings.showDiagnostics) {
          existing.classList.add("structural-tables-invalid");
          existing.title = diagnosticText(table);
        }
        return;
      }
      const component = new MarkdownRenderChild(existing);
      context.addChild(component);
      const staging = existing.ownerDocument.createElement("div");
      const rendered = renderStructuralTable(this.app, table, staging, context.sourcePath, component);
      const wrapper = rendered.parentElement;
      if (wrapper === null) {
        component.unload();
        return;
      }
      wrapper.dataset.layout = settings.layout;
      wrapper.dataset.appearance = settings.appearance;
      wrapper.dataset.density = settings.density;
      wrapper.dataset.zebra = String(settings.zebraRows);
      wrapper.dataset.tableKind = table.structural ? "structural" : "ordinary";
      existing.replaceWith(wrapper);
    });
  }

  private async processCallout(container: HTMLElement, context: MarkdownPostProcessorContext,
    tables: readonly StructuralTable[], source: string): Promise<void> {
    const session = new CalloutRenderSession(container);
    this.calloutSessions.set(container, session);
    context.addChild(session);
    const templates = await Promise.all(tables.map(async (table) => {
      try { return await renderTableSignatures(this.app, table, context.sourcePath); }
      catch { return []; }
    }));
    if (!session.active || this.calloutSessions.get(container) !== session
      || context.getSectionInfo(container)?.text !== source) return;
    const settings = this.getSettings();
    if (!settings.enableReadingView) return;
    const blocks = calloutBlocks(container, new Map());
    const plans = tables.map((table, index) => ({ table, key: JSON.stringify(templates[index]),
      matches: matchingBlocks(blocks, templates[index]!) }));
    for (const plan of plans) {
      if (!plan.table.structural && !settings.takeOverOrdinaryTables) continue;
      const peers = plans.filter((other) => other.key === plan.key);
      const targets = plan.matches.length === peers.length ? plan.matches[peers.indexOf(plan)] : undefined;
      if (targets === undefined || plans.some((other) => other.key !== plan.key
        && other.matches.some((match) => match.some((element) => targets.includes(element))))) continue;
      if (!plan.table.valid) {
        if (settings.showDiagnostics) for (const target of targets) {
          target.classList.add("structural-tables-invalid");
          target.title = diagnosticText(plan.table);
        }
        continue;
      }
      const staging = container.ownerDocument.createElement("div");
      const rendered = renderStructuralTable(this.app, plan.table, staging, context.sourcePath, session);
      const wrapper = rendered.parentElement;
      if (wrapper === null) continue;
      wrapper.dataset.layout = settings.layout;
      wrapper.dataset.appearance = settings.appearance;
      wrapper.dataset.density = settings.density;
      wrapper.dataset.zebra = String(settings.zebraRows);
      wrapper.dataset.tableKind = plan.table.structural ? "structural" : "ordinary";
      wrapper.dataset.structuralTablesProcessed = "true";
      targets[0]!.before(wrapper);
      for (const target of targets) target.remove();
    }
  }
}
