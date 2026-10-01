import type { StructuralTable } from "./model";

export function hasHiddenGfmOverflow(table: StructuralTable): boolean {
  return table.rows.some((row) => (row.sourceCellCount ?? row.cells.length) > table.columnCount);
}

export function assertLosslessTableWrite(table: StructuralTable): void {
  if (!hasHiddenGfmOverflow(table)) return;
  throw new Error(
    "This GFM table contains extra source cells that Obsidian does not render. "
    + "Remove or move those cells in Markdown before replacing or migrating the table.",
  );
}
