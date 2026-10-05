import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";

export interface TableSelectionRange {
  from: number;
  to: number;
  empty: boolean;
}

export interface TableOwnedRange {
  from: number;
  to: number;
}

export type StructuralTableViewMode = "ignored" | "source" | "presentation" | "invalid";

function selectionIntersectsTable(
  selection: TableSelectionRange,
  table: StructuralTable,
): boolean {
  return selection.empty
    ? selection.from >= table.range.from && selection.from < table.range.to
    : selection.from < table.range.to && selection.to > table.range.from;
}

export function structuralTableViewMode(
  table: StructuralTable,
  settings: StructuralTablesSettings,
  selections: readonly TableSelectionRange[],
  ownedRanges: readonly TableOwnedRange[],
  sourceFocused = true,
): StructuralTableViewMode {
  if (ownedRanges.some((range) => table.range.from >= range.from && table.range.to <= range.to)) {
    return "ignored";
  }
  if (!table.structural && !settings.takeOverOrdinaryTables) return "ignored";
  if (sourceFocused && selections.some((selection) => selectionIntersectsTable(selection, table))) return "source";
  return table.valid ? "presentation" : "invalid";
}
