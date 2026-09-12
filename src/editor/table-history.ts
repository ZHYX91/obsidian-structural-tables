import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { StateEffect } from "@codemirror/state";

import type { StructuralTable } from "../core/model";
import type { TableCellCoordinate } from "./table-selection";

export interface TableHistoryTarget {
  from: number;
  sourcePath: string;
  before: string;
  after: string;
  coordinate: TableCellCoordinate;
}

/** Carry the rendered target through the host's own undo/redo history. */
export const tableHistoryTarget = StateEffect.define<TableHistoryTarget>({
  map: (target, changes) => ({ ...target, from: changes.mapPos(target.from, 1) }),
});

export const tableHistory = invertedEffects.of((transaction) => transaction.effects
  .filter((effect) => effect.is(tableHistoryTarget))
  .map((effect) => tableHistoryTarget.of({
    ...effect.value, before: effect.value.after, after: effect.value.before,
  })));

export function tableWriteHistory(table: StructuralTable, after: string,
  sourcePath: string, coordinate: TableCellCoordinate) {
  return {
    effects: tableHistoryTarget.of({ from: table.range.from, before: table.source, after, sourcePath, coordinate }),
    annotations: isolateHistory.of("full"),
  };
}
