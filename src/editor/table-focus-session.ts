import { EditorView } from "@codemirror/view";
import type { ChangeDesc } from "@codemirror/state";
import { editorInfoField } from "obsidian";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { parseEditableTables } from "../core/parser";
import { sourcePrefix } from "../core/source-lines";
import type { TableHistoryTarget } from "./table-history";
import type { VisualTextareaExit } from "./textarea-visual-navigation";
import type { TableCellCoordinate } from "./table-selection";
import type { AxisSelection } from "./table-axis-drag";
import { structuralTableSourceFocus } from "./table-source-focus";

export interface PendingCellFocus {
  from: number;
  source: string;
  sourcePath: string;
  coordinate: TableCellCoordinate;
  edit: boolean;
  axisSelection?: AxisSelection;
  selectionBounds?: { first: TableCellCoordinate; last: TableCellCoordinate };
  entryIntent?: CellEditEntryIntent;
}
export const pendingCellFocus = new WeakMap<EditorView, PendingCellFocus>();
export const activeCellEditors = new WeakMap<Document, HTMLTextAreaElement>();
export const composingCellEditors = new WeakSet<HTMLTextAreaElement>();

export type CellEditEntryIntent = "select-all" | { caretOffset: number; pointer?: { x: number; y: number; at: number } } | { selectionStart: number; selectionEnd: number; selectionDirection?: "forward" | "backward" } | { visual: VisualTextareaExit };

const focusConsumers = new WeakMap<HTMLElement, (view: EditorView, pending: PendingCellFocus) => boolean>();

export function registerTableFocusHost(host: HTMLElement, consume: (view: EditorView, pending: PendingCellFocus) => boolean): void {
  focusConsumers.set(host, consume);
}

export function unregisterTableFocusHost(host: HTMLElement): void { focusConsumers.delete(host); }

export function ownsCellEditorFocus(editor: HTMLTextAreaElement): boolean {
  return activeCellEditors.get(editor.ownerDocument) === editor;
}

export function claimCellEditorFocus(editor: HTMLTextAreaElement): void {
  activeCellEditors.set(editor.ownerDocument, editor);
}

export function releaseCellEditorFocus(editor: HTMLTextAreaElement): void {
  if (ownsCellEditorFocus(editor)) activeCellEditors.delete(editor.ownerDocument);
}

export function focusNativeTable(view: EditorView, table: StructuralTable, coordinate: TableCellCoordinate): void {
  cancelPendingTableFocus(view);
  const row = table.rows[Math.min(coordinate.row, table.rows.length - 1)];
  const line = view.state.doc.line((row?.sourceLine ?? table.startLine) + 1);
  const anchor = Math.min(line.to, line.from + table.sourcePrefix.length + 1);
  // Native editing uses the source caret. Move it before focusing, otherwise
  // mobile keyboards reveal an unrelated old caret (often the document start).
  view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "nearest" }) });
  view.focus();
}

export function requestNativeFocus(view: EditorView, pending: PendingCellFocus): void {
  const state = view.state;
  pendingCellFocus.set(view, pending);
  queueMicrotask(() => {
    if (pendingCellFocus.get(view) !== pending) return;
    cancelPendingTableFocus(view);
    if (view.state !== state || !view.dom.isConnected
      || view.state.field(editorInfoField, false)?.file?.path !== pending.sourcePath) return;
    const anchor = Math.min(pending.from, state.doc.length);
    view.dispatch({
      selection: { anchor },
      effects: [structuralTableSourceFocus.of(true), EditorView.scrollIntoView(anchor, { y: "nearest" })],
    });
    view.focus();
  });
}

export function requestTableFocus(view: EditorView, pending: PendingCellFocus): void {
  pendingCellFocus.set(view, pending);
  queueMicrotask(() => {
    if (pendingCellFocus.get(view) !== pending) return;
    if (!view.dom.isConnected || view.state.field(editorInfoField, false)?.file?.path !== pending.sourcePath
      || view.state.doc.sliceString(pending.from, pending.from + pending.source.length) !== pending.source) {
      cancelPendingTableFocus(view);
      return;
    }
    for (const host of view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview")) {
      if (focusConsumers.get(host)?.(view, pending)) return;
    }
    const table = parseEditableTables(view.state.doc.toString()).tables.find((candidate) =>
      candidate.range.from === pending.from && candidate.source === pending.source);
    cancelPendingTableFocus(view);
    if (table !== undefined) focusNativeTable(view, table, pending.coordinate);
  });
}

export function restoreTableHistoryFocus(view: EditorView,
  target: TableHistoryTarget,
  settings: StructuralTablesSettings): void {
  if (view.state.field(editorInfoField, false)?.file?.path !== target.sourcePath) return;
  const quotedRemoval = target.restorePresentation === true && target.after.includes(">")
    && sourcePrefix(target.after) === target.after
    && view.state.doc.sliceString(target.from, target.from + target.after.length) === target.after;
  if (target.after === "" || quotedRemoval) {
    requestNativeFocus(view, {
      from: target.from, source: target.after, sourcePath: target.sourcePath, coordinate: target.coordinate, edit: false,
    });
    return;
  }
  const table = parseEditableTables(view.state.doc.toString()).tables.find((candidate) =>
    candidate.range.from === target.from && candidate.source === target.after);
  if (table === undefined || !table.valid) return;
  const state = view.state;
  const pending: PendingCellFocus = {
    from: target.from, source: target.after, sourcePath: target.sourcePath, coordinate: target.coordinate, edit: false,
  };
  pendingCellFocus.set(view, pending);
  queueMicrotask(() => {
    if (pendingCellFocus.get(view) !== pending) return;
    if (view.state !== state || !view.dom.isConnected) {
      cancelPendingTableFocus(view);
      return;
    }
    if (!table.structural && !settings.takeOverOrdinaryTables) {
      focusNativeTable(view, table, target.coordinate);
      return;
    }
    view.dispatch({ effects: EditorView.scrollIntoView(table.range.from, { y: "nearest" }) });
  });
}

export function cancelPendingTableFocus(view: EditorView): void {
  pendingCellFocus.delete(view);
}

export function mapPendingTableFocus(view: EditorView, changes: ChangeDesc): void {
  const pending = pendingCellFocus.get(view);
  if (pending === undefined) return;
  const to = pending.from + pending.source.length;
  let targetChanged = false;
  changes.iterChangedRanges((from, end) => {
    if (from < to && end > pending.from
      || (from === end && from > pending.from && from < to)) targetChanged = true;
  });
  if (targetChanged) cancelPendingTableFocus(view);
  else pending.from = changes.mapPos(pending.from, 1);
}
