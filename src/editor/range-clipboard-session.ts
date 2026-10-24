import type { EditorView } from "@codemirror/view";
import { editorInfoField, Notice, Platform, type Editor, type TFile } from "obsidian";
import type { Translate } from "../config/i18n";
import type { StructuralTable } from "../core/model";
import { reparseUnchangedTable, type TableDocumentSnapshot } from "../core/table-snapshot";
import { tableRangePayload, type TableRangeClipboardPayloadV1 } from "../core/table-range-clipboard";
import { readTableRangeFromNavigator, writeTableRangeToNavigator } from "./table-range-clipboard";
import type { AxisSelection } from "./table-axis-drag";
import type { StructuralTableSelection, TableCellCoordinate } from "./table-selection";

interface GridSelectionOwner {
  table: StructuralTable;
  sourcePath: string;
  host: HTMLElement | null;
  selection: StructuralTableSelection | null;
  selectionAnchor: TableCellCoordinate | null;
  selectionHead: TableCellCoordinate | null;
  selectionEpoch: number;
  axisSelection: AxisSelection | null;
}

export interface FrozenGridSelection {
  sourcePath: string;
  from: number;
  source: string;
  doc: EditorView["state"]["doc"];
  editor: Editor | undefined;
  file: TFile | null | undefined;
  host: HTMLElement;
  epoch: number;
  selection: StructuralTableSelection;
  anchor: TableCellCoordinate;
  head: TableCellCoordinate;
  axisSelection?: AxisSelection;
  payload: TableRangeClipboardPayloadV1;
}

export function freezeGridSelection(view: EditorView, owner: GridSelectionOwner): FrozenGridSelection | null {
  const selection = owner.selection;
  const anchor = owner.selectionAnchor;
  const head = owner.selectionHead;
  const host = owner.host;
  if (selection === null || anchor === null || head === null || host === null || !host.isConnected) return null;
  const payload = tableRangePayload(owner.table, {
    minRow: selection.minRow,
    maxRow: selection.maxRow,
    minColumn: selection.minColumn,
    maxColumn: selection.maxColumn,
  });
  if (payload === null) return null;
  return {
    sourcePath: owner.sourcePath,
    from: owner.table.range.from,
    source: owner.table.source,
    doc: view.state.doc,
    editor: view.state.field(editorInfoField, false)?.editor,
    file: view.state.field(editorInfoField, false)?.file,
    host,
    epoch: owner.selectionEpoch,
    selection,
    anchor: { ...anchor },
    head: { ...head },
    ...(owner.axisSelection === null ? {} : { axisSelection: { ...owner.axisSelection } }),
    payload,
  };
}

export function currentFrozenTable(
  view: EditorView,
  frozen: FrozenGridSelection,
  host: HTMLElement | null,
  epoch: number,
  snapshot?: TableDocumentSnapshot,
): StructuralTable | null {
  const info = view.state.field(editorInfoField, false);
  if (host !== frozen.host || !frozen.host.isConnected || epoch !== frozen.epoch
    || view.state.doc !== frozen.doc || info?.editor !== frozen.editor || info?.file !== frozen.file
    || info?.file?.path !== frozen.sourcePath
    || view.state.doc.sliceString(frozen.from, frozen.from + frozen.source.length) !== frozen.source) return null;
  return reparseUnchangedTable(snapshot ?? view.state.doc.toString(), frozen.selection.table);
}

export function frozenSelectionBounds(frozen: FrozenGridSelection) {
  return {
    minRow: frozen.selection.minRow,
    maxRow: frozen.selection.maxRow,
    minColumn: frozen.selection.minColumn,
    maxColumn: frozen.selection.maxColumn,
  };
}

export async function copyFrozenRange(
  frozen: FrozenGridSelection, cut: boolean, clear: () => boolean, t: Translate,
): Promise<void> {
  const clipboard = frozen.host.ownerDocument.defaultView?.navigator.clipboard;
  if (!await writeTableRangeToNavigator(
    clipboard, frozen.payload, frozen.host.ownerDocument.defaultView,
    Platform.isMobileApp ? "verified-text" : "rich",
  )) {
    new Notice(t("notice.rangeClipboardWriteFailed"));
    return;
  }
  if (cut && !clear()) new Notice(t("notice.staleTable"));
}

export async function pasteFrozenRange(
  frozen: FrozenGridSelection, apply: (payload: TableRangeClipboardPayloadV1) => boolean, t: Translate,
): Promise<void> {
  const result = await readTableRangeFromNavigator(
    frozen.host.ownerDocument.defaultView?.navigator.clipboard,
    frozen.host.ownerDocument,
    Platform.isMobileApp ? "verified-text" : "rich",
  );
  if (result.kind === "unsupported") {
    new Notice(t("notice.rangeClipboardReadFailed"));
    return;
  }
  if (result.kind === "failed") {
    new Notice(t("notice.rangeClipboardUnsupported"));
    return;
  }
  if (!apply(result.payload)) new Notice(t("notice.staleTable"));
}
