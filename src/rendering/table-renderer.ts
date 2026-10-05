import { App, Component, MarkdownRenderer } from "obsidian";

import type { StructuralTable } from "../core/model";

interface PendingCellRender {
  cancelled: boolean;
}

const pendingByComponent = new WeakMap<Component, Set<PendingCellRender>>();
const completionByTable = new WeakMap<HTMLTableElement, Promise<void>>();

/** Standalone consumers may clone the DOM as soon as their render promise settles. */
export function tableRenderingComplete(table: HTMLTableElement): Promise<void> {
  return completionByTable.get(table) ?? Promise.resolve();
}

function scheduleCellRendering(
  app: App,
  cells: readonly { source: string; target: HTMLElement }[],
  sourcePath: string,
  component: Component,
): Promise<void> {
  let pending = pendingByComponent.get(component);
  if (pending === undefined) {
    pending = new Set();
    pendingByComponent.set(component, pending);
    const owned = pending;
    component.register(() => {
      for (const task of owned) task.cancelled = true;
      owned.clear();
      pendingByComponent.delete(component);
    });
  }
  const task: PendingCellRender = { cancelled: false };
  pending.add(task);
  return new Promise((resolve) => queueMicrotask(() => {
    if (task.cancelled) { resolve(); return; }
    const renders = cells.map(async ({ source, target }) => {
      if (task.cancelled) return;
      try {
        await MarkdownRenderer.render(app, source, target, sourcePath, component);
      } catch {
        if (!task.cancelled) target.textContent = source;
      }
    });
    void Promise.allSettled(renders).finally(() => { pending?.delete(task); resolve(); });
  }));
}

export function renderStructuralTable(
  app: App,
  table: StructuralTable,
  container: HTMLElement,
  sourcePath: string,
  component: Component,
): HTMLTableElement {
  const wrapper = container.createDiv({ cls: "structural-tables-container markdown-rendered" });
  const rendered = wrapper.createEl("table", { cls: "structural-tables-table" });
  const head = table.headerRowCount > 0 ? rendered.createEl("thead") : null;
  const body = rendered.createEl("tbody");
  const pendingCells: { source: string; target: HTMLElement }[] = [];
  table.rows.forEach((row, rowIndex) => {
    const section = rowIndex < table.headerRowCount ? head : body;
    const rowElement = (section ?? body).createEl("tr");
    row.cells.forEach((cell) => {
      if (cell.covered) return;
      const header = cell.role !== "data";
      const element = rowElement.createEl(header ? "th" : "td");
      element.dataset.structuralRow = String(cell.row);
      element.dataset.structuralColumn = String(cell.column);
      element.dataset.structuralRole = cell.role;
      element.dataset.structuralBlockEnd = String(cell.row + cell.rowSpan === table.rows.length);
      element.dataset.structuralInlineEnd = String(cell.column + cell.columnSpan === table.columnCount);
      if (rowIndex < table.headerRowCount) {
        element.dataset.structuralHeaderEnd = String(cell.row + cell.rowSpan === table.headerRowCount);
      }
      if (cell.rowSpan > 1) element.rowSpan = cell.rowSpan;
      if (cell.columnSpan > 1) element.colSpan = cell.columnSpan;
      const alignment = table.alignments[cell.column] ?? "default";
      if (alignment !== "default") element.dataset.align = alignment;
      if (header) {
        if (cell.role === "row_header") element.scope = cell.rowSpan > 1 ? "rowgroup" : "row";
        else if (cell.role === "column_header") element.scope = cell.columnSpan > 1 ? "colgroup" : "col";
      }
      const content = element.createDiv({ cls: "structural-tables-cell-content" });
      pendingCells.push({ source: cell.content, target: content });
    });
  });
  // Never re-enter Obsidian's Markdown post-processor pipeline while CodeMirror
  // is still constructing the widget DOM. The owning component cancels stale
  // work if the view is destroyed before this microtask runs.
  completionByTable.set(rendered, scheduleCellRendering(app, pendingCells, sourcePath, component));
  return rendered;
}
