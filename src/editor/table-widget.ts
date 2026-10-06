import type { BaseEditorInfo } from "../app/base-promotion-service";
import { EditorView, WidgetType } from "@codemirror/view";
import type { ChangeDesc } from "@codemirror/state";
import { App, Component, Menu, Notice, Scope, editorInfoField, type Editor } from "obsidian";

import { createTranslator, operationNotice, withCount } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { adjacentTableCell, tableCellInDirection, tableCoordinateInDirection, type TableGridDirection } from "../core/table-navigation";
import { mathPipeSuggestions } from "../core/table-cell-syntax";
import { tableWriteHistory, type TableHistoryTarget } from "./table-history";
import {
  appendTableRow,
  clearTableCells,
  editCellContent,
  editCellAndTransform,
  insertTableColumn,
  pasteTableRangeRaw,
  reorderTableAxis,
  type TableAxis,
} from "../core/operations";
import { TableAxisDrag, tableAxisBoundaries, type AxisSelection } from "./table-axis-drag";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { parseEditableTables } from "../core/parser";
import { sourcePrefix } from "../core/source-lines";
import {
  sameTableRangeTopology,
  tableRangePayload,
  type TableRangeClipboardPayloadV1,
} from "../core/table-range-clipboard";
import { renderStructuralTable } from "../rendering/table-renderer";
import { renderTableClipboard } from "../rendering/table-clipboard";
import { cellClipboardText, copyHtml } from "./table-interchange";
import {
  readTableRangeFromDataTransfer,
  readTableRangeFromNavigator,
  writeTableRangeToDataTransfer,
  writeTableRangeToNavigator,
} from "./table-range-clipboard";
import {
  addBasePromotionMenuItem,
  addSelectionMenuItems,
  hasSelectionMenuItems,
  type TableOperation,
  type TableOperationIntent,
} from "./table-menu";
import {
  completeStructuralTableSelectionCoordinates,
  structuralTableSelectionFromBounds,
  type StructuralTableSelection,
  type TableCellCoordinate,
} from "./table-selection";

import { retainCellDraft } from "./cell-draft-recovery";
import { tableCellSourceOffset } from "./table-source-binding";
import { structuralTableLogicalCursorSync, structuralTableSourceFocus } from "./table-source-focus";

const TOUCH_DOUBLE_TAP_MAX_MS = 600;
const CLEAR_SELECTION_EVENT = "structural-tables-clear-selection";
const interactions = new WeakMap<HTMLElement, StructuralTableInteraction>();
interface PendingCellFocus {
  from: number;
  source: string;
  sourcePath: string;
  coordinate: TableCellCoordinate;
  edit: boolean;
  axisSelection?: AxisSelection;
  selectionBounds?: { first: TableCellCoordinate; last: TableCellCoordinate };
  entryIntent?: CellEditEntryIntent;
}
const pendingCellFocus = new WeakMap<EditorView, PendingCellFocus>();
const activeCellEditors = new WeakMap<Document, HTMLTextAreaElement>();

type CellEditEntryIntent = "select-all" | { caretOffset: number };

interface FrozenGridSelection {
  sourcePath: string;
  from: number;
  source: string;
  host: HTMLElement;
  epoch: number;
  selection: StructuralTableSelection;
  anchor: TableCellCoordinate;
  head: TableCellCoordinate;
  axisSelection?: AxisSelection;
  payload: TableRangeClipboardPayloadV1;
}

function ownsCellEditorFocus(editor: HTMLTextAreaElement): boolean {
  return activeCellEditors.get(editor.ownerDocument) === editor;
}

function claimCellEditorFocus(editor: HTMLTextAreaElement): void {
  activeCellEditors.set(editor.ownerDocument, editor);
}

function releaseCellEditorFocus(editor: HTMLTextAreaElement): void {
  if (ownsCellEditorFocus(editor)) activeCellEditors.delete(editor.ownerDocument);
}

function focusNativeTable(view: EditorView, table: StructuralTable, coordinate: TableCellCoordinate): void {
  cancelPendingTableFocus(view);
  const row = table.rows[Math.min(coordinate.row, table.rows.length - 1)];
  const line = view.state.doc.line((row?.sourceLine ?? table.startLine) + 1);
  const anchor = Math.min(line.to, line.from + table.sourcePrefix.length + 1);
  // Native editing uses the source caret. Move it before focusing, otherwise
  // mobile keyboards reveal an unrelated old caret (often the document start).
  view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: "nearest" }) });
  view.focus();
}

function requestNativeFocus(view: EditorView, pending: PendingCellFocus): void {
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

function requestTableFocus(view: EditorView, pending: PendingCellFocus): void {
  pendingCellFocus.set(view, pending);
  queueMicrotask(() => {
    if (pendingCellFocus.get(view) !== pending) return;
    if (!view.dom.isConnected || view.state.field(editorInfoField, false)?.file?.path !== pending.sourcePath
      || view.state.doc.sliceString(pending.from, pending.from + pending.source.length) !== pending.source) {
      cancelPendingTableFocus(view);
      return;
    }
    for (const host of view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview")) {
      if (interactions.get(host)?.consumePendingFocus(view, pending)) return;
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

export function clearTableWidgetSelection(host: HTMLElement): void {
  const EventConstructor = host.ownerDocument.defaultView?.Event;
  if (EventConstructor !== undefined) host.dispatchEvent(new EventConstructor(CLEAR_SELECTION_EVENT));
}

function samePresentation(left: StructuralTablesSettings, right: StructuralTablesSettings): boolean {
  return left.density === right.density && left.layout === right.layout
    && left.appearance === right.appearance
    && left.zebraRows === right.zebraRows && left.language === right.language;
}

/** Immutable CodeMirror description; DOM-owned interactions retain drafts across source shifts. */
export class StructuralTableWidget extends WidgetType {
  constructor(
    private readonly app: App,
    private readonly table: StructuralTable,
    private readonly sourcePath: string,
    private readonly settings: StructuralTablesSettings,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote?: (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable) => void,
  ) { super(); }

  override eq(other: StructuralTableWidget): boolean {
    return this.table.source === other.table.source
      && this.table.range.from === other.table.range.from && this.table.range.to === other.table.range.to
      && this.table.sourceTableIndex === other.table.sourceTableIndex
      && this.sourcePath === other.sourcePath && samePresentation(this.settings, other.settings)
      && this.promote === other.promote;
  }

  override toDOM(view: EditorView): HTMLElement {
    const interaction = new StructuralTableInteraction(
      this.app, this.table, this.sourcePath, this.settings, this.getSettings, this.promote,
    );
    const host = interaction.mount(view);
    interactions.set(host, interaction);
    return host;
  }

  override updateDOM(host: HTMLElement): boolean {
    return interactions.get(host)?.rebind(this.table, this.sourcePath, this.settings) ?? false;
  }

  override destroy(host: HTMLElement): void {
    interactions.get(host)?.destroy();
    interactions.delete(host);
  }

  override ignoreEvent(): boolean { return true; }
}

class StructuralTableInteraction {
  private positionHandles: (() => void) | null = null;
  private preserveDraft: (() => void) | null = null;
  private cellScope: Scope | null = null;
  private navigationScope: Scope | null = null;
  private component: Component | null = null;
  private clickEditCandidate: { coordinate: TableCellCoordinate; caretOffset: number | null } | null = null;
  private dragging = false;
  private renderedTable: HTMLTableElement | null = null;
  private selection: StructuralTableSelection | null = null;
  private selectionAnchor: TableCellCoordinate | null = null;
  private selectionHead: TableCellCoordinate | null = null;
  private touchRangeAnchor: TableCellCoordinate | null = null;
  private lastTouchTap: { coordinate: TableCellCoordinate; at: number } | null = null;
  private pointerWindow: Window | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private host: HTMLElement | null = null;
  private finishActiveOperation: ((operation: TableOperation, next: TableCellCoordinate) => void) | null = null;
  private axisSelection: AxisSelection | null = null;
  private axisAnchor = 0;
  private touchAxisAnchor: { axis: TableAxis; index: number } | null = null;
  private axisDrag: TableAxisDrag | null = null;
  private selectionMenuOpen = false;
  private selectionMenuSession: FrozenGridSelection | null = null;
  private selectionEpoch = 0;

  constructor(
    private readonly app: App,
    private table: StructuralTable,
    private readonly sourcePath: string,
    private readonly settings: StructuralTablesSettings,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote?: (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable) => void,
  ) {}

  rebind(table: StructuralTable, sourcePath: string, settings: StructuralTablesSettings): boolean {
    if (this.table.source !== table.source || this.sourcePath !== sourcePath
      || !samePresentation(this.settings, settings)) return false;
    const sameSourceIdentity = this.table.range.from === table.range.from
      && this.table.range.to === table.range.to
      && this.table.sourceTableIndex === table.sourceTableIndex;
    this.table = table;
    if (this.host !== null) this.host.dataset.structuralSourceTableIndex = String(table.sourceTableIndex);
    this.updateSelection(!sameSourceIdentity);
    return true;
  }

  mount(view: EditorView): HTMLElement {
    this.component = new Component();
    this.component.load();
    const host = view.dom.ownerDocument.adoptNode(createEl("div"));
    host.className = "structural-tables-live-preview";
    host.dataset.layout = this.settings.layout;
    host.dataset.appearance = this.settings.appearance;
    host.dataset.density = this.settings.density;
    host.dataset.zebra = String(this.settings.zebraRows);
    host.dataset.tableKind = this.table.structural ? "structural" : "ordinary";
    host.dataset.structuralSourceTableIndex = String(this.table.sourceTableIndex);
    this.host = host;
    const rendered = renderStructuralTable(this.app, this.table, host, this.sourcePath, this.component);
    this.installInteraction(view, host, rendered);
    host.addEventListener(CLEAR_SELECTION_EVENT, () => this.clearSelection());
    host.addEventListener("focusin", () => host.classList.add("is-add-controls-active"));
    this.component.registerDomEvent(host.ownerDocument, "pointerdown", (event) => {
      const target = event.target;
      if (target instanceof host.ownerDocument.defaultView!.Node && !host.contains(target)) {
        // A DOM menu item is outside the table too. Its public onClick may
        // consume this session before onHide settles; a dismissed menu cannot.
        this.clearSelection(!this.selectionMenuOpen);
      }
    }, { capture: true });
    host.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next === null || !(next instanceof host.ownerDocument.defaultView!.Node) || !host.contains(next)) {
        this.clearSelection(!this.selectionMenuOpen);
      }
    });
    queueMicrotask(() => {
      const pending = pendingCellFocus.get(view);
      if (pending !== undefined) this.consumePendingFocus(view, pending);
    });
    return host;
  }

  consumePendingFocus(view: EditorView, pending: PendingCellFocus): boolean {
    const host = this.host;
    if (host === null || !host.isConnected || pendingCellFocus.get(view) !== pending
      || pending.from !== this.table.range.from || pending.source !== this.table.source
      || pending.sourcePath !== this.sourcePath
      || view.state.field(editorInfoField, false)?.file?.path !== pending.sourcePath
      || view.state.doc.sliceString(pending.from, pending.from + pending.source.length) !== pending.source) return false;
    pendingCellFocus.delete(view);
    if (pending.axisSelection !== undefined) this.focusAxis(pending.axisSelection);
    else if (pending.edit) {
      this.beginCellEdit(view, pending.coordinate, pending.entryIntent ?? "select-all");
      this.cellElement(pending.coordinate)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    } else {
      const cell = this.cellElement(pending.coordinate);
      if (cell === null) return true;
      const bounds = pending.selectionBounds;
      this.selectBounds(bounds?.first ?? pending.coordinate, bounds?.last ?? pending.coordinate);
      this.syncSourceCursor(view, pending.coordinate);
      if (host.isConnected && this.host === host) cell.focus({ preventScroll: true });
    }
    return true;
  }

  destroy(): void {
    this.preserveDraft?.();
    this.preserveDraft = null;
    this.axisDrag?.destroy();
    this.axisDrag = null;
    this.finishActiveOperation = null;
    this.releaseCellScope();
    this.releaseNavigationScope();
    this.pointerWindow?.removeEventListener("pointerup", this.endPointerSelection);
    this.pointerWindow?.removeEventListener("pointercancel", this.endPointerSelection);
    this.pointerWindow = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.positionHandles = null;
    this.selectionMenuOpen = false;
    this.selectionMenuSession = null;
    this.host = null;
    this.renderedTable = null;
    this.clickEditCandidate = null;
    this.lastTouchTap = null;
    this.component?.unload();
    this.component = null;
  }

  private installInteraction(view: EditorView, host: HTMLElement, rendered: HTMLTableElement): void {
    this.renderedTable = rendered;
    rendered.classList.add("is-interactive");
    const cells = Array.from(rendered.querySelectorAll<HTMLElement>(
      "[data-structural-row][data-structural-column]",
    ));
    cells.forEach((cell, index) => { cell.tabIndex = index === 0 ? 0 : -1; });
    rendered.addEventListener("focusin", (event) => {
      const cell = this.cellForTarget(event.target);
      if (cell !== null) this.setRovingCell(cell);
      if (cell === null || event.target !== cell) return;
      const coordinate = this.coordinateFor(cell);
      if (coordinate !== null) this.syncSourceCursor(view, coordinate);
      this.releaseNavigationScope();
      const scope = new Scope(this.app.scope);
      scope.register([], "F2", (keyEvent) => {
        const active = rendered.ownerDocument.activeElement;
        const coordinate = this.coordinateFor(active);
        if (coordinate === null || active !== this.cellForTarget(active)) return;
        keyEvent.preventDefault();
        this.beginCellEdit(view, coordinate);
        return false;
      });
      this.registerGridClearScope(scope, view);
      this.navigationScope = scope;
      this.app.keymap.pushScope(scope);
    });
    rendered.addEventListener("focusout", () => this.releaseNavigationScope());
    rendered.addEventListener("pointerdown", (event) => this.startPointerSelection(event, view));
    rendered.addEventListener("pointerover", (event) => this.extendPointerSelection(event));
    rendered.addEventListener("pointermove", (event) => this.revealHandlesForPointer(event));
    rendered.addEventListener("click", (event) => this.openCellOnDesktopClick(event, view));
    rendered.addEventListener("copy", (event) => { this.handleRangeCopyCut(event, view, false); });
    rendered.addEventListener("cut", (event) => { this.handleRangeCopyCut(event, view, true); });
    rendered.addEventListener("paste", (event) => { this.handleRangePaste(event, view); });
    rendered.addEventListener("contextmenu", (event) => this.openContextMenu(event, view));
    rendered.addEventListener("dblclick", (event) => {
      if (event.target !== null && "closest" in event.target
        && (event.target as Element).closest("textarea, input, a, button") !== null) return;
      const coordinate = this.coordinateFor(event.target);
      if (coordinate === null) return;
      event.preventDefault();
      event.stopPropagation();
      this.beginCellEdit(view, coordinate);
    });
    rendered.addEventListener("keydown", (event) => {
      if (event.target !== this.cellForTarget(event.target)) return;
      if (this.handleGridClear(event, view)) return;
      if (this.handleHistory(event, view)) return;
      if (this.moveCellFocus(event, view)) return;
      if (event.key !== "Enter" && event.key !== "F2") return;
      const coordinate = this.coordinateFor(event.target);
      if (coordinate === null) return;
      event.preventDefault();
      event.stopPropagation();
      this.beginCellEdit(view, coordinate);
    });
    this.installHandles(view, host, rendered);
    this.pointerWindow = rendered.ownerDocument.defaultView;
    this.pointerWindow?.addEventListener("pointerup", this.endPointerSelection);
    this.pointerWindow?.addEventListener("pointercancel", this.endPointerSelection);
  }

  private readonly endPointerSelection = (): void => {
    this.dragging = false;
  };

  private registerGridClearScope(scope: Scope, view: EditorView): void {
    const handler = (event: KeyboardEvent): boolean | void => {
      if (this.handleGridClear(event, view)) return false;
    };
    scope.register([], "Delete", handler);
    scope.register([], "Backspace", handler);
  }

  private activateAxisClearScope(
    view: EditorView,
    handle: HTMLElement,
    axis: TableAxis,
    index: number,
  ): void {
    const selection = this.axisSelection;
    if (selection?.axis !== axis || index < selection.start || index > selection.end
      || handle.ownerDocument.activeElement !== handle) return;
    this.releaseNavigationScope();
    const scope = new Scope(this.app.scope);
    this.registerGridClearScope(scope, view);
    this.navigationScope = scope;
    this.app.keymap.pushScope(scope);
  }

  private handleGridClear(event: KeyboardEvent, view: EditorView): boolean {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || (event.key !== "Delete" && event.key !== "Backspace")
      || this.host === null || !this.host.isConnected) return false;
    const hostWindow = this.host.ownerDocument.defaultView;
    if (event.view !== null && event.view !== hostWindow) return false;
    if (this.selectionMenuOpen) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    if (event.isComposing) return false;
    const active = this.host.ownerDocument.activeElement;
    if (!(active instanceof this.host.ownerDocument.defaultView!.HTMLElement)
      || !this.host.contains(active)
      || active.matches("textarea, input")) return false;

    const cell = this.cellForTarget(active);
    let ownsSelection = false;
    if (cell !== null && active === cell) {
      const coordinate = this.coordinateFor(cell);
      if (coordinate === null) return false;
      if (this.selection === null || !this.isCellSelected(coordinate)) {
        this.selectBounds(coordinate, coordinate);
      }
      ownsSelection = true;
    } else {
      const rowHandle = active.closest<HTMLElement>("[data-structural-row-handle]");
      const columnHandle = active.closest<HTMLElement>("[data-structural-column-handle]");
      const selection = this.axisSelection;
      if (rowHandle === active && selection?.axis === "row") {
        const index = Number(rowHandle.dataset.structuralRowHandle);
        ownsSelection = Number.isInteger(index) && index >= selection.start && index <= selection.end;
      } else if (columnHandle === active && selection?.axis === "column") {
        const index = Number(columnHandle.dataset.structuralColumnHandle);
        ownsSelection = Number.isInteger(index) && index >= selection.start && index <= selection.end;
      }
    }
    if (!ownsSelection || this.selection === null) return false;

    event.preventDefault();
    event.stopPropagation();
    const coordinates = completeStructuralTableSelectionCoordinates(this.selection);
    this.applyMenuOperation(
      view,
      (current) => clearTableCells(current, coordinates),
      undefined,
      this.axisSelection ?? undefined,
      "owned-grid",
    );
    return true;
  }

  private handleHistory(event: KeyboardEvent, view: EditorView,
    coordinate = this.coordinateFor(event.target)): boolean {
    if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return false;
    const key = event.key.toLowerCase();
    const redo = (key === "z" && event.shiftKey) || (key === "y" && event.ctrlKey && !event.shiftKey);
    if (!redo && (key !== "z" || event.shiftKey)) return false;
    const editor = view.state.field(editorInfoField, false)?.editor;
    if (editor === undefined) return false;
    if (coordinate === null) return false;
    event.preventDefault();
    event.stopPropagation();
    const from = this.table.range.from;
    const sourcePath = this.sourcePath;
    const previousPending = pendingCellFocus.get(view);
    const nativeCallout = this.host?.closest(".callout") != null;
    if (redo) editor.redo();
    else editor.undo();
    // Annotated history already owns the exact restored table or native caret.
    // A generic continuation must not override it after a widget is rebound.
    const pending = pendingCellFocus.get(view);
    if (pending !== undefined && pending !== previousPending) return true;
    if (view.state.field(editorInfoField, false)?.file?.path !== sourcePath) return true;
    const table = parseEditableTables(view.state.doc.toString()).tables.find((candidate) => candidate.range.from === from);
    if (nativeCallout) {
      if (table !== undefined) this.restoreCalloutFocus(view, table.source, coordinate, false, true, from);
    } else if (table !== undefined) {
      requestTableFocus(view, { from, source: table.source, sourcePath, coordinate, edit: false });
    } else {
      requestNativeFocus(view, { from: view.state.selection.main.anchor, source: "", sourcePath, coordinate, edit: false });
    }
    return true;
  }

  private restoreCalloutFocus(view: EditorView, source: string, coordinate: TableCellCoordinate,
    edit: boolean, reveal = false, from = this.table.range.from): void {
    if (view.state.field(editorInfoField, false)?.file?.path !== this.sourcePath) return;
    const table = parseEditableTables(view.state.doc.toString()).tables.find((candidate) =>
      candidate.range.from === from && candidate.source === source);
    if (table === undefined || !table.valid) {
      cancelPendingTableFocus(view);
      return;
    }
    if (!table.structural && !this.getSettings().takeOverOrdinaryTables) {
      focusNativeTable(view, table, coordinate);
      return;
    }
    pendingCellFocus.set(view, {
      from: table.range.from, source, sourcePath: this.sourcePath, coordinate, edit,
    });
    // Host history requests scrolling to its source caret, which may be far
    // outside this Callout. Keep the restored table in the mounted viewport.
    if (reveal) view.dispatch({ effects: EditorView.scrollIntoView(table.range.from, { y: "nearest" }) });
  }

  private coordinateFor(target: EventTarget | null): TableCellCoordinate | null {
    const cell = this.cellForTarget(target);
    if (cell === null) return null;
    const row = Number(cell.dataset.structuralRow);
    const column = Number(cell.dataset.structuralColumn);
    return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
  }

  private syncSourceCursor(view: EditorView, coordinate: TableCellCoordinate): void {
    // Native Callouts own a separate block widget and focus-restoration contract.
    // Keep their visual interactions local; explicit source handoff still maps
    // the requested cell through focusTableSource().
    if (this.host?.closest(".callout") !== null) return;
    const offset = tableCellSourceOffset(view.state.doc.toString(), this.table, coordinate);
    if (offset === null) return;
    const sameSelection = view.state.selection.main.empty && view.state.selection.main.anchor === offset;
    view.dispatch({
      ...(sameSelection ? {} : { selection: { anchor: offset } }),
      effects: [
        structuralTableSourceFocus.of(false),
        structuralTableLogicalCursorSync.of(undefined),
      ],
    });
  }

  private focusTableSource(view: EditorView, coordinate: TableCellCoordinate): void {
    const table = this.table;
    const sourcePath = this.sourcePath;
    const offset = tableCellSourceOffset(view.state.doc.toString(), table, coordinate);
    if (offset === null) {
      new Notice(createTranslator(this.getSettings().language)("notice.staleTable"));
      return;
    }
    cancelPendingTableFocus(view);
    this.clearSelection();

    // Handoff is deliberately two-phase. First release presentation ownership
    // so CodeMirror can materialize the raw source without simultaneously
    // changing the browser DOM selection. Native focus/selection follows in
    // the next task, outside the current CodeMirror update.
    view.dispatch({ effects: structuralTableSourceFocus.of(true) });
    queueMicrotask(() => {
      if (!view.dom.isConnected || view.state.field(editorInfoField, false)?.file?.path !== sourcePath) return;
      const current = reparseUnchangedTable(view.state.doc.toString(), table);
      if (current === null) return;
      const currentOffset = tableCellSourceOffset(view.state.doc.toString(), current, coordinate);
      if (currentOffset === null) return;
      const sameSelection = view.state.selection.main.empty
        && view.state.selection.main.anchor === currentOffset;
      view.dispatch({
        ...(sameSelection ? {} : { selection: { anchor: currentOffset } }),
        effects: EditorView.scrollIntoView(currentOffset, { y: "nearest" }),
      });
      view.focus();
    });
  }

  private cellForTarget(target: EventTarget | null): HTMLElement | null {
    if (target === null || !("closest" in target) || this.renderedTable === null) return null;
    const cell = (target as Element).closest<HTMLElement>("[data-structural-row][data-structural-column]");
    return cell !== null && this.renderedTable.contains(cell) ? cell : null;
  }

  private setRovingCell(active: HTMLElement): void {
    if (this.renderedTable === null) return;
    for (const cell of this.renderedTable.querySelectorAll<HTMLElement>(
      "[data-structural-row][data-structural-column]",
    )) {
      cell.tabIndex = cell === active ? 0 : -1;
    }
  }

  private moveCellFocus(event: KeyboardEvent, view: EditorView): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target !== this.cellForTarget(event.target)) return false;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null) return false;
    const rtl = this.renderedTable?.ownerDocument.defaultView?.getComputedStyle(this.renderedTable).direction === "rtl";
    const directionByKey = new Map<string, TableGridDirection>([
      ["ArrowUp", "up"],
      ["ArrowDown", "down"],
      [rtl ? "ArrowRight" : "ArrowLeft", "left"],
      [rtl ? "ArrowLeft" : "ArrowRight", "right"],
    ]);
    const direction = directionByKey.get(event.key);

    if (event.shiftKey) {
      if (direction === undefined) return false;
      event.preventDefault();
      event.stopPropagation();
      const logicalHead = this.selectionHead ?? coordinate;
      const target = tableCoordinateInDirection(this.table, logicalHead, direction);
      if (target === null) return true;
      if (this.selectionAnchor === null) this.selectionAnchor = coordinate;
      this.selectionHead = target;
      this.updateSelection();
      const element = this.cellElement(target);
      if (element !== null) {
        this.syncSourceCursor(view, target);
        this.setRovingCell(element);
        element.focus({ preventScroll: true });
        element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      }
      return true;
    }

    let target: TableCellCoordinate | null = null;
    if (direction !== undefined) {
      target = tableCellInDirection(this.table, coordinate, direction);
    } else if (event.key === "Home") {
      target = { row: coordinate.row, column: 0 };
    } else if (event.key === "End") {
      target = { row: coordinate.row, column: this.table.columnCount - 1 };
    } else {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    if (target === null) return true;
    const element = this.cellElement(target);
    if (element === null) return true;
    const resolved = this.coordinateFor(element);
    if (resolved !== null) {
      this.selectBounds(resolved, resolved);
      this.syncSourceCursor(view, resolved);
    }
    this.setRovingCell(element);
    element.focus({ preventScroll: true });
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return true;
  }

  private startPointerSelection(event: PointerEvent, view: EditorView): void {
    this.clickEditCandidate = null;
    if (!event.isPrimary || event.button !== 0) return;
    if (event.target !== null && "closest" in event.target
      && (event.target as Element).closest("textarea, input, a") !== null) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null) return;
    this.syncSourceCursor(view, coordinate);
    this.axisSelection = null;
    this.touchAxisAnchor = null;
    if (event.pointerType === "touch") {
      const previous = this.lastTouchTap;
      this.lastTouchTap = { coordinate, at: event.timeStamp };
      if (previous !== null
        && previous.coordinate.row === coordinate.row
        && previous.coordinate.column === coordinate.column
        && event.timeStamp >= previous.at
        && event.timeStamp - previous.at <= TOUCH_DOUBLE_TAP_MAX_MS) {
        this.lastTouchTap = null;
        this.touchRangeAnchor = null;
        event.preventDefault();
        event.stopPropagation();
        this.beginCellEdit(view, coordinate);
        return;
      }
      this.startTouchSelection(coordinate);
      const cell = this.cellElement(coordinate);
      cell?.focus({ preventScroll: true });
      return;
    }
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.clickEditCandidate = {
        coordinate,
        caretOffset: this.plainTextCaretOffset(event, coordinate),
      };
    }
    event.preventDefault();
    event.stopPropagation();
    this.touchRangeAnchor = null;
    if (!event.shiftKey || this.selectionAnchor === null) this.selectionAnchor = coordinate;
    this.selectionHead = coordinate;
    this.dragging = true;
    this.updateSelection();
    const cell = this.cellElement(coordinate);
    cell?.focus({ preventScroll: true });
  }

  private startTouchSelection(coordinate: TableCellCoordinate): void {
    // A completed range remains actionable by long press; tapping outside starts another range.
    if (this.touchRangeAnchor === null && (this.selection?.cells.length ?? 0) > 1
      && this.isCellSelected(coordinate)) return;
    if (this.touchRangeAnchor === null) {
      this.touchRangeAnchor = coordinate;
      this.selectionAnchor = coordinate;
      this.selectionHead = coordinate;
    } else {
      this.selectionAnchor = this.touchRangeAnchor;
      this.selectionHead = coordinate;
      this.touchRangeAnchor = null;
      // The range-ending tap is not the first tap of an edit gesture.
      this.lastTouchTap = null;
    }
    this.dragging = false;
    this.updateSelection();
  }

  private isCellSelected(coordinate: TableCellCoordinate): boolean {
    return this.selection?.cells.some((cell) => (
      cell.anchorRow === coordinate.row && cell.anchorColumn === coordinate.column
    )) ?? false;
  }

  private extendPointerSelection(event: PointerEvent): void {
    if (!this.dragging) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null || (coordinate.row === this.selectionHead?.row && coordinate.column === this.selectionHead.column)) return;
    event.preventDefault();
    this.clickEditCandidate = null;
    this.selectionHead = coordinate;
    this.updateSelection();
  }

  private openCellOnDesktopClick(event: MouseEvent, view: EditorView): void {
    const candidate = this.clickEditCandidate;
    this.clickEditCandidate = null;
    if (candidate === null || (event.target !== null && "closest" in event.target
      && (event.target as Element).closest("textarea, input, a, button") !== null)) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null
      || coordinate.row !== candidate.coordinate.row || coordinate.column !== candidate.coordinate.column) return;
    event.preventDefault();
    event.stopPropagation();
    this.beginCellEdit(
      view,
      coordinate,
      candidate.caretOffset === null ? "select-all" : { caretOffset: candidate.caretOffset },
    );
  }

  private updateSelection(invalidateSession = true): void {
    if (invalidateSession) this.selectionEpoch += 1;
    const anchor = this.selectionAnchor;
    const head = this.selectionHead;
    if (anchor === null || head === null || this.renderedTable === null) return;
    this.selection = structuralTableSelectionFromBounds(this.table, anchor, head);
    const selectedAnchors = new Set(this.selection?.cells.map((cell) => `${cell.anchorRow}:${cell.anchorColumn}`) ?? []);
    this.host?.classList.toggle("is-add-controls-active", selectedAnchors.size > 0);
    for (const element of this.renderedTable.querySelectorAll<HTMLElement>("[data-structural-row][data-structural-column]")) {
      const row = Number(element.dataset.structuralRow);
      const column = Number(element.dataset.structuralColumn);
      const selected = selectedAnchors.has(`${row}:${column}`);
      element.classList.toggle("is-selected", selected);
      element.setAttribute("aria-selected", String(selected));
    }
    for (const handle of this.host?.querySelectorAll<HTMLElement>("[data-structural-row-handle]") ?? []) {
      const row = Number(handle.dataset.structuralRowHandle);
      handle.classList.toggle("is-selected", this.selection !== null
        && this.selection.minColumn === 0
        && this.selection.maxColumn === this.table.columnCount - 1
        && this.selection.minRow <= row && this.selection.maxRow >= row);
    }
    for (const handle of this.host?.querySelectorAll<HTMLElement>("[data-structural-column-handle]") ?? []) {
      const column = Number(handle.dataset.structuralColumnHandle);
      handle.classList.toggle("is-selected", this.selection !== null
        && this.selection.minRow === 0
        && this.selection.maxRow === this.table.rows.length - 1
        && this.selection.minColumn <= column && this.selection.maxColumn >= column);
    }
  }

  private clearSelection(invalidateSession = true): void {
    if (invalidateSession) this.selectionEpoch += 1;
    this.host?.classList.remove("is-add-controls-active");
    this.axisSelection = null;
    this.touchAxisAnchor = null;
    this.selection = null;
    this.selectionAnchor = null;
    this.selectionHead = null;
    this.touchRangeAnchor = null;
    this.clickEditCandidate = null;
    this.dragging = false;
    this.lastTouchTap = null;
    for (const element of this.renderedTable?.querySelectorAll<HTMLElement>(
      "[data-structural-row][data-structural-column]",
    ) ?? []) {
      element.classList.remove("is-selected");
      element.setAttribute("aria-selected", "false");
    }
    for (const handle of this.host?.querySelectorAll<HTMLElement>(
      ".structural-tables-row-handle.is-selected, .structural-tables-column-handle.is-selected",
    ) ?? []) {
      handle.classList.remove("is-selected");
    }
  }

  private freezeGridSelection(): FrozenGridSelection | null {
    const selection = this.selection;
    const anchor = this.selectionAnchor;
    const head = this.selectionHead;
    const host = this.host;
    if (selection === null || anchor === null || head === null || host === null || !host.isConnected) return null;
    const payload = tableRangePayload(this.table, {
      minRow: selection.minRow,
      maxRow: selection.maxRow,
      minColumn: selection.minColumn,
      maxColumn: selection.maxColumn,
    });
    if (payload === null) return null;
    return {
      sourcePath: this.sourcePath,
      from: this.table.range.from,
      source: this.table.source,
      host,
      epoch: this.selectionEpoch,
      selection,
      anchor: { ...anchor },
      head: { ...head },
      ...(this.axisSelection === null ? {} : { axisSelection: { ...this.axisSelection } }),
      payload,
    };
  }

  private currentTableForFrozenSelection(
    view: EditorView,
    frozen: FrozenGridSelection,
  ): StructuralTable | null {
    if (this.host !== frozen.host || !frozen.host.isConnected || this.selectionEpoch !== frozen.epoch
      || view.state.field(editorInfoField, false)?.file?.path !== frozen.sourcePath
      || view.state.doc.sliceString(frozen.from, frozen.from + frozen.source.length) !== frozen.source) return null;
    return reparseUnchangedTable(view.state.doc.toString(), frozen.selection.table);
  }

  private frozenBounds(frozen: FrozenGridSelection) {
    return {
      minRow: frozen.selection.minRow,
      maxRow: frozen.selection.maxRow,
      minColumn: frozen.selection.minColumn,
      maxColumn: frozen.selection.maxColumn,
    };
  }

  private clearFrozenSelection(view: EditorView, frozen: FrozenGridSelection): boolean {
    if (this.currentTableForFrozenSelection(view, frozen) === null) return false;
    const coordinates = completeStructuralTableSelectionCoordinates(frozen.selection);
    this.applyMenuOperation(
      view,
      (current) => clearTableCells(current, coordinates),
      undefined,
      frozen.axisSelection,
      "owned-grid",
      frozen,
    );
    return true;
  }

  private pasteFrozenSelection(
    view: EditorView,
    frozen: FrozenGridSelection,
    payload: TableRangeClipboardPayloadV1,
  ): boolean {
    const current = this.currentTableForFrozenSelection(view, frozen);
    if (current === null) return false;
    const target = tableRangePayload(current, this.frozenBounds(frozen));
    if (target === null || !sameTableRangeTopology(target, payload)) {
      new Notice(createTranslator(this.getSettings().language)("notice.rangeClipboardUnsupported"));
      return true;
    }
    this.applyMenuOperation(
      view,
      (table) => pasteTableRangeRaw(table, this.frozenBounds(frozen), payload),
      undefined,
      frozen.axisSelection,
      "owned-grid",
      frozen,
    );
    return true;
  }

  private handleRangeCopyCut(
    event: ClipboardEvent,
    view: EditorView,
    cut: boolean,
  ): boolean {
    if (event.target !== null && "closest" in event.target
      && (event.target as Element).closest("textarea, input") !== null) return false;
    const frozen = this.freezeGridSelection();
    if (frozen === null || event.clipboardData === null) return false;
    event.preventDefault();
    event.stopPropagation();
    if (!writeTableRangeToDataTransfer(event.clipboardData, frozen.payload)) {
      new Notice(createTranslator(this.getSettings().language)("notice.rangeClipboardWriteFailed"));
      return true;
    }
    if (cut && !this.clearFrozenSelection(view, frozen)) {
      new Notice(createTranslator(this.getSettings().language)("notice.staleTable"));
    }
    return true;
  }

  private handleRangePaste(event: ClipboardEvent, view: EditorView): boolean {
    if (event.target !== null && "closest" in event.target
      && (event.target as Element).closest("textarea, input") !== null) return false;
    const frozen = this.freezeGridSelection();
    if (frozen === null) return false;
    event.preventDefault();
    event.stopPropagation();
    const payload = event.clipboardData === null ? null
      : readTableRangeFromDataTransfer(event.clipboardData, frozen.host.ownerDocument);
    if (payload === null) {
      new Notice(createTranslator(this.getSettings().language)("notice.rangeClipboardUnsupported"));
      return true;
    }
    if (!this.pasteFrozenSelection(view, frozen, payload)) {
      new Notice(createTranslator(this.getSettings().language)("notice.staleTable"));
    }
    return true;
  }

  private async copyFrozenSelection(
    view: EditorView,
    frozen: FrozenGridSelection,
    cut: boolean,
  ): Promise<void> {
    const t = createTranslator(this.getSettings().language);
    const clipboard = frozen.host.ownerDocument.defaultView?.navigator.clipboard;
    if (!await writeTableRangeToNavigator(clipboard, frozen.payload, frozen.host.ownerDocument.defaultView)) {
      new Notice(t("notice.rangeClipboardWriteFailed"));
      return;
    }
    if (cut && !this.clearFrozenSelection(view, frozen)) new Notice(t("notice.staleTable"));
  }

  private async pasteFrozenSelectionFromNavigator(
    view: EditorView,
    frozen: FrozenGridSelection,
  ): Promise<void> {
    const t = createTranslator(this.getSettings().language);
    const result = await readTableRangeFromNavigator(
      frozen.host.ownerDocument.defaultView?.navigator.clipboard,
      frozen.host.ownerDocument,
    );
    if (result.kind === "unsupported") {
      new Notice(t("notice.rangeClipboardReadFailed"));
      return;
    }
    if (result.kind === "failed") {
      new Notice(t("notice.rangeClipboardUnsupported"));
      return;
    }
    if (!this.pasteFrozenSelection(view, frozen, result.payload)) new Notice(t("notice.staleTable"));
  }

  private revealHandlesForPointer(event: PointerEvent): void {
    if (event.pointerType === "touch" || this.host === null) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null) return;
    const cell = this.table.rows[coordinate.row]?.cells[coordinate.column];
    const element = cell === undefined ? null : this.cellElement(cell);
    if (cell === undefined || element === null) return;
    const rect = element.getBoundingClientRect();
    const rowOffset = rect.height <= 0
      ? 0
      : Math.min(cell.rowSpan - 1, Math.max(0, Math.floor((event.clientY - rect.top) / rect.height * cell.rowSpan)));
    const rtl = element.ownerDocument.defaultView?.getComputedStyle(this.renderedTable!).direction === "rtl";
    const inlinePosition = rtl ? rect.right - event.clientX : event.clientX - rect.left;
    const columnOffset = rect.width <= 0
      ? 0
      : Math.min(cell.columnSpan - 1, Math.max(0, Math.floor(inlinePosition / rect.width * cell.columnSpan)));
    const row = cell.row + rowOffset;
    const column = cell.column + columnOffset;
    for (const handle of this.host.querySelectorAll<HTMLElement>(".structural-tables-row-handle")) {
      handle.classList.toggle("is-revealed", Number(handle.dataset.structuralRowHandle) === row);
    }
    for (const handle of this.host.querySelectorAll<HTMLElement>(".structural-tables-column-handle")) {
      handle.classList.toggle("is-revealed", Number(handle.dataset.structuralColumnHandle) === column);
    }
  }

  private clearRevealedHandles(): void {
    for (const handle of this.host?.querySelectorAll<HTMLElement>(
      ".structural-tables-row-handle.is-revealed, .structural-tables-column-handle.is-revealed",
    ) ?? []) handle.classList.remove("is-revealed");
  }

  private openContextMenu(event: MouseEvent, view: EditorView): void {
    if (event.target !== null && "closest" in event.target
      && (event.target as Element).closest("textarea.structural-tables-cell-editor") !== null) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null) return;
    this.syncSourceCursor(view, coordinate);
    event.preventDefault();
    event.stopPropagation();
    this.touchRangeAnchor = null;
    this.lastTouchTap = null;
    if (!this.isCellSelected(coordinate)) {
      this.selectionAnchor = coordinate;
      this.selectionHead = coordinate;
      this.updateSelection();
    }
    this.showSelectionMenu(event, view);
  }

  private showSelectionMenu(event: MouseEvent, view: EditorView): void {
    const frozen = this.freezeGridSelection();
    if (frozen === null) return;
    const selection = frozen.selection;
    const menu = Menu.forEvent(event);
    this.selectionMenuSession = frozen;
    this.selectionMenuOpen = true;
    menu.onHide(() => {
      if (this.selectionMenuSession !== frozen) return;
      this.selectionMenuOpen = false;
      queueMicrotask(() => {
        if (this.selectionMenuSession !== frozen) return;
        this.selectionMenuSession = null;
        this.clearSelection();
      });
    });
    const t = createTranslator(this.getSettings().language);
    const activate = (action: () => void): void => {
      if (this.selectionMenuSession !== frozen) {
        new Notice(t("notice.staleTable"));
        return;
      }
      this.selectionMenuSession = null;
      this.selectionMenuOpen = false;
      if (this.currentTableForFrozenSelection(view, frozen) === null) {
        new Notice(t("notice.staleTable"));
        return;
      }
      action();
    };
    const info = view.state.field(editorInfoField, false);
    const sourceCoordinate = frozen.anchor;
    menu.addItem((item) => item
      .setSection("structural-tables-source")
      .setTitle(t("menu.editSource"))
      .setIcon("file-pen-line")
      .onClick(() => activate(() => this.focusTableSource(view, sourceCoordinate))));
    menu.addItem((item) => item
      .setSection("structural-tables-clipboard")
      .setIcon("copy")
      .setTitle(t("menu.copySelection"))
      .onClick(() => activate(() => { void this.copyFrozenSelection(view, frozen, false); })));
    menu.addItem((item) => item
      .setSection("structural-tables-clipboard")
      .setIcon("scissors")
      .setTitle(t("menu.cutSelection"))
      .onClick(() => activate(() => { void this.copyFrozenSelection(view, frozen, true); })));
    menu.addItem((item) => item
      .setSection("structural-tables-clipboard")
      .setIcon("clipboard-paste")
      .setTitle(t("menu.pasteSelection"))
      .onClick(() => activate(() => { void this.pasteFrozenSelectionFromNavigator(view, frozen); })));
    menu.addItem((item) => item.setTitle(t("menu.copyWholeHtml")).setIcon("copy").onClick(() => activate(() => {
      const current = reparseUnchangedTable(view.state.doc.toString(), this.table);
      if (current === null) { new Notice(t("notice.staleTable")); return; }
      void renderTableClipboard(this.app, current, this.sourcePath, this.getSettings().appearance)
        .then(({ html, text }) => copyHtml(html, text))
        .then(() => { new Notice(t("notice.copied").replace("{format}", "HTML")); })
        .catch(() => { new Notice(t("notice.clipboardFailed")); });
    })));
    if (this.promote !== undefined && info?.editor !== undefined) {
      addBasePromotionMenuItem(menu, t, this.table, () => activate(() => this.promote?.(info.editor!, () => view.dom.isConnected ? view.state.field(editorInfoField, false) ?? null : null, this.table)));
    }
    const menuOptions = { fullEditor: true, explicitRemoval: true } as const;
    if (!hasSelectionMenuItems(selection, menuOptions)) return;
    addSelectionMenuItems(
      menu,
      t,
      selection,
      (operation, intent) => activate(() => this.applyMenuOperation(
        view,
        operation,
        undefined,
        intent === "owned-grid" ? frozen.axisSelection : undefined,
        intent,
        frozen,
      )),
      menuOptions,
    );
  }

  private plainTextCaretOffset(event: MouseEvent | PointerEvent, coordinate: TableCellCoordinate): number | null {
    const cell = this.table.rows[coordinate.row]?.cells[coordinate.column];
    const anchor = cell === undefined ? undefined : this.table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
    const element = anchor === undefined ? null : this.cellElement(anchor);
    const content = element?.querySelector<HTMLElement>(":scope > .structural-tables-cell-content") ?? null;
    if (anchor === undefined || content === null) return null;
    const raw = anchor.raw.trim();
    if (content.textContent !== raw) return null;

    let textNode: Text | null = null;
    if (content.childNodes.length === 1 && content.firstChild?.nodeType === 3) {
      textNode = content.firstChild as Text;
    } else if (content.children.length === 1 && content.firstElementChild?.tagName === "P") {
      const paragraph = content.firstElementChild;
      if (paragraph.childNodes.length === 1 && paragraph.firstChild?.nodeType === 3) {
        textNode = paragraph.firstChild as Text;
      }
    }
    if (textNode === null || textNode.data !== raw) return null;

    const doc = content.ownerDocument as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    return position !== undefined && position !== null
      && position.offsetNode === textNode && position.offset >= 0 && position.offset <= raw.length
      ? position.offset : null;
  }

  private cellElement(coordinate: TableCellCoordinate): HTMLElement | null {
    const cell = this.table.rows[coordinate.row]?.cells[coordinate.column];
    if (cell === undefined || this.renderedTable === null) return null;
    return this.renderedTable.querySelector<HTMLElement>(
      `[data-structural-row='${cell.anchorRow}'][data-structural-column='${cell.anchorColumn}']`,
    );
  }

  private beginCellEdit(
    view: EditorView,
    coordinate: TableCellCoordinate,
    entryIntent: CellEditEntryIntent = "select-all",
  ): void {
    this.axisSelection = null;
    this.touchAxisAnchor = null;
    const cell = this.table.rows[coordinate.row]?.cells[coordinate.column];
    const anchor = cell === undefined ? undefined : this.table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
    const element = anchor === undefined ? null : this.cellElement(anchor);
    if (anchor === undefined || element === null || element.querySelector(".structural-tables-cell-editor") !== null) return;
    this.syncSourceCursor(view, { row: anchor.row, column: anchor.column });
    const activeEditor = this.renderedTable?.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor");
    if (activeEditor != null) {
      const from = this.table.range.from;
      const sourcePath = this.sourcePath;
      activeEditor.blur();
      if (this.host === null) {
        const table = parseEditableTables(view.state.doc.toString()).tables.find((candidate) => candidate.range.from === from);
        if (table !== undefined && view.state.field(editorInfoField, false)?.file?.path === sourcePath) {
          requestTableFocus(view, { from, source: table.source, sourcePath, coordinate, edit: true, entryIntent });
        }
        return;
      }
      // A composing editor may defer its blur commit. Keep its draft as the sole session.
      if (activeEditor.isConnected) return;
    }
    this.selectionAnchor = { row: anchor.row, column: anchor.column };
    this.selectionHead = this.selectionAnchor;
    this.updateSelection();

    const editor = element.ownerDocument.adoptNode(createEl("textarea"));
    editor.className = "structural-tables-cell-editor";
    editor.cols = 1;
    editor.rows = 1;
    editor.value = anchor.raw.trim();
    const t = createTranslator(this.getSettings().language);
    editor.setAttribute("aria-label", t("editor.cell")
      .replace("{row}", String(anchor.row + 1))
      .replace("{column}", String(anchor.column + 1)));
    // The content layer continues to size the cell while the editor overlays it.
    element.classList.add("is-editing");
    element.appendChild(editor);
    const rowElement = element.closest<HTMLTableRowElement>("tr");
    const initialCellHeight = element.getBoundingClientRect().height;
    const initialRowHeight = rowElement?.getBoundingClientRect().height || initialCellHeight;
    const resizeEditor = (): void => {
      if (rowElement === null || !editor.isConnected) return;
      // Measure from a collapsed overlay so shrinking drafts can shrink again.
      editor.classList.add("is-measuring");
      const contentHeight = editor.scrollHeight;
      editor.classList.remove("is-measuring");
      const viewportHeight = editor.ownerDocument.defaultView?.innerHeight ?? 800;
      const maxHeight = Math.max(initialCellHeight, Math.min(480, viewportHeight / 2));
      const nextHeight = Math.max(initialCellHeight, Math.min(maxHeight, contentHeight));
      rowElement.setCssProps({ "--structural-table-edit-row-height": nextHeight > initialCellHeight
        ? `${Math.ceil(initialRowHeight + nextHeight - initialCellHeight)}px` : "0px" });
      editor.setCssProps({ "--structural-table-editor-overflow-y": contentHeight > maxHeight ? "auto" : "hidden" });
    };
    let settled = false;
    let composing = false;
    let contextMenuOpen = false;
    let lastRejectedDraft: string | null = null;
    type DraftSnapshot = { value: string; start: number; end: number };
    type DraftHistoryGroup = "typing" | "composition" | "deletion" | "native" | "format" | "paste" | "break";
    type DraftHistoryEntry = {
      before: DraftSnapshot;
      after: DraftSnapshot;
      group: DraftHistoryGroup;
    };
    const draftUndo: DraftHistoryEntry[] = [];
    const draftRedo: DraftHistoryEntry[] = [];
    let lastHistorySnapshot: DraftSnapshot;
    let pendingNativeInput: { before: DraftSnapshot; group: DraftHistoryGroup } | null = null;
    let allowNativeHistoryMerge = true;
    const draftSnapshot = (): DraftSnapshot => ({
      value: editor.value,
      start: editor.selectionStart,
      end: editor.selectionEnd,
    });
    lastHistorySnapshot = draftSnapshot();
    const sameDraftSnapshot = (left: DraftSnapshot, right: DraftSnapshot): boolean =>
      left.value === right.value && left.start === right.start && left.end === right.end;
    const restoreDraftSnapshot = (snapshot: DraftSnapshot): void => {
      editor.value = snapshot.value;
      editor.setSelectionRange(snapshot.start, snapshot.end);
      lastHistorySnapshot = snapshot;
      pendingNativeInput = null;
      lastRejectedDraft = null;
      resizeEditor();
      editor.focus({ preventScroll: true });
    };
    const recordDraftHistory = (
      before: DraftSnapshot,
      after: DraftSnapshot,
      group: DraftHistoryGroup,
      merge: boolean,
    ): void => {
      if (sameDraftSnapshot(before, after)) {
        lastHistorySnapshot = after;
        return;
      }
      const previous = draftUndo[draftUndo.length - 1];
      if (merge && previous?.group === group && sameDraftSnapshot(previous.after, before)) {
        previous.after = after;
      } else {
        draftUndo.push({ before, after, group });
      }
      draftRedo.length = 0;
      lastHistorySnapshot = after;
    };
    const applyDraftMutation = (group: DraftHistoryGroup, mutate: () => void): void => {
      const before = draftSnapshot();
      mutate();
      recordDraftHistory(before, draftSnapshot(), group, false);
      lastRejectedDraft = null;
      resizeEditor();
      editor.focus({ preventScroll: true });
    };
    const nativeHistoryGroup = (event: InputEvent): DraftHistoryGroup => {
      const inputType = event.inputType ?? "";
      if (composing || event.isComposing || inputType.includes("Composition")) return "composition";
      if (inputType === "insertText") return "typing";
      if (inputType === "deleteContentBackward" || inputType === "deleteContentForward") return "deletion";
      return "native";
    };
    const isEscapedAt = (value: string, index: number): boolean => {
      let backslashes = 0;
      for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) backslashes += 1;
      return backslashes % 2 === 1;
    };
    const starRunBefore = (value: string, index: number): { from: number; length: number } | null => {
      let from = index;
      while (from > 0 && value[from - 1] === "*") from -= 1;
      const length = index - from;
      return length >= 1 && length <= 3 && !isEscapedAt(value, from) ? { from, length } : null;
    };
    const starRunAfter = (value: string, index: number): { to: number; length: number } | null => {
      let to = index;
      while (to < value.length && value[to] === "*") to += 1;
      const length = to - index;
      return length >= 1 && length <= 3 && !isEscapedAt(value, index) ? { to, length } : null;
    };
    const codePointBefore = (value: string, index: number): string | null =>
      /[\s\S]$/u.exec(value.slice(0, index))?.[0] ?? null;
    const codePointAfter = (value: string, index: number): string | null =>
      /^[\s\S]/u.exec(value.slice(index))?.[0] ?? null;
    const isMarkdownWhitespace = (character: string | null): boolean =>
      character === null || /\s/u.test(character);
    const isMarkdownPunctuation = (character: string | null): boolean =>
      character !== null && /[\p{P}\p{S}]/u.test(character);
    const starRunFlanking = (
      value: string,
      from: number,
      to: number,
    ): { left: boolean; right: boolean } => {
      const previous = codePointBefore(value, from);
      const next = codePointAfter(value, to);
      const previousWhitespace = isMarkdownWhitespace(previous);
      const nextWhitespace = isMarkdownWhitespace(next);
      const previousPunctuation = isMarkdownPunctuation(previous);
      const nextPunctuation = isMarkdownPunctuation(next);
      return {
        left: !nextWhitespace && (!nextPunctuation || previousWhitespace || previousPunctuation),
        right: !previousWhitespace && (!previousPunctuation || nextWhitespace || nextPunctuation),
      };
    };
    const isValidStarWrapper = (
      value: string,
      openingFrom: number,
      openingTo: number,
      closingFrom: number,
      closingTo: number,
    ): boolean =>
      starRunFlanking(value, openingFrom, openingTo).left
      && starRunFlanking(value, closingFrom, closingTo).right;
    const selectedStarWrapper = (
      value: string,
      start: number,
      end: number,
    ): { content: string; length: number } | null => {
      if (start >= end || value[start] !== "*" || value[end - 1] !== "*") return null;
      let left = start;
      while (left < end && value[left] === "*") left += 1;
      let right = end;
      while (right > start && value[right - 1] === "*") right -= 1;
      const leftLength = left - start;
      const rightLength = end - right;
      const content = value.slice(left, right);
      if (leftLength !== rightLength || leftLength < 1 || leftLength > 3 || left >= right) return null;

      let fullLeft = start;
      while (fullLeft > 0 && value[fullLeft - 1] === "*") fullLeft -= 1;
      let fullRight = end;
      while (fullRight < value.length && value[fullRight] === "*") fullRight += 1;
      const completeLeftLength = left - fullLeft;
      const completeRightLength = fullRight - right;
      if (completeLeftLength > 3 || completeRightLength > 3
        || isEscapedAt(value, fullLeft) || isEscapedAt(value, right)
        || !isValidStarWrapper(value, fullLeft, left, right, fullRight)) return null;
      return { content, length: leftLength };
    };
    const ambiguousSelectedStarBoundary = (value: string, start: number, end: number): boolean =>
      start < end && (value[start] === "*" || value[end - 1] === "*");
    const toggledStarRunLength = (current: number, target: 1 | 2): number => {
      let italic = current === 1 || current === 3;
      let bold = current === 2 || current === 3;
      if (target === 1) italic = !italic;
      else bold = !bold;
      return (bold ? 2 : 0) + (italic ? 1 : 0);
    };
    this.releaseNavigationScope();
    const scope = new Scope(this.app.scope);

    const insertBreak = (start = editor.selectionStart, end = editor.selectionEnd): void => {
      applyDraftMutation("break", () => {
        editor.setRangeText("\n", start, end, "end");
      });
    };
    const toggleDraftInlineFormat = (marker: "*" | "**"): void => {
      const target = marker.length as 1 | 2;
      applyDraftMutation("format", () => {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const value = editor.value;
        const selected = value.slice(start, end);
        if (start === end) {
          editor.setRangeText(marker + marker, start, end, "end");
          const caret = start + target;
          editor.setSelectionRange(caret, caret);
          return;
        }

        const selectedWrapper = selectedStarWrapper(value, start, end);
        if (selectedWrapper !== null) {
          const nextLength = toggledStarRunLength(selectedWrapper.length, target);
          const stars = "*".repeat(nextLength);
          editor.setRangeText(stars + selectedWrapper.content + stars, start, end, "end");
          editor.setSelectionRange(start + nextLength, start + nextLength + selectedWrapper.content.length);
          return;
        }

        const before = starRunBefore(value, start);
        const after = starRunAfter(value, end);
        if (before !== null && after !== null && before.length === after.length) {
          if (!isValidStarWrapper(value, before.from, start, end, after.to)) return;
          const nextLength = toggledStarRunLength(before.length, target);
          const stars = "*".repeat(nextLength);
          editor.setRangeText(stars + selected + stars, before.from, after.to, "end");
          editor.setSelectionRange(before.from + nextLength, before.from + nextLength + selected.length);
          return;
        }

        if (before !== null || after !== null || ambiguousSelectedStarBoundary(value, start, end)) return;
        editor.setRangeText(marker + selected + marker, start, end, "end");
        editor.setSelectionRange(start + target, end + target);
      });
    };

    const restore = (focus: boolean): void => {
      element.classList.remove("is-editing");
      rowElement?.setCssProps({ "--structural-table-edit-row-height": "0px" });
      editor.remove();
      if (focus) element.focus({ preventScroll: true });
    };
    this.preserveDraft = () => {
      if (!settled && editor.value !== anchor.raw.trim()) {
        retainCellDraft(this.app, { sourcePath: this.sourcePath, row: anchor.row, column: anchor.column, text: editor.value }, t);
      }
      settled = true;
      releaseCellEditorFocus(editor);
    };
    const settle = (): void => {
      settled = true;
      releaseCellEditorFocus(editor);
      this.preserveDraft = null;
      this.finishActiveOperation = null;
      this.releaseCellScope(scope);
    };
    const retainDraft = (message: string): void => {
      lastRejectedDraft = editor.value;
      new Notice(message);
      queueMicrotask(() => {
        if (!settled && editor.isConnected && ownsCellEditorFocus(editor)) {
          editor.focus({ preventScroll: true });
        }
      });
    };
    const finish = (commit: boolean, next: TableCellCoordinate | null = null, focus = true, operation?: TableOperation): void => {
      if (settled) return;
      if (!commit) {
        settle();
        restore(focus);
        return;
      }
      const current = reparseUnchangedTable(view.state.doc.toString(), this.table);
      if (current === null) {
        retainDraft(t("notice.staleTable"));
        return;
      }
      const result = operation === undefined
        ? editCellContent(current, anchor.row, anchor.column, editor.value)
        : editCellAndTransform(current, anchor.row, anchor.column, editor.value, operation);
      if (!result.changed && result.code !== "cell-edited") {
        retainDraft(operationNotice(t, result.code));
        return;
      }
      settle();
      if (!result.changed) {
        restore(focus);
        if (next !== null) requestTableFocus(view, {
          from: current.range.from, source: current.source, sourcePath: this.sourcePath, coordinate: next, edit: true,
        });
        return;
      }
      const nativeCallout = this.host?.closest(".callout") != null;
      const target: PendingCellFocus = {
        from: current.range.from, source: result.source, sourcePath: this.sourcePath,
        coordinate: next ?? anchor, edit: next !== null,
      };
      view.dispatch({
        changes: { from: current.range.from, to: current.range.to, insert: result.source },
        ...(nativeCallout ? tableWriteHistory(current, result.source, this.sourcePath, anchor) : {}),
        ...(focus && !nativeCallout ? { selection: { anchor: current.range.from + result.source.length } } : {}),
      });
      if (nativeCallout && (focus || next !== null)) {
        this.restoreCalloutFocus(view, result.source, next ?? anchor, next !== null, false, target.from);
      } else if (next !== null || focus) requestTableFocus(view, target);
    };
    this.finishActiveOperation = (operation, next) => {
      if (!composing) finish(true, next, true, operation);
    };
    const commitToNextRow = (): void => {
      const next = tableCellInDirection(this.table, anchor, "down");
      if (next !== null) finish(true, next);
      else finish(
        true,
        { row: this.table.rows.length, column: Math.min(anchor.anchorColumn, this.table.columnCount - 1) },
        true,
        appendTableRow,
      );
    };

    const stableSingleVisualLine = (): boolean => {
      if (editor.value.includes("\n")) return false;
      const style = editor.ownerDocument.defaultView?.getComputedStyle(editor);
      const lineHeight = Number.parseFloat(style?.lineHeight ?? "");
      const clientHeight = editor.clientHeight;
      const scrollHeight = editor.scrollHeight;
      return Number.isFinite(lineHeight) && lineHeight > 0
        && clientHeight > 0 && scrollHeight > 0
        && clientHeight >= lineHeight * 0.75 && clientHeight <= lineHeight * 1.5
        && scrollHeight <= lineHeight * 1.5;
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (composing || event.isComposing || contextMenuOpen) return;
      const noModifier = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      const collapsed = editor.selectionStart === editor.selectionEnd;
      const rtl = this.renderedTable?.ownerDocument.defaultView?.getComputedStyle(this.renderedTable).direction === "rtl";
      const backwardKey = rtl ? "ArrowRight" : "ArrowLeft";
      const forwardKey = rtl ? "ArrowLeft" : "ArrowRight";

      if (noModifier && collapsed && event.key === backwardKey && editor.selectionStart === 0) {
        const previous = this.adjacentCell(anchor, "backward");
        if (previous !== null) {
          event.preventDefault();
          event.stopPropagation();
          finish(true, previous);
        }
        return;
      }
      if (noModifier && collapsed && event.key === forwardKey && editor.selectionEnd === editor.value.length) {
        const next = this.adjacentCell(anchor, "forward");
        if (next !== null) {
          event.preventDefault();
          event.stopPropagation();
          finish(true, next);
        }
        return;
      }
      if (noModifier && collapsed && (event.key === "ArrowUp" || event.key === "ArrowDown")
        && stableSingleVisualLine()) {
        const target = tableCellInDirection(this.table, anchor, event.key === "ArrowUp" ? "up" : "down");
        if (target !== null) {
          event.preventDefault();
          event.stopPropagation();
          finish(true, target);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        insertBreak();
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        commitToNextRow();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        const next = this.adjacentCell(anchor, event.shiftKey ? "backward" : "forward");
        if (next === null && !event.shiftKey) {
          finish(true, { row: this.table.rows.length, column: 0 }, true, appendTableRow);
        } else finish(true, next);
      }
    };
    // Obsidian handles app Scope shortcuts before textarea bubbling. Own only
    // the draft-local shortcuts here so parent editor commands cannot rewrite
    // the saved cell while this textarea has editing ownership.
    scope.register([], "Escape", (event) => {
      if (composing || event.isComposing || contextMenuOpen) return;
      handleKey(event);
      return false;
    });
    const registerDraftFormat = (key: "b" | "i", marker: "*" | "**"): void => {
      scope.register(["Mod"], key, (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (settled || composing || event.isComposing || contextMenuOpen
          || !ownsCellEditorFocus(editor) || editor.ownerDocument.activeElement !== editor) return false;
        toggleDraftInlineFormat(marker);
        return false;
      });
    };
    registerDraftFormat("b", "**");
    registerDraftFormat("i", "*");
    const registerDraftHistory = (
      modifiers: ("Mod" | "Ctrl" | "Shift")[],
      key: "z" | "y",
      redo: boolean,
    ): void => {
      scope.register(modifiers, key, (event) => {
        if (settled || composing || event.isComposing || contextMenuOpen
          || !ownsCellEditorFocus(editor) || editor.ownerDocument.activeElement !== editor) return true;
        event.preventDefault();
        event.stopPropagation();
        const from = redo ? draftRedo : draftUndo;
        const to = redo ? draftUndo : draftRedo;
        const entry = from.pop();
        if (entry !== undefined) {
          to.push(entry);
          restoreDraftSnapshot(redo ? entry.after : entry.before);
          // Typing after history navigation starts a new branch. Do not merge
          // it back into a typing transaction that predates the undo/redo.
          allowNativeHistoryMerge = false;
        }
        return false;
      });
    };
    registerDraftHistory(["Mod"], "z", false);
    registerDraftHistory(["Mod", "Shift"], "z", true);
    registerDraftHistory(["Ctrl"], "y", true);
    const activateCellScope = (): void => {
      claimCellEditorFocus(editor);
      if (this.cellScope === scope) return;
      this.releaseCellScope();
      this.cellScope = scope;
      this.app.keymap.pushScope(scope);
    };
    editor.addEventListener("focus", activateCellScope);
    editor.addEventListener("keydown", handleKey);
    editor.addEventListener("input", (event) => {
      const inputEvent = event;
      const after = draftSnapshot();
      const pending = pendingNativeInput;
      pendingNativeInput = null;
      const group = pending?.group ?? nativeHistoryGroup(inputEvent);
      recordDraftHistory(
        pending?.before ?? lastHistorySnapshot,
        after,
        (pending?.group ?? nativeHistoryGroup(inputEvent)),
        allowNativeHistoryMerge && (group === "typing" || group === "composition"),
      );
      allowNativeHistoryMerge = true;
      lastRejectedDraft = null;
      resizeEditor();
    });
    editor.addEventListener("beforeinput", (event) => {
      // Soft keyboards can insert a line break before sending a useful keydown.
      // Use the same validated commit/navigation transaction as physical Enter.
      event.stopPropagation();
      if (event.defaultPrevented) return;
      // Gboard may replace the selection with an empty insertText before Enter.
      // Explicit deletion uses delete input types and must remain available.
      if (!composing && !event.isComposing
        && event.inputType === "insertText" && event.data === ""
        && editor.selectionStart !== editor.selectionEnd) {
        event.preventDefault();
        return;
      }
      if (!composing && !event.isComposing
        && (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph")) {
        event.preventDefault();
        commitToNextRow();
        return;
      }
      pendingNativeInput = { before: draftSnapshot(), group: nativeHistoryGroup(event) };
    });
    editor.addEventListener("paste", (event) => {
      if (event.clipboardData === null) return;
      const html = event.clipboardData?.getData("text/html") ?? "";
      const result = cellClipboardText(html, event.clipboardData.getData("text/plain"));
      event.preventDefault();
      if (result.kind === "unsupported") {
        new Notice(t("notice.clipboardUnsupported"));
        return;
      }
      if (result.kind === "text" && result.fallback) new Notice(t("notice.clipboardPlainFallback"));
      const pasted = result.kind === "empty" ? "" : result.text;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      // A fragment may be inside an existing math/code/link span. Preserve it
      // in the draft and validate the full cell only when committing.
      applyDraftMutation("paste", () => {
        editor.setRangeText(pasted, start, end, "end");
      });
    });
    editor.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      contextMenuOpen = true;
      const menu = Menu.forEvent(event);
      menu.addItem((item) => item
        .setSection("structural-tables-cell")
        .setIcon("corner-down-left")
        .setTitle(t("menu.insertCellBreak"))
        .onClick(() => insertBreak(start, end)));
      const draftAtOpen = editor.value;
      for (const suggestion of mathPipeSuggestions(draftAtOpen)) {
        menu.addItem((item) => item
          .setSection("structural-tables-cell")
          .setIcon("replace")
          .setTitle(t(suggestion.kind === "absolute-value"
            ? "menu.useMathAbsoluteSuggestion" : "menu.useMathConditionalSuggestion"))
          .onClick(() => {
            if (settled || composing || editor.value !== draftAtOpen) return;
            editor.value = suggestion.replacement;
            resizeEditor();
            finish(true);
          }));
      }
      menu.onHide(() => {
        // Menu dismissal can run before the same Escape reaches the app scope.
        // Keep the guard until that event has finished, then return to the draft.
        (editor.ownerDocument.defaultView ?? window).setTimeout(() => {
          contextMenuOpen = false;
          if (!settled && ownsCellEditorFocus(editor)) editor.focus({ preventScroll: true });
        }, 0);
      });
    });
    editor.addEventListener("compositionstart", (event) => {
      composing = true;
      event.stopPropagation();
    });
    editor.addEventListener("compositionend", (event) => {
      composing = false;
      event.stopPropagation();
      resizeEditor();
      if (editor.ownerDocument.activeElement !== editor && !contextMenuOpen) finish(true, null, false);
    });
    editor.addEventListener("blur", () => {
      if (!contextMenuOpen) releaseCellEditorFocus(editor);
      if (!composing && !contextMenuOpen && lastRejectedDraft !== editor.value) {
        finish(true, null, false);
      }
      this.releaseCellScope(scope);
    });
    editor.focus({ preventScroll: true });
    if (entryIntent === "select-all") editor.select();
    else editor.setSelectionRange(entryIntent.caretOffset, entryIntent.caretOffset);
    queueMicrotask(resizeEditor);
  }

  private releaseCellScope(scope: Scope | null = this.cellScope): void {
    if (scope === null) return;
    this.app.keymap.popScope(scope);
    if (this.cellScope === scope) this.cellScope = null;
  }

  private releaseNavigationScope(): void {
    if (this.navigationScope === null) return;
    this.app.keymap.popScope(this.navigationScope);
    this.navigationScope = null;
  }

  private adjacentCell(cell: TableCellCoordinate, direction: "backward" | "forward"): TableCellCoordinate | null {
    return adjacentTableCell(this.table, cell, direction);
  }

  private installHandles(view: EditorView, host: HTMLElement, rendered: HTMLTableElement): void {
    const t = createTranslator(this.getSettings().language);
    const addButton = (axis: "row" | "column"): HTMLButtonElement => {
      const button = host.createEl("button", { cls: `structural-tables-add-${axis}` });
      button.type = "button";
      button.textContent = "+";
      button.setAttribute("aria-label", t(axis === "row" ? "handle.addRow" : "handle.addColumn"));
      button.title = button.getAttribute("aria-label")!;
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = axis === "row" ? { row: this.table.rows.length, column: 0 }
          : { row: 0, column: this.table.columnCount };
        const operation: TableOperation = axis === "row" ? appendTableRow
          : (table) => insertTableColumn(table, table.columnCount - 1, "after");
        if (this.finishActiveOperation !== null) this.finishActiveOperation(operation, next);
        else this.applyMenuOperation(view, operation, next);
      });
      return button;
    };
    const addRow = addButton("row");
    const addColumn = addButton("column");
    this.axisDrag = new TableAxisDrag(host, rendered, () => this.table, () => this.axisSelection,
      (result) => operationNotice(t, result.code),
      (selection, destination) => {
        const { axis, start, end } = selection;
        const movedStart = destination > end ? destination - (end - start + 1) : destination;
        const nextSelection = { axis, start: movedStart, end: movedStart + end - start };
        this.applyMenuOperation(view, (table) => reorderTableAxis(table, axis, start, end, destination),
          axis === "row" ? { row: movedStart, column: 0 } : { row: 0, column: movedStart }, nextSelection);
      });
    const installAxisHandle = (handle: HTMLButtonElement, axis: TableAxis, index: number): void => {
      // Obsidian listens to touch events separately from pointer events for sidebar swipes.
      // Keep those gestures local to the handle without disabling its native long-press menu.
      for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {
        handle.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
      }
      handle.addEventListener("pointerdown", (event) => {
        if (!event.isPrimary || event.button !== 0) return;
        if (this.axisDrag?.start(event, axis, index)) return;
        event.preventDefault();
        event.stopPropagation();
        const touchAnchor = event.pointerType === "touch" ? this.touchAxisAnchor : null;
        const extendTouch = touchAnchor?.axis === axis && touchAnchor.index !== index;
        if (extendTouch) this.axisAnchor = touchAnchor.index;
        else if (!event.shiftKey || this.axisSelection?.axis !== axis) this.axisAnchor = index;
        this.selectAxis({ axis, start: Math.min(this.axisAnchor, index), end: Math.max(this.axisAnchor, index) });
        this.touchAxisAnchor = event.pointerType === "touch" && !extendTouch ? { axis, index } : null;
        handle.focus({ preventScroll: true });
        this.activateAxisClearScope(view, handle, axis, index);
      });
      handle.addEventListener("click", () => {
        if (this.axisDrag?.consumeClick()) return;
        if (this.axisSelection?.axis !== axis || index < this.axisSelection.start || index > this.axisSelection.end) {
          this.axisAnchor = index;
          this.selectAxis({ axis, start: index, end: index });
        }
        this.activateAxisClearScope(view, handle, axis, index);
      });
      handle.addEventListener("contextmenu", (event) => {
        this.touchAxisAnchor = null;
        event.preventDefault();
        event.stopPropagation();
        if (this.axisSelection?.axis !== axis || index < this.axisSelection.start || index > this.axisSelection.end) {
          this.axisAnchor = index;
          this.selectAxis({ axis, start: index, end: index });
        }
        this.activateAxisClearScope(view, handle, axis, index);
        this.showSelectionMenu(event, view);
      });
    };
    const rowHandles = this.table.rows.map((_row, row) => {
      const handle = host.ownerDocument.adoptNode(createEl("button"));
      handle.type = "button";
      handle.className = "structural-tables-row-handle";
      handle.dataset.structuralRowHandle = String(row);
      handle.textContent = "⋮";
      handle.setAttribute("aria-label", withCount(t("handle.row"), row + 1));
      handle.title = t("handle.dragHint");
      installAxisHandle(handle, "row", row);
      host.appendChild(handle);
      return handle;
    });
    const columnHandles = this.table.alignments.map((_alignment, column) => {
      const handle = host.ownerDocument.adoptNode(createEl("button"));
      handle.type = "button";
      handle.className = "structural-tables-column-handle";
      handle.dataset.structuralColumnHandle = String(column);
      handle.textContent = "⋯";
      handle.setAttribute("aria-label", withCount(t("handle.column"), column + 1));
      handle.title = t("handle.dragHint");
      installAxisHandle(handle, "column", column);
      host.appendChild(handle);
      return handle;
    });
    this.installRovingHandles(rowHandles, "vertical", rendered, view);
    this.installRovingHandles(columnHandles, "horizontal", rendered, view);
    host.addEventListener("pointerleave", () => this.clearRevealedHandles());
    const positionHandles = (): void => {
      const hostRect = host.getBoundingClientRect();
      const tableRect = rendered.getBoundingClientRect();
      const containerRect = rendered.closest(".structural-tables-container")?.getBoundingClientRect();
      const scrollRect = containerRect !== undefined && containerRect.width > 0 ? containerRect : tableRect;
      const rtl = rendered.ownerDocument.defaultView?.getComputedStyle(rendered).direction === "rtl";
      const gutter = parseFloat(rendered.ownerDocument.defaultView?.getComputedStyle(addColumn).width ?? "24") || 24;
      const left = Math.max(scrollRect.left, tableRect.left) - hostRect.left;
      const right = Math.min(scrollRect.right, tableRect.right) - hostRect.left;
      const inlineStart = rtl ? hostRect.width - right : left;
      addRow.style.top = `${tableRect.bottom - hostRect.top}px`;
      addRow.style.left = `${left}px`;
      addRow.style.width = `${Math.max(gutter, right - left)}px`;
      addColumn.style.top = `${tableRect.top - hostRect.top}px`;
      addColumn.style.left = `${rtl ? Math.max(0, left - gutter) : Math.max(0, right)}px`;
      addColumn.style.height = `${tableRect.height}px`;
      rowHandles.forEach((handle, row) => {
        const rowRect = rendered.rows.item(row)?.getBoundingClientRect();
        const fallback = (row + 0.5) / this.table.rows.length;
        handle.style.top = `${rowRect === undefined || rowRect.height === 0
          ? tableRect.top - hostRect.top + fallback * Math.max(0, tableRect.height)
          : rowRect.top - hostRect.top + rowRect.height / 2}px`;
        handle.style.setProperty("inset-inline-start", `calc(${inlineStart}px - var(--structural-table-handle-gutter))`);
      });
      const columns = tableAxisBoundaries(rendered, "column", this.table.columnCount);
      columnHandles.forEach((handle, column) => {
        const center = (columns[column]! + columns[column + 1]!) / 2;
        const start = Math.min(columns[column]!, columns[column + 1]!);
        const end = Math.max(columns[column]!, columns[column + 1]!);
        handle.hidden = scrollRect.width > 0 && (end <= scrollRect.left || start >= scrollRect.right);
        const visibleCenter = Math.max(scrollRect.left, Math.min(scrollRect.right, center));
        handle.style.left = `${visibleCenter - hostRect.left}px`;
        handle.style.setProperty(
          "inset-block-start",
          `calc(${tableRect.top - hostRect.top}px - var(--structural-table-handle-gutter))`,
        );
      });
      const entry = columnHandles.find((handle) => !handle.hidden && handle.tabIndex === 0)
        ?? columnHandles.find((handle) => !handle.hidden);
      columnHandles.forEach((handle) => { handle.tabIndex = handle === entry ? 0 : -1; });
    };
    this.positionHandles = positionHandles;
    positionHandles();
    const scroller = rendered.closest<HTMLElement>(".structural-tables-container");
    if (scroller !== null) this.component?.registerDomEvent(scroller, "scroll", positionHandles);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(positionHandles);
      this.resizeObserver.observe(rendered);
    }
  }

  private installRovingHandles(
    handles: HTMLButtonElement[],
    orientation: "horizontal" | "vertical",
    rendered: HTMLTableElement,
    view: EditorView,
  ): void {
    handles.forEach((handle, index) => {
      handle.tabIndex = index === 0 ? 0 : -1;
      handle.addEventListener("focus", () => {
        handles.forEach((candidate) => { candidate.tabIndex = candidate === handle ? 0 : -1; });
        const axis = orientation === "vertical" ? "row" : "column";
        this.activateAxisClearScope(view, handle, axis, index);
      });
      handle.addEventListener("blur", () => this.releaseNavigationScope());
      handle.addEventListener("keydown", (event) => {
        if (this.handleGridClear(event, view)) return;
        if (this.handleHistory(event, view, orientation === "vertical"
          ? { row: index, column: 0 } : { row: 0, column: index })) return;
        const rtl = rendered.ownerDocument.defaultView?.getComputedStyle(rendered).direction === "rtl";
        const previousKey = orientation === "vertical" ? "ArrowUp" : rtl ? "ArrowRight" : "ArrowLeft";
        const nextKey = orientation === "vertical" ? "ArrowDown" : rtl ? "ArrowLeft" : "ArrowRight";
        let targetIndex: number | null = null;
        if (event.key === previousKey) targetIndex = Math.max(0, index - 1);
        else if (event.key === nextKey) targetIndex = Math.min(handles.length - 1, index + 1);
        else if (event.key === "Home") targetIndex = 0;
        else if (event.key === "End") targetIndex = handles.length - 1;
        if (targetIndex === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (targetIndex === index) return;
        const target = handles[targetIndex];
        if (orientation === "horizontal") {
          const scroller = rendered.closest<HTMLElement>(".structural-tables-container");
          if (scroller !== null) {
            const bounds = tableAxisBoundaries(rendered, "column", handles.length);
            const center = (bounds[targetIndex]! + bounds[targetIndex + 1]!) / 2;
            const rect = scroller.getBoundingClientRect();
            scroller.scrollLeft += center - Math.max(rect.left + 12, Math.min(rect.right - 12, center));
            this.positionHandles?.();
          }
        } else target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        target?.focus({ preventScroll: true });
        target?.click();
      });
    });
  }

  private selectBounds(first: TableCellCoordinate, last: TableCellCoordinate): void {
    this.axisSelection = null;
    this.touchAxisAnchor = null;
    this.touchRangeAnchor = null;
    this.selectionAnchor = first;
    this.selectionHead = last;
    this.updateSelection();
  }

  private selectAxis(selection: AxisSelection): void {
    const { axis, start, end } = selection;
    this.selectBounds(axis === "row" ? { row: start, column: 0 } : { row: 0, column: start },
      axis === "row" ? { row: end, column: this.table.columnCount - 1 } : { row: this.table.rows.length - 1, column: end });
    // Bounds expand through merged cells; dragging must use the same range as the highlight.
    const bounds = this.selection;
    this.axisSelection = bounds === null ? null : {
      axis,
      start: axis === "row" ? bounds.minRow : bounds.minColumn,
      end: axis === "row" ? bounds.maxRow : bounds.maxColumn,
    };
  }

  private focusAxis(selection: AxisSelection): void {
    this.selectAxis(selection);
    this.axisAnchor = selection.start;
    this.host?.querySelector<HTMLElement>(`[data-structural-${selection.axis}-handle='${selection.start}']`)
      ?.focus({ preventScroll: true });
  }

  private applyMenuOperation(
    view: EditorView,
    operation: TableOperation,
    next?: TableCellCoordinate,
    axisSelection?: AxisSelection,
    intent: TableOperationIntent = "standard",
    frozen?: FrozenGridSelection,
  ): void {
    const t = createTranslator(this.getSettings().language);
    const expected = frozen?.selection.table ?? this.table;
    if (intent === "owned-grid"
      && view.state.field(editorInfoField, false)?.file?.path !== (frozen?.sourcePath ?? this.sourcePath)) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const current = frozen === undefined
      ? reparseUnchangedTable(view.state.doc.toString(), expected)
      : this.currentTableForFrozenSelection(view, frozen);
    if (current === null) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const selection = frozen?.selection ?? this.selection;
    const selectionAnchor = frozen?.anchor ?? this.selectionAnchor;
    const selectionHead = frozen?.head ?? this.selectionHead;
    const result = operation(current);
    if (!result.changed) {
      if (result.code !== "cells-cleared") new Notice(operationNotice(t, result.code));
      return;
    }

    const ownedGrid = intent === "owned-grid";
    const tableDeleted = result.code === "table-deleted";
    let coordinate = next ?? selectionAnchor ?? { row: 0, column: 0 };
    let restoredAxis = axisSelection;
    let restoredBounds = (result.code === "cells-cleared" || result.code === "range-pasted")
      && selectionAnchor !== null && selectionHead !== null
      ? { first: selectionAnchor, last: selectionHead } : undefined;

    if (ownedGrid && selection !== null && result.code === "rows-deleted") {
      const remainingRows = current.rows.length - (selection.maxRow - selection.minRow + 1);
      coordinate = {
        row: Math.max(0, Math.min(selection.minRow, remainingRows - 1)),
        column: Math.min(selection.minColumn, current.columnCount - 1),
      };
      restoredBounds = undefined;
      restoredAxis = axisSelection?.axis === "row"
        ? { axis: "row", start: coordinate.row, end: coordinate.row } : undefined;
    } else if (ownedGrid && selection !== null && result.code === "columns-deleted") {
      const remainingColumns = current.columnCount - (selection.maxColumn - selection.minColumn + 1);
      coordinate = {
        row: Math.min(selection.minRow, current.rows.length - 1),
        column: Math.max(0, Math.min(selection.minColumn, remainingColumns - 1)),
      };
      restoredBounds = undefined;
      restoredAxis = axisSelection?.axis === "column"
        ? { axis: "column", start: coordinate.column, end: coordinate.column } : undefined;
    }

    const nativeCallout = this.host?.closest(".callout") != null;
    const historyCoordinate = tableDeleted ? (selectionAnchor ?? { row: 0, column: 0 }) : coordinate;
    const targetAxis = ownedGrid ? restoredAxis : axisSelection;
    const target: PendingCellFocus = {
      from: current.range.from, source: result.source, sourcePath: this.sourcePath, coordinate,
      edit: !ownedGrid && next !== undefined && axisSelection === undefined,
      ...(targetAxis === undefined ? {} : { axisSelection: targetAxis }),
      ...(!ownedGrid || restoredBounds === undefined ? {} : { selectionBounds: restoredBounds }),
    };
    if (tableDeleted) this.clearSelection();
    view.dispatch({
      changes: { from: current.range.from, to: current.range.to, insert: result.source },
      ...((nativeCallout || ownedGrid)
        ? tableWriteHistory(
          current,
          result.source,
          this.sourcePath,
          historyCoordinate,
          tableDeleted ? { restorePresentation: true } : {},
        ) : {}),
      ...(!nativeCallout ? {
        selection: { anchor: tableDeleted ? current.range.from : current.range.from + result.source.length },
      } : {}),
    });

    if (!ownedGrid) {
      if (nativeCallout) {
        this.restoreCalloutFocus(
          view,
          result.source,
          coordinate,
          next !== undefined && axisSelection === undefined,
          false,
          target.from,
        );
        const pending = pendingCellFocus.get(view);
        if (pending !== undefined && axisSelection !== undefined) pending.axisSelection = axisSelection;
      } else requestTableFocus(view, target);
      new Notice(operationNotice(t, result.code));
      return;
    }

    if (tableDeleted) {
      requestNativeFocus(view, target);
    } else if (nativeCallout) {
      this.restoreCalloutFocus(view, result.source, coordinate, false, false, target.from);
      const pending = pendingCellFocus.get(view);
      if (pending !== undefined) {
        if (restoredAxis !== undefined) pending.axisSelection = restoredAxis;
        else if (restoredBounds !== undefined) pending.selectionBounds = restoredBounds;
      }
    } else requestTableFocus(view, target);
    new Notice(operationNotice(t, result.code));
  }
}
