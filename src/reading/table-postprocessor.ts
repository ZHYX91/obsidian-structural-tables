import { App, MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";

import { createTranslator, diagnosticNotice } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import { parseEditableTables } from "../core/parser";
import { renderStructuralTable } from "../rendering/table-renderer";
import { rawStructuralTableElement } from "./table-mapping";
import { ReadingBlockMapper } from "./block-mapping";
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

function diagnosticTitle(table: StructuralTable, settings: StructuralTablesSettings): string {
  const t = createTranslator(settings.language);
  return table.diagnostics.map((diagnostic) => diagnosticNotice(t, diagnostic)).join(" ");
}

export class StructuralTableReadingProcessor {
  private readonly calloutSessions = new WeakMap<HTMLElement, CalloutRenderSession>();
  private readonly blockMapper: ReadingBlockMapper;
  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
  ) { this.blockMapper = new ReadingBlockMapper(app, getSettings); }

  process(container: HTMLElement, context: MarkdownPostProcessorContext): void {
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
    const allTables = parseEditableTables(section.text).tables;
    const parsed = allTables
      .filter((table) => table.startLine >= section.lineStart && table.endLine <= section.lineEnd)
      .map((table) => ({
        ...table,
        startLine: table.startLine - section.lineStart,
        endLine: table.endLine - section.lineStart,
        delimiterLine: table.delimiterLine - section.lineStart,
      }));
    if (container.matches(".callout") || container.querySelector(".callout") !== null) {
      // Native comparison rendering shares Obsidian's render queue. Returning
      // its promise would hold the current section open while waiting on itself.
      // The render child and source checks below own this deferred work instead.
      void this.processCallout(container, context, parsed, section.text);
      return;
    }
    const deferred = allTables.filter((table) => table.valid && table.structural
      && (table.headerRowCount > 1 || table.rowHeaderColumnCount > 0)
      && table.startLine <= section.lineEnd && table.endLine >= section.lineStart);
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
      // Multi-row headers may occupy a preceding paragraph and a native table.
      // Their complete source must be mapped atomically, never by native position.
      if (native && table.headerRowCount > 1) return;
      if ((!table.structural && !settings.takeOverOrdinaryTables) || existing === undefined) return;
      const deferredIndex = deferred.findIndex((candidate) => candidate.range.from === table.range.from);
      if (deferredIndex >= 0) deferred.splice(deferredIndex, 1);
      existing.dataset.structuralTablesProcessed = "true";
      if (!table.valid) {
        if (settings.showDiagnostics) {
          existing.classList.add("structural-tables-invalid");
          existing.title = diagnosticTitle(table, settings);
        }
        return;
      }
      const staging = existing.ownerDocument.createElement("div");
      const component = new MarkdownRenderChild(staging);
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
      // The host tracks render-child lifetime by containerEl. Keep ownership
      // on the replacement, otherwise removing the source block can cancel
      // queued cell rendering while the visible table is still alive.
      component.containerEl = wrapper;
      existing.replaceWith(wrapper);
      context.addChild(component);
    });
    if (deferred.length > 0) this.blockMapper.process(container, context, section, deferred);
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
          target.title = diagnosticTitle(plan.table, settings);
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
