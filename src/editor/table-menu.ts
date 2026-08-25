import type { Menu } from "obsidian";

import { type Translate, withCount } from "../config/i18n";
import {
  alignTableColumns,
  deleteTableColumns,
  deleteTableRows,
  insertTableColumn,
  insertTableRow,
  mergeCellRange,
  moveTableColumns,
  moveTableRows,
  setHeaderRowCount,
  setRowHeaderColumnCount,
  splitCell,
  type OperationResult,
} from "../core/operations";
import type { StructuralTable } from "../core/model";
import type { StructuralTableSelection } from "./table-selection";

export type TableOperation = (table: StructuralTable) => OperationResult;
export type TableOperationApplier = (operation: TableOperation) => void;

interface SelectionMenuState {
  canMerge: boolean;
  canRemoveRowHeaders: boolean;
  canSetHeaderRows: boolean;
  canSetRowHeaderColumns: boolean;
  canSplit: boolean;
  fullEditor: boolean;
}

function selectionMenuState(selection: StructuralTableSelection): SelectionMenuState {
  const { table } = selection;
  const cell = selection.cells.length === 1 ? selection.cells[0] : undefined;
  const anchor = cell === undefined ? undefined : table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
  const selectsWholeRows = selection.minColumn === 0
    && selection.maxColumn === table.columnCount - 1;
  const selectsWholeColumns = selection.minRow === 0
    && selection.maxRow === table.rows.length - 1;
  return {
    canMerge: selection.cells.length > 1,
    canRemoveRowHeaders: selectsWholeColumns && table.rowHeaderColumnCount > 0,
    canSetHeaderRows: selectsWholeRows && selection.minRow === 0,
    canSetRowHeaderColumns: selectsWholeColumns && selection.minColumn === 0 && selection.maxColumn < table.columnCount - 1,
    canSplit: anchor !== undefined && (anchor.rowSpan > 1 || anchor.columnSpan > 1),
    fullEditor: table.structural,
  };
}

export function hasSelectionMenuItems(selection: StructuralTableSelection): boolean {
  const state = selectionMenuState(selection);
  return state.canMerge
    || state.canRemoveRowHeaders
    || state.canSetHeaderRows
    || state.canSetRowHeaderColumns
    || state.canSplit
    || state.fullEditor;
}

export function addSelectionMenuItems(
  menu: Menu,
  t: Translate,
  selection: StructuralTableSelection,
  apply: TableOperationApplier,
): void {
  const state = selectionMenuState(selection);
  if (state.fullEditor) {
    menu.addItem((item) => item
      .setSection("structural-tables-row")
      .setIcon("arrow-up-to-line")
      .setTitle(t("menu.insertRowAbove"))
      .onClick(() => apply((current) => insertTableRow(current, selection.minRow, "before"))));
    menu.addItem((item) => item
      .setSection("structural-tables-row")
      .setIcon("arrow-down-to-line")
      .setTitle(t("menu.insertRowBelow"))
      .onClick(() => apply((current) => insertTableRow(current, selection.maxRow, "after"))));
    menu.addItem((item) => item
      .setSection("structural-tables-row")
      .setIcon("arrow-up")
      .setTitle(t("menu.moveRowsUp"))
      .onClick(() => apply((current) => moveTableRows(current, selection.minRow, selection.maxRow, "backward"))));
    menu.addItem((item) => item
      .setSection("structural-tables-row")
      .setIcon("arrow-down")
      .setTitle(t("menu.moveRowsDown"))
      .onClick(() => apply((current) => moveTableRows(current, selection.minRow, selection.maxRow, "forward"))));
    menu.addItem((item) => item
      .setSection("structural-tables-row")
      .setIcon("trash-2")
      .setTitle(t("menu.deleteRows"))
      .setWarning(true)
      .onClick(() => apply((current) => deleteTableRows(current, selection.minRow, selection.maxRow))));

    menu.addItem((item) => item
      .setSection("structural-tables-column")
      .setIcon("arrow-left-to-line")
      .setTitle(t("menu.insertColumnLeft"))
      .onClick(() => apply((current) => insertTableColumn(current, selection.minColumn, "before"))));
    menu.addItem((item) => item
      .setSection("structural-tables-column")
      .setIcon("arrow-right-to-line")
      .setTitle(t("menu.insertColumnRight"))
      .onClick(() => apply((current) => insertTableColumn(current, selection.maxColumn, "after"))));
    menu.addItem((item) => item
      .setSection("structural-tables-column")
      .setIcon("arrow-left")
      .setTitle(t("menu.moveColumnsLeft"))
      .onClick(() => apply((current) => moveTableColumns(current, selection.minColumn, selection.maxColumn, "backward"))));
    menu.addItem((item) => item
      .setSection("structural-tables-column")
      .setIcon("arrow-right")
      .setTitle(t("menu.moveColumnsRight"))
      .onClick(() => apply((current) => moveTableColumns(current, selection.minColumn, selection.maxColumn, "forward"))));
    menu.addItem((item) => item
      .setSection("structural-tables-column")
      .setIcon("trash-2")
      .setTitle(t("menu.deleteColumns"))
      .setWarning(true)
      .onClick(() => apply((current) => deleteTableColumns(current, selection.minColumn, selection.maxColumn))));

    const alignments = [
      ["default", "menu.alignDefault", "align-horizontal-space-around"],
      ["left", "menu.alignLeft", "align-left"],
      ["center", "menu.alignCenter", "align-center"],
      ["right", "menu.alignRight", "align-right"],
    ] as const;
    for (const [alignment, title, icon] of alignments) {
      menu.addItem((item) => item
        .setSection("structural-tables-alignment")
        .setIcon(icon)
        .setTitle(t(title))
        .onClick(() => apply((current) => alignTableColumns(
          current,
          selection.minColumn,
          selection.maxColumn,
          alignment,
        ))));
    }
  }
  if (state.canMerge) {
    menu.addItem((item) => item
      .setSection("structural-tables")
      .setIcon("combine")
      .setTitle(t("menu.mergeSelection"))
      .onClick(() => apply((current) => mergeCellRange(
        current,
        selection.minRow,
        selection.minColumn,
        selection.maxRow,
        selection.maxColumn,
      ))));
  }
  if (state.canSplit) {
    const cell = selection.cells[0];
    menu.addItem((item) => item
      .setSection("structural-tables")
      .setIcon("split")
      .setTitle(t("menu.splitCell"))
      .onClick(() => apply((current) => splitCell(current, cell?.row ?? -1, cell?.column ?? -1))));
  }
  if (state.canSetHeaderRows) {
    const count = selection.maxRow + 1;
    menu.addItem((item) => item
      .setSection("structural-tables")
      .setIcon("rows-3")
      .setTitle(withCount(t("menu.setHeaderRows"), count))
      .onClick(() => apply((current) => setHeaderRowCount(current, count))));
  }
  if (state.canSetRowHeaderColumns) {
    const count = selection.maxColumn + 1;
    menu.addItem((item) => item
      .setSection("structural-tables")
      .setIcon("columns-3")
      .setTitle(withCount(t("menu.setRowHeaderColumns"), count))
      .onClick(() => apply((current) => setRowHeaderColumnCount(current, count))));
  }
  if (state.canRemoveRowHeaders) {
    menu.addItem((item) => item
      .setSection("structural-tables")
      .setIcon("columns-2")
      .setTitle(t("menu.removeRowHeaders"))
      .onClick(() => apply((current) => setRowHeaderColumnCount(current, 0))));
  }
}
