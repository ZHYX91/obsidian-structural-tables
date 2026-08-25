import { App, Component, MarkdownRenderer } from "obsidian";

import type { StructuralTable } from "../core/model";

export function renderStructuralTable(
  app: App,
  table: StructuralTable,
  container: HTMLElement,
  sourcePath: string,
  component: Component,
): HTMLTableElement {
  const wrapper = container.createDiv({ cls: "structural-tables-container" });
  const rendered = wrapper.createEl("table", { cls: "structural-tables-table" });
  const head = rendered.createEl("thead");
  const body = rendered.createEl("tbody");
  table.rows.forEach((row, rowIndex) => {
    const section = rowIndex < table.headerRowCount ? head : body;
    const rowElement = section.createEl("tr");
    row.cells.forEach((cell) => {
      if (cell.covered) return;
      const header = cell.role !== "data";
      const element = rowElement.createEl(header ? "th" : "td");
      element.dataset.structuralRow = String(cell.row);
      element.dataset.structuralColumn = String(cell.column);
      if (cell.rowSpan > 1) element.rowSpan = cell.rowSpan;
      if (cell.columnSpan > 1) element.colSpan = cell.columnSpan;
      const alignment = table.alignments[cell.column] ?? "default";
      if (alignment !== "default") element.dataset.align = alignment;
      if (header) {
        if (cell.role === "row_header") element.scope = cell.rowSpan > 1 ? "rowgroup" : "row";
        else if (cell.role === "column_header") element.scope = cell.columnSpan > 1 ? "colgroup" : "col";
      }
      void MarkdownRenderer.render(app, cell.content, element, sourcePath, component);
    });
  });
  return rendered;
}

export function diagnosticText(table: StructuralTable): string {
  return table.diagnostics.map((diagnostic) => diagnostic.message).join(" ");
}
