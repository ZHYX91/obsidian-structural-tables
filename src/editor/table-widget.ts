import type { BaseEditorInfo } from "../app/base-promotion-service";
import { EditorView, WidgetType } from "@codemirror/view";
import type { ChangeDesc } from "@codemirror/state";
import { App, Component, Menu, Notice, Scope, editorInfoField, type Editor } from "obsidian";

import { createTranslator, operationNotice, withCount } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { adjacentTableCell } from "../core/table-navigation";
import { mathPipeSuggestions } from "../core/table-cell-syntax";
import { tableWriteHistory, type TableHistoryTarget } from "./table-history";
import { appendTableRow, clearTableCells, editCellContent, editCellAndTransform, insertTableColumn, reorderTableAxis, type TableAxis } from "../core/operations";
import { TableAxisDrag, tableAxisBoundaries, type AxisSelection } from "./table-axis-drag";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { parseEditableTables } from "../core/parser";
import { renderStructuralTable } from "../rendering/table-renderer";
import { renderTableClipboard } from "../rendering/table-clipboard";
import { cellClipboardText, copyHtml } from "./table-interchange";
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
  structuralTableSelectionFromCoordinates,
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
}
const pendingCellFocus = new WeakMap<EditorView, PendingCellFocus>();
const activeCellEditors = new WeakMap<Document, HTMLTextAreaElement>();

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

export function restoreTableHistoryFocus(view: EditorView,
  target: TableHistoryTarget,
  settings: StructuralTablesSettings): void {
  if (view.state.field(editorInfoField, false)?.file?.path !== target.sourcePath) return;
  if (target.after === "") {
    cancelPendingTableFocus(view);
    const state = view.state;
    const anchor = Math.min(target.from, state.doc.length);
    queueMicrotask(() => {
      if (view.state !== state || !view.dom.isConnected) return;
      view.dispatch({
        selection: { anchor },
        effects: structuralTableSourceFocus.of(true),
      });
      view.focus();
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
    if (view.state !== state || !view.dom.isConnected || pendingCellFocus.get(view) !== pending) return;
    if (!table.structural && !settings.takeOverOrdinaryTables) {
      focusNativeTable(view, table, target.coordinate);
      return;
    }
    // A whole-table removal hands ownership to the native source surface.
    // Undo restores the exact table through history metadata; return that
    // verified target to presentation so its widget can consume pending focus.
    view.dispatch({
      effects: [
        structuralTableSourceFocus.of(false),
        EditorView.scrollIntoView(table.range.from, { y: "nearest" }),
      ],
    });
  });
}

export function cancelPendingTableFocus(view: EditorView): void {
  pendingCellFocus.delete(view);
}

export function mapPendingTableFocus(view: EditorView, changes: ChangeDesc): void {
  const pending = pendingCellFocus.get(view);
  if (pending !== undefined) pending.from = changes.mapPos(pending.from, 1);
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
  private clickEditCandidate: TableCellCoordinate | null = null;
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
    this.table = table;
    if (this.host !== null) this.host.dataset.structuralSourceTableIndex = String(table.sourceTableIndex);
    this.updateSelection();
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
      if (target instanceof host.ownerDocument.defaultView!.Node && !host.contains(target)) this.clearSelection();
    }, { capture: true });
    host.addEventListener("focusout", (event) => {
      const next = event.relatedTarget;
      if (next === null || !(next instanceof host.ownerDocument.defaultView!.Node) || !host.contains(next)) {
        this.clearSelection();
      }
    });
    queueMicrotask(() => {
      const pending = pendingCellFocus.get(view);
      if (!host.isConnected || pending === undefined || pending.from !== this.table.range.from
        || pending.source !== this.table.source || pending.sourcePath !== this.sourcePath) return;
      pendingCellFocus.delete(view);
      if (pending.axisSelection !== undefined) this.focusAxis(pending.axisSelection);
      else if (pending.edit) {
        this.beginCellEdit(view, pending.coordinate);
        this.cellElement(pending.coordinate)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      } else if (pending.selectionBounds !== undefined) {
        this.selectBounds(pending.selectionBounds.first, pending.selectionBounds.last);
        this.cellElement(pending.coordinate)?.focus({ preventScroll: true });
      } else this.focusCellAfterUpdate(view, pending.coordinate);
    });
    return host;
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
    const nativeCallout = this.host?.closest(".callout") != null;
    if (redo) editor.redo();
    else editor.undo();
    if (nativeCallout) {
      const table = parseEditableTables(view.state.doc.toString()).tables.find((candidate) => candidate.range.from === this.table.range.from);
      if (table !== undefined) this.restoreCalloutFocus(view, table.source, coordinate, false, true);
    } else queueMicrotask(() => this.focusCellAfterUpdate(view, coordinate));
    return true;
  }

  private restoreCalloutFocus(view: EditorView, source: string, coordinate: TableCellCoordinate,
    edit: boolean, reveal = false): void {
    const table = parseEditableTables(view.state.doc.toString()).tables.find((candidate) =>
      candidate.range.from === this.table.range.from && candidate.source === source);
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
    const offset = tableCellSourceOffset(view.state.doc.toString(), this.table, coordinate);
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
      if (!view.dom.isConnected) return;
      const current = reparseUnchangedTable(view.state.doc.toString(), this.table);
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
    const anchor = this.table.rows[coordinate.row]?.cells[coordinate.column];
    if (anchor === undefined) return false;
    const rtl = this.renderedTable?.ownerDocument.defaultView?.getComputedStyle(this.renderedTable).direction === "rtl";
    let target: TableCellCoordinate | null = null;
    if (event.key === "ArrowUp") {
      target = { row: anchor.anchorRow - 1, column: anchor.anchorColumn };
    } else if (event.key === "ArrowDown") {
      target = { row: anchor.anchorRow + anchor.rowSpan, column: anchor.anchorColumn };
    } else if (event.key === (rtl ? "ArrowRight" : "ArrowLeft")) {
      target = { row: anchor.anchorRow, column: anchor.anchorColumn - 1 };
    } else if (event.key === (rtl ? "ArrowLeft" : "ArrowRight")) {
      target = { row: anchor.anchorRow, column: anchor.anchorColumn + anchor.columnSpan };
    } else if (event.key === "Home") {
      target = { row: anchor.anchorRow, column: 0 };
    } else if (event.key === "End") {
      target = { row: anchor.anchorRow, column: this.table.columnCount - 1 };
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const element = target.row < 0 || target.row >= this.table.rows.length
      || target.column < 0 || target.column >= this.table.columnCount
      ? null
      : this.cellElement(target);
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
      this.clickEditCandidate = coordinate;
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
    if (coordinate === null || coordinate.row !== candidate.row || coordinate.column !== candidate.column) return;
    event.preventDefault();
    event.stopPropagation();
    this.beginCellEdit(view, coordinate);
  }

  private updateSelection(): void {
    const anchor = this.selectionAnchor;
    const head = this.selectionHead;
    if (anchor === null || head === null || this.renderedTable === null) return;
    this.selection = anchor.row === head.row && anchor.column === head.column
      ? structuralTableSelectionFromCoordinates(this.table, [anchor])
      : structuralTableSelectionFromBounds(this.table, anchor, head);
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

  private clearSelection(): void {
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
    const selection = this.selection;
    if (selection === null) return;
    const menu = Menu.forEvent(event);
    this.selectionMenuOpen = true;
    menu.onHide(() => { this.selectionMenuOpen = false; });
    const t = createTranslator(this.getSettings().language);
    const info = view.state.field(editorInfoField, false);
    const sourceCoordinate = this.selectionAnchor ?? { row: selection.minRow, column: selection.minColumn };
    menu.addItem((item) => item
      .setSection("structural-tables-source")
      .setTitle(t("menu.editSource"))
      .setIcon("file-pen-line")
      .onClick(() => this.focusTableSource(view, sourceCoordinate)));
    menu.addItem((item) => item.setTitle(t("menu.copyWholeHtml")).setIcon("copy").onClick(() => {
      const current = reparseUnchangedTable(view.state.doc.toString(), this.table);
      if (current === null) { new Notice(t("notice.staleTable")); return; }
      void renderTableClipboard(this.app, current, this.sourcePath, this.getSettings().appearance)
        .then(({ html, text }) => copyHtml(html, text))
        .then(() => { new Notice(t("notice.copied").replace("{format}", "HTML")); })
        .catch(() => { new Notice(t("notice.clipboardFailed")); });
    }));
    if (this.promote !== undefined && info?.editor !== undefined) {
      addBasePromotionMenuItem(menu, t, this.table, () => this.promote?.(info.editor!, () => view.dom.isConnected ? view.state.field(editorInfoField, false) ?? null : null, this.table));
    }
    const menuOptions = { fullEditor: true, explicitRemoval: true } as const;
    if (!hasSelectionMenuItems(selection, menuOptions)) return;
    addSelectionMenuItems(
      menu,
      t,
      selection,
      (operation, intent) => this.applyMenuOperation(
        view,
        operation,
        undefined,
        intent === "owned-grid" ? this.axisSelection ?? undefined : undefined,
        intent,
      ),
      menuOptions,
    );
  }

  private cellElement(coordinate: TableCellCoordinate): HTMLElement | null {
    const cell = this.table.rows[coordinate.row]?.cells[coordinate.column];
    if (cell === undefined || this.renderedTable === null) return null;
    return this.renderedTable.querySelector<HTMLElement>(
      `[data-structural-row='${cell.anchorRow}'][data-structural-column='${cell.anchorColumn}']`,
    );
  }

  private beginCellEdit(view: EditorView, coordinate: TableCellCoordinate): void {
    this.axisSelection = null;
    this.touchAxisAnchor = null;
    const cell = this.table.rows[coordinate.row]?.cells[coordinate.column];
    const anchor = cell === undefined ? undefined : this.table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
    const element = anchor === undefined ? null : this.cellElement(anchor);
    if (anchor === undefined || element === null || element.querySelector(".structural-tables-cell-editor") !== null) return;
    this.syncSourceCursor(view, { row: anchor.row, column: anchor.column });
    const activeEditor = this.renderedTable?.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor");
    if (activeEditor != null) {
      activeEditor.blur();
      if (this.host === null) {
        queueMicrotask(() => this.openCellAfterUpdate(view, coordinate));
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
        if (next !== null) queueMicrotask(() => this.beginCellEdit(view, next));
        return;
      }
      const nativeCallout = this.host?.closest(".callout") != null;
      view.dispatch({
        changes: { from: current.range.from, to: current.range.to, insert: result.source },
        ...(nativeCallout ? tableWriteHistory(current, result.source, this.sourcePath, anchor) : {}),
        ...(focus && !nativeCallout ? { selection: { anchor: current.range.from + result.source.length } } : {}),
      });
      if (nativeCallout && (focus || next !== null)) this.restoreCalloutFocus(view, result.source, next ?? anchor, next !== null);
      else if (next !== null) queueMicrotask(() => this.openCellAfterUpdate(view, next));
      else if (focus) queueMicrotask(() => this.focusCellAfterUpdate(view, anchor));
    };
    this.finishActiveOperation = (operation, next) => {
      if (!composing) finish(true, next, true, operation);
    };

    const handleKey = (event: KeyboardEvent): void => {
      if (composing || event.isComposing || contextMenuOpen) return;
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
        finish(true);
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
      // Commit the draft before that insertion replaces the selected cell text.
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
        finish(true);
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
    editor.select();
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

  private openCellAfterUpdate(view: EditorView, coordinate: TableCellCoordinate): void {
    const interaction = this.interactionAfterUpdate(view);
    interaction?.beginCellEdit(view, coordinate);
    interaction?.cellElement(coordinate)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  private focusCellAfterUpdate(view: EditorView, coordinate: TableCellCoordinate): void {
    if (!view.dom.isConnected) return;
    const interaction = this.interactionAfterUpdate(view);
    const cell = interaction?.cellElement(coordinate);
    if (cell == null) {
      view.focus();
      return;
    }
    interaction?.selectBounds(coordinate, coordinate);
    interaction?.syncSourceCursor(view, coordinate);
    cell.focus({ preventScroll: true });
  }

  private focusSelectionAfterUpdate(
    view: EditorView,
    first: TableCellCoordinate,
    last: TableCellCoordinate,
    coordinate: TableCellCoordinate,
  ): void {
    if (!view.dom.isConnected) return;
    const interaction = this.interactionAfterUpdate(view);
    if (interaction === undefined) {
      view.focus();
      return;
    }
    interaction.selectBounds(first, last);
    interaction.syncSourceCursor(view, coordinate);
    const cell = interaction.cellElement(coordinate);
    if (cell === null) {
      view.focus();
      return;
    }
    interaction.setRovingCell(cell);
    cell.focus({ preventScroll: true });
  }

  private interactionAfterUpdate(view: EditorView): StructuralTableInteraction | undefined {
    const host = view.dom.querySelector<HTMLElement>(
      `[data-structural-source-table-index='${this.table.sourceTableIndex}']`,
    );
    return host === null ? undefined : interactions.get(host);
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
  ): void {
    const t = createTranslator(this.getSettings().language);
    if (intent === "owned-grid"
      && view.state.field(editorInfoField, false)?.file?.path !== this.sourcePath) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const current = reparseUnchangedTable(view.state.doc.toString(), this.table);
    if (current === null) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const selection = this.selection;
    const selectionAnchor = this.selectionAnchor;
    const selectionHead = this.selectionHead;
    const result = operation(current);
    if (!result.changed) {
      if (result.code !== "cells-cleared") new Notice(operationNotice(t, result.code));
      return;
    }

    const ownedGrid = intent === "owned-grid";
    const tableDeleted = result.code === "table-deleted";
    let coordinate = next ?? selectionAnchor ?? { row: 0, column: 0 };
    let restoredAxis = axisSelection;
    let restoredBounds = result.code === "cells-cleared"
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
    view.dispatch({
      changes: { from: current.range.from, to: current.range.to, insert: result.source },
      ...((nativeCallout || ownedGrid)
        ? tableWriteHistory(current, result.source, this.sourcePath, historyCoordinate) : {}),
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
        );
        const pending = pendingCellFocus.get(view);
        if (pending !== undefined && axisSelection !== undefined) pending.axisSelection = axisSelection;
      } else if (axisSelection !== undefined) {
        queueMicrotask(() => this.interactionAfterUpdate(view)?.focusAxis(axisSelection));
      } else if (next !== undefined) {
        queueMicrotask(() => this.openCellAfterUpdate(view, coordinate));
      } else {
        queueMicrotask(() => this.focusCellAfterUpdate(view, coordinate));
      }
      new Notice(operationNotice(t, result.code));
      return;
    }

    if (tableDeleted) {
      cancelPendingTableFocus(view);
      this.clearSelection();
      queueMicrotask(() => {
        if (!view.dom.isConnected) return;
        view.dispatch({ effects: structuralTableSourceFocus.of(true) });
        view.focus();
      });
    } else if (nativeCallout) {
      this.restoreCalloutFocus(view, result.source, coordinate, false);
      const pending = pendingCellFocus.get(view);
      if (pending !== undefined) {
        if (restoredAxis !== undefined) pending.axisSelection = restoredAxis;
        else if (restoredBounds !== undefined) pending.selectionBounds = restoredBounds;
      }
    } else if (restoredAxis !== undefined) {
      queueMicrotask(() => this.interactionAfterUpdate(view)?.focusAxis(restoredAxis));
    } else if (restoredBounds !== undefined) {
      queueMicrotask(() => this.focusSelectionAfterUpdate(
        view,
        restoredBounds.first,
        restoredBounds.last,
        coordinate,
      ));
    } else {
      queueMicrotask(() => this.focusCellAfterUpdate(view, coordinate));
    }
    new Notice(operationNotice(t, result.code));
  }
}
