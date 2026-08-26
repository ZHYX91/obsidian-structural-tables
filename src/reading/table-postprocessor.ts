import { App, MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";

import type { StructuralTablesSettings } from "../config/settings";
import { parseEditableTables } from "../core/parser";
import { diagnosticText, renderStructuralTable } from "../rendering/table-renderer";
import { rawStructuralTableElement } from "./table-mapping";

function renderedTables(container: HTMLElement): HTMLTableElement[] {
  const tables = Array.from(container.querySelectorAll<HTMLTableElement>("table"));
  if (container.tagName === "TABLE") tables.unshift(container as HTMLTableElement);
  return tables.filter((table) => !table.classList.contains("structural-tables-table"));
}

export class StructuralTableReadingProcessor {
  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
  ) {}

  process(container: HTMLElement, context: MarkdownPostProcessorContext): void {
    if (container.closest(".structural-tables-container, [data-structural-tables-processed='true']") !== null) return;
    const settings = this.getSettings();
    if (!settings.enableReadingView) return;
    if (!(container.textContent ?? "").includes("|") && renderedTables(container).length === 0) return;
    const section = context.getSectionInfo(container);
    if (section === null || section === undefined) return;
    const parsed = parseEditableTables(section.text).tables;
    if (parsed.length === 0) return;
    const candidates = renderedTables(container);
    let candidateIndex = 0;
    parsed.forEach((table) => {
      const rawSource = rawStructuralTableElement(container, table);
      const existing = rawSource ?? candidates[candidateIndex];
      if (rawSource === undefined) candidateIndex += 1;
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
      wrapper.dataset.density = settings.density;
      wrapper.dataset.zebra = String(settings.zebraRows);
      wrapper.dataset.tableKind = table.structural ? "structural" : "ordinary";
      existing.replaceWith(wrapper);
    });
  }
}
