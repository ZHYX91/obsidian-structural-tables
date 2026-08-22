import { App, MarkdownRenderChild, type MarkdownPostProcessorContext } from "obsidian";

import type { StructuralTablesSettings } from "../config/settings";
import { parseStructuralTables } from "../core/parser";
import { diagnosticText, renderStructuralTable } from "../rendering/table-renderer";

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
    const settings = this.getSettings();
    if (!settings.enableReadingView) return;
    const section = context.getSectionInfo(container);
    if (section === null) return;
    const parsed = parseStructuralTables(section.text).tables;
    if (parsed.length === 0) return;
    const candidates = renderedTables(container);
    parsed.forEach((table, index) => {
      const existing = candidates[index];
      if (existing === undefined) return;
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
      wrapper.dataset.width = settings.width;
      wrapper.dataset.density = settings.density;
      wrapper.dataset.zebra = String(settings.zebraRows);
      existing.replaceWith(wrapper);
    });
  }
}
