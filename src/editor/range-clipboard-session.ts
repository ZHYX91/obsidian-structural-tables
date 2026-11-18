import type { EditorView } from "@codemirror/view";
import { editorInfoField, Notice, Platform, type Editor, type TFile } from "obsidian";
import type { Translate } from "../config/i18n";
import type { StructuralTable } from "../core/model";
import { reparseUnchangedTable, type TableDocumentSnapshot } from "../core/table-snapshot";
import { tableRangePayload, type TableRangeClipboardPayloadV1 } from "../core/table-range-clipboard";
import { readTableRangeFromDataTransfer, readTableRangeFromNavigator, writeTableRangeToDataTransfer, writeTableRangeToNavigator } from "./table-range-clipboard";
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

interface GridClipboardActions {
  freeze(): FrozenGridSelection | null;
  current(selection: FrozenGridSelection): boolean;
  clear(selection: FrozenGridSelection): boolean;
  paste(selection: FrozenGridSelection, payload: TableRangeClipboardPayloadV1): boolean;
  notify(key: Parameters<Translate>[0]): void;
}

/** Only handle events from this grid. Text inputs and nested grids own their own clipboard. */
export function registerGridClipboard(host: HTMLElement, actions: GridClipboardActions): () => void {
  const handle = (event: ClipboardEvent): void => {
    const target = event.target;
    if (event.defaultPrevented || target === null || !("closest" in target)) return;
    const element = target as Element;
    if (element.closest(".structural-tables-live-preview") !== host || element.closest("textarea, input")) return;
    const data = event.clipboardData;
    if (data === null && event.type !== "paste") return;
    const frozen = actions.freeze();
    if (frozen === null) return;
    event.preventDefault();
    event.stopPropagation();

    if (event.type === "paste") {
      const result = data === null ? null : readTableRangeFromDataTransfer(data, host.ownerDocument);
      if (result?.kind !== "payload") actions.notify("notice.rangeClipboardUnsupported");
      else if (!actions.paste(frozen, result.payload)) actions.notify("notice.staleTable");
      return;
    }
    if (!actions.current(frozen)) actions.notify("notice.staleTable");
    else if (data === null || !writeTableRangeToDataTransfer(data, frozen.payload)) actions.notify("notice.rangeClipboardWriteFailed");
    else if (event.type === "cut" && !actions.clear(frozen)) actions.notify("notice.staleTable");
  };
  const names = ["copy", "cut", "paste"] as const;
  for (const name of names) host.addEventListener(name, handle);
  return () => { for (const name of names) host.removeEventListener(name, handle); };
}
