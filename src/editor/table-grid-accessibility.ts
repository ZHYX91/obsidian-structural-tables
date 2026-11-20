import { withCount, type Translate } from "../config/i18n";

export function labelTableGrid(table: HTMLTableElement, sourceTableIndex: number, t: Translate): void {
  table.setAttribute("aria-label", withCount(t("editor.grid"), sourceTableIndex + 1));
}

/** Expose the interactive table as a multi-selectable grid to assistive technology. */
export function applyTableGridAccessibility(table: HTMLTableElement, columnCount: number): void {
  const rows = Array.from(table.rows);
  table.setAttribute("role", "grid");
  table.setAttribute("aria-multiselectable", "true");
  table.setAttribute("aria-rowcount", String(rows.length));
  table.setAttribute("aria-colcount", String(columnCount));
  rows.forEach((row, rowIndex) => {
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", String(rowIndex + 1));
    Array.from(row.cells).forEach((cell) => {
      // Covered cells have no DOM node. The renderer keeps the owner's logical column.
      const role = cell.tagName === "TH"
        ? cell.dataset.structuralRole === "row_header" ? "rowheader" : "columnheader"
        : "gridcell";
      cell.setAttribute("role", role);
      cell.setAttribute("aria-colindex", String(Number(cell.dataset.structuralColumn) + 1));
      if (!cell.hasAttribute("aria-selected")) cell.setAttribute("aria-selected", "false");
    });
  });
}
