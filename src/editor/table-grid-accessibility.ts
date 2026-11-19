/** Expose the interactive table as a multi-selectable grid to assistive technology. */
export function applyTableGridAccessibility(table: HTMLTableElement): void {
  const rows = Array.from(table.rows);
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.cells.length), 0);
  table.setAttribute("role", "grid");
  table.setAttribute("aria-multiselectable", "true");
  table.setAttribute("aria-rowcount", String(rows.length));
  table.setAttribute("aria-colcount", String(columnCount));
  rows.forEach((row, rowIndex) => {
    row.setAttribute("role", "row");
    row.setAttribute("aria-rowindex", String(rowIndex + 1));
    Array.from(row.cells).forEach((cell, columnIndex) => {
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-colindex", String(columnIndex + 1));
      if (!cell.hasAttribute("aria-selected")) cell.setAttribute("aria-selected", "false");
    });
  });
}
