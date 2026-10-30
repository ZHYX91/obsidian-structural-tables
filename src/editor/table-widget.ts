import { freezeGridSelection, currentFrozenTable, frozenSelectionBounds, copyFrozenRange, pasteFrozenRange,
  type FrozenGridSelection } from "./range-clipboard-session";
import { beginMouseRangeGesture, hasMouseRangeGesture } from "./mouse-range-gesture";
import { readCellClipboardData } from "./cell-clipboard-actions";
import { addTableSubmenu } from "./table-submenu";
import { TableMenuOwner, captureTableMenuGeneration, type TableMenuSession } from "./table-menu-session";
import { pasteLiteralCellText } from "../core/literal-cell-text";
import { CellDraftSession, type DraftHistoryGroup } from "./cell-draft-session";
import { pendingCellFocus, activeCellEditors, composingCellEditors, ownsCellEditorFocus, claimCellEditorFocus,
  releaseCellEditorFocus, focusNativeTable, requestNativeFocus, requestTableFocus, cancelPendingTableFocus,
  registerTableFocusHost, unregisterTableFocusHost, type PendingCellFocus, type CellEditEntryIntent } from "./table-focus-session";
export { restoreTableHistoryFocus, cancelPendingTableFocus, mapPendingTableFocus } from "./table-focus-session";
import type { BaseEditorInfo } from "../app/base-promotion-service";
import type { ExportTableImage } from "../app/table-image-modal";
import type { PreviewPlainGfm } from "../app/plain-gfm-modal";
import { captureEditorPlainGfmTarget } from "./plain-gfm-target";
import { requestWholeTableTranspose } from "../app/table-transpose-modal";
import { EditorView, WidgetType } from "@codemirror/view";
import { App, Component, Menu, Notice, Scope, editorInfoField, setIcon, type Editor, type TFile } from "obsidian";

import { createTranslator, operationNotice, withCount } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { adjacentTableCell, tableCellInDirection, tableCoordinateInDirection, type TableGridDirection } from "../core/table-navigation";
import { mathPipeSuggestions } from "../core/table-cell-syntax";
import { tableWriteHistory } from "./table-history";
import { textareaVisualExit, textareaCaretAtVisualEdge, hasComplexBidi } from "./textarea-visual-navigation";
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
import { reparseUnchangedTable, TableDocumentSnapshot } from "../core/table-snapshot";
import { validateTableOperationInDocument } from "../core/table-operation-document";
import { transposeTableInDocument } from "../core/table-transpose-validation";
import { parseEditableTables } from "../core/parser";
import {
  sameTableRangeTopology,
  TABLE_RANGE_CLIPBOARD_MIME,
  TABLE_RANGE_CLIPBOARD_WEB_MIME,
  TABLE_RANGE_HTML_ATTRIBUTE,
  tableRangePayload,
  type TableRangeClipboardPayloadV1,
} from "../core/table-range-clipboard";
import { renderStructuralTable, tableRenderingComplete } from "../rendering/table-renderer";
import { copyTableForWord, tableCopySession, type TableCopySession } from "../app/table-html-copy";
import { cellClipboardText } from "./table-interchange";
import {
  readTableRangeFromDataTransfer,
  writeTableRangeToDataTransfer,
} from "./table-range-clipboard";
import {
  addBasePromotionMenuItem,
  addImageExportMenuItem,
  addPlainGfmMenuItem,
  addSelectionEditingMenuItems,
  addSelectionRemovalMenuItems,
  addWholeTableTransposeMenuItem,
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
import { bindTableSourceSnapshot, tableCellSourceOffset } from "./table-source-binding";
import { structuralTableCellBlurCommit, structuralTableLogicalCursorSync, structuralTableSourceFocus, tableSourcePointerPending } from "./table-source-focus";

const TOUCH_DOUBLE_TAP_MAX_MS = 600;
const CLEAR_SELECTION_EVENT = "structural-tables-clear-selection";
const interactions = new WeakMap<HTMLElement, StructuralTableInteraction>();
const completedAxisPointers = new WeakSet<EditorView>();
interface CellCommitViewport {
  document: Document;
  editor: Editor | undefined;
  file: TFile | null | undefined;
  from: number;
  source: string;
  sourcePath: string;
  index: number;
  left: number;
  direction: string;
  doc: EditorView["state"]["doc"];
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
  private readonly copySession: TableCopySession;
  constructor(
    private readonly app: App,
    private readonly table: StructuralTable,
    private readonly sourcePath: string,
    private readonly settings: StructuralTablesSettings,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote?: (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable) => void,
    private readonly exportImage?: ExportTableImage,
    private readonly cellCommitGeometry?: { height: number; minHeight: number },
    private readonly previewGfm?: PreviewPlainGfm,
  ) { super(); this.copySession = tableCopySession(app); }

  override get estimatedHeight(): number {
    const height = this.cellCommitGeometry?.height;
    return height !== undefined && Number.isFinite(height) && height > 0 ? height : -1;
  }

  override eq(other: StructuralTableWidget): boolean {
    return this.table.source === other.table.source
      && this.table.range.from === other.table.range.from && this.table.range.to === other.table.range.to
      && this.table.sourceTableIndex === other.table.sourceTableIndex
      && this.sourcePath === other.sourcePath && samePresentation(this.settings, other.settings)
      && this.promote === other.promote && this.exportImage === other.exportImage && this.previewGfm === other.previewGfm
      && this.copySession === other.copySession;
  }

  override toDOM(view: EditorView): HTMLElement {
    const interaction = new StructuralTableInteraction(
      this.app, this.table, this.sourcePath, this.settings, this.getSettings, this.promote, this.exportImage, this.previewGfm, this.copySession,
    );
    const host = interaction.mount(view, this.cellCommitGeometry?.minHeight);
    interactions.set(host, interaction);
    registerTableFocusHost(host, (view, pending) => interaction.consumePendingFocus(view, pending));
    return host;
  }

  override updateDOM(host: HTMLElement): boolean {
    return interactions.get(host)?.rebind(this.table, this.sourcePath, this.settings, this.copySession) ?? false;
  }

  override destroy(host: HTMLElement): void {
    interactions.get(host)?.destroy();
    interactions.delete(host);
    unregisterTableFocusHost(host);
  }

  override ignoreEvent(): boolean { return true; }
}

class StructuralTableInteraction {
  private positionHandles: (() => void) | null = null;
  private preserveDraft: (() => void) | null = null;
  private cellScope: Scope | null = null;
  private navigationScope: Scope | null = null;
  private component: Component | null = null;
  private clickEditCandidate: { coordinate: TableCellCoordinate; caretOffset: number | null; endOffset?: number; x: number; y: number } | null = null;
  private dragging = false;
  private renderedTable: HTMLTableElement | null = null;
  private selection: StructuralTableSelection | null = null;
  private selectionAnchor: TableCellCoordinate | null = null;
  private selectionHead: TableCellCoordinate | null = null;
  private touchRangeAnchor: TableCellCoordinate | null = null;
  private lastTouchTap: { coordinate: TableCellCoordinate; at: number } | null = null;
  private touchPointerId: number | undefined;
  private pointerWindow: Window | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private host: HTMLElement | null = null;
  private finishActiveGrid: ((first: TableCellCoordinate, last: TableCellCoordinate) => boolean) | null = null;
  private finishActiveDraft: (() => boolean) | null = null;
  private finishActiveOperation: ((operation: TableOperation, next: TableCellCoordinate, axis?: AxisSelection) => void) | null = null;
  private axisSelection: AxisSelection | null = null;
  private axisAnchor = 0;
  private touchAxisAnchor: { axis: TableAxis; index: number } | null = null;
  private axisDrag: TableAxisDrag | null = null;
  private axisPreview: { selection: AxisSelection; index: number; anchor: number;
    pointerId: number; touchAnchor: { axis: TableAxis; index: number } | null; restore: () => void; complete: () => void } | null = null;
  private cancelledAxisClick = false;
  private selectionMenuOpen = false;
  private selectionMenuSession: FrozenGridSelection | null = null;
  private selectionEpoch = 0;
  private menuOwner: TableMenuOwner | null = null;
  private onMenuPointerAway: ((event: PointerEvent) => void) | null = null;

  constructor(
    private readonly app: App,
    private table: StructuralTable,
    private readonly sourcePath: string,
    private readonly settings: StructuralTablesSettings,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote?: (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable) => void,
    private readonly exportImage?: ExportTableImage,
    private readonly previewGfm?: PreviewPlainGfm,
    private readonly copySession = tableCopySession(app),
  ) {}

  restoreCellCommitViewport(view: EditorView, snapshot: CellCommitViewport): void {
    const host = this.host; const rendered = this.renderedTable;
    const scroller = rendered?.closest<HTMLElement>(".structural-tables-container");
    if (host === null || rendered === null || scroller == null || this.component === null) return;
    let active = true;
    const cleanup = (): void => {
      active = false;
      for (const type of ["pointerdown", "keydown", "beforeinput", "wheel"]) snapshot.document.removeEventListener(type, cleanup, true);
      scroller.removeEventListener("scroll", cleanup);
    };
    const isCurrent = (): boolean => {
      const info = view.state.field(editorInfoField, false);
      return active && this.host === host && host.isConnected && view.dom.isConnected
        && view.dom.ownerDocument === snapshot.document && view.contentDOM.ownerDocument === snapshot.document && host.ownerDocument === snapshot.document
        && view.contentDOM.contains(host) && host.closest(".cm-editor") === view.dom
        && rendered.isConnected && scroller.isConnected && host.contains(scroller) && scroller.contains(rendered)
        && view.state.doc === snapshot.doc && info?.editor === snapshot.editor && info?.file === snapshot.file
        && info?.file?.path === snapshot.sourcePath && this.sourcePath === snapshot.sourcePath
        && this.table.range.from === snapshot.from && this.table.source === snapshot.source && this.table.sourceTableIndex === snapshot.index
        && scroller.ownerDocument.defaultView?.getComputedStyle(scroller).direction === snapshot.direction;
    };
    if (!isCurrent()) return;
    this.component.register(cleanup);
    for (const type of ["pointerdown", "keydown", "beforeinput", "wheel"]) snapshot.document.addEventListener(type, cleanup, true);
    scroller.addEventListener("scroll", cleanup);
    // A cell commit replaces its widget. Restore only this exact replacement,
    // after asynchronous cell rendering has supplied its real scroll width.
    void tableRenderingComplete(rendered).then(() => {
      if (!isCurrent()) { cleanup(); return; }
      view.requestMeasure({ read: isCurrent, write: (current) => {
        if (!current || !isCurrent()) { cleanup(); return; }
        cleanup(); scroller.scrollLeft = snapshot.left;
      } });
    }).catch(cleanup);
  }

  rebind(table: StructuralTable, sourcePath: string, settings: StructuralTablesSettings, copySession: TableCopySession): boolean {
    if (this.copySession !== copySession || this.table.source !== table.source || this.sourcePath !== sourcePath
      || !samePresentation(this.settings, settings)) return false;
    const sameSourceIdentity = this.table.range.from === table.range.from
      && this.table.range.to === table.range.to
      && this.table.sourceTableIndex === table.sourceTableIndex;
    this.table = table;
    if (this.host !== null && !sameSourceIdentity) bindTableSourceSnapshot(this.host, table, sourcePath);
    this.updateSelection(!sameSourceIdentity);
    return true;
  }

  mount(view: EditorView, cellCommitHeight?: number): HTMLElement {
    this.component = new Component();
    this.component.load();
    const host = view.dom.ownerDocument.createElement("div");
    if (cellCommitHeight !== undefined && Number.isFinite(cellCommitHeight) && cellCommitHeight > 0) host.style.minHeight = `${cellCommitHeight}px`;
    host.className = "structural-tables-live-preview";
    host.dataset.layout = this.settings.layout;
    host.dataset.appearance = this.settings.appearance;
    host.dataset.density = this.settings.density;
    host.dataset.zebra = String(this.settings.zebraRows);
    host.dataset.tableKind = this.table.structural ? "structural" : "ordinary";
    bindTableSourceSnapshot(host, this.table, this.sourcePath);
    this.host = host;
    const menuOwner = new TableMenuOwner(this.app, host.ownerDocument);
    this.menuOwner = menuOwner;
    this.component.register(() => menuOwner.dispose());
    const rendered = renderStructuralTable(this.app, this.table, host, this.sourcePath, this.component);
    if (host.style.minHeight !== "") {
      const component = this.component; const document = host.ownerDocument;
      const current = (): boolean => this.component === component && this.host === host && host.isConnected
        && host.ownerDocument === document && view.dom.ownerDocument === document && view.contentDOM.contains(host)
        && host.closest(".cm-editor") === view.dom;
      component.register(() => host.style.removeProperty("min-height"));
      // Empty asynchronous cells must not collapse the note while a native
      // pointer selection is being resolved. Release only after real content.
      void tableRenderingComplete(rendered).then(() => {
        const release = (): void => {
          if (this.component !== component || this.host !== host) return;
          host.style.removeProperty("min-height");
          // Re-measure after releasing a larger draft's temporary height. The
          // widget's style mutation alone is ignored by CodeMirror's observer.
          queueMicrotask(() => { if (current()) view.requestMeasure(); });
        };
        if (current()) view.requestMeasure({ read: current, write: release });
        else release();
      });
    }
    const gutter = rendered.createCaption();
    gutter.className = "structural-tables-control-gutter";
    gutter.setAttribute("aria-hidden", "true");
    this.installInteraction(view, host, rendered);
    host.addEventListener(CLEAR_SELECTION_EVENT, () => this.clearSelection());
    host.addEventListener("focusin", () => host.classList.add("is-add-controls-active"));
    this.component.registerDomEvent(host.ownerDocument, "pointerdown", (event) => {
      this.onMenuPointerAway?.(event);
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
    if (pending.axisSelection !== undefined) {
      if (pending.axisFocus?.isCurrent?.() === false) { pending.axisFocus.onReady?.(); return true; }
      this.focusAxis(pending.axisSelection, pending.axisFocus);
      pending.axisFocus?.onReady?.();
    }
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
    this.axisPreview = null;
    this.preserveDraft?.();
    this.preserveDraft = null;
    this.axisDrag?.destroy();
    this.axisDrag = null;
    this.finishActiveOperation = null;
    this.finishActiveGrid = null;
    this.finishActiveDraft = null;
    this.releaseCellScope();
    this.releaseNavigationScope();
    this.pointerWindow?.removeEventListener("pointerup", this.endPointerSelection);
    this.pointerWindow?.removeEventListener("pointercancel", this.cancelPointerSelection);
    this.pointerWindow?.removeEventListener("blur", this.abortPointerSelection);
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
    this.touchPointerId = undefined;
    this.component?.unload();
    this.component = null;
    this.menuOwner = null;
    this.onMenuPointerAway = null;
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
    rendered.addEventListener("pointerover", (event) => this.extendPointerSelection(event, view));
    rendered.addEventListener("pointermove", (event) => {
      this.revealHandlesForPointer(event);
      this.extendTextSelection(event);
    });
    rendered.addEventListener("click", (event) => this.openCellOnDesktopClick(event, view));
    host.addEventListener("copy", (event) => { this.handleRangeCopyCut(event, view, false); });
    host.addEventListener("cut", (event) => { this.handleRangeCopyCut(event, view, true); });
    host.addEventListener("paste", (event) => { this.handleRangePaste(event, view); });
    rendered.addEventListener("contextmenu", (event) => this.openContextMenu(event, view));
    rendered.addEventListener("dblclick", (event) => {
      if (event.target !== null && "closest" in event.target
        && (event.target as Element).closest("textarea, input, a, button") !== null) return;
      const coordinate = this.coordinateFor(event.target);
      if (coordinate === null) return;
      event.preventDefault();
      event.stopPropagation();
      const offset = this.renderedCaretOffset(event, coordinate);
      const raw = this.table.rows[coordinate.row]?.cells[coordinate.column]?.raw.trim() ?? "";
      this.openPointerCell(view, coordinate,
        offset === null ? { caretOffset: raw.length } : this.wordSelection(raw, offset), true);
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
    this.pointerWindow?.addEventListener("pointercancel", this.cancelPointerSelection);
    this.pointerWindow?.addEventListener("blur", this.abortPointerSelection);
  }

  private readonly endPointerSelection = (event: PointerEvent): void => {
    const preview = this.axisPreview;
    if (preview !== null && preview.pointerId === event.pointerId) {
      const handle = this.host?.querySelector<HTMLElement>(`[data-structural-${preview.selection.axis}-handle='${preview.index}']`);
      const rect = handle?.getBoundingClientRect();
      if (rect !== undefined && rect.width > 0 && rect.height > 0
        && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) this.rollbackAxisPreview();
      else preview.complete();
    }
    this.dragging = false;
    if (event.pointerId === this.touchPointerId) this.touchPointerId = undefined;
  };

  private readonly cancelPointerSelection = (event: PointerEvent): void => {
    this.rollbackAxisPreview();
    this.dragging = false;
    this.clickEditCandidate = null;
    if (this.touchPointerId !== undefined && event.pointerId === this.touchPointerId) this.abortPointerSelection();
  };

  private readonly abortPointerSelection = (): void => {
    this.rollbackAxisPreview();
    this.dragging = false;
    this.clickEditCandidate = null;
    this.touchPointerId = undefined;
    this.lastTouchTap = null;
    // Keep the completed visual range available to its long-press menu, but a
    // canceled pan must not become the first half of a later double tap.
    this.touchRangeAnchor = null;
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
    edit: boolean, reveal = false, from = this.table.range.from, entryIntent?: CellEditEntryIntent,
    selectionBounds?: PendingCellFocus["selectionBounds"], axis?: AxisSelection): void {
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
      ...(entryIntent === undefined ? {} : { entryIntent }),
      ...(selectionBounds === undefined ? {} : { selectionBounds }),
      ...(axis === undefined ? {} : { axisSelection: axis }),
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
    if (event.isPrimary && event.button === 2) {
      const target = event.target !== null && "closest" in event.target ? event.target as Element : null;
      // Native focus can scroll a different source caret into view between
      // right-button press and contextmenu, moving the clicked cell away.
      // Keep this gesture on its rendered target; contextmenu captures it.
      if (target?.closest("textarea, input, a, button") == null && this.coordinateFor(event.target) !== null) event.preventDefault();
      return;
    }
    if (!event.isPrimary || event.button !== 0) return;
    const targetElement = event.target !== null && "closest" in event.target ? event.target as Element : null;
    const link = targetElement?.closest("a") ?? null;
    if (link !== null && !event.altKey) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null) return;
    if (event.pointerType === "mouse") this.startMouseRangeGesture(event, view, coordinate);
    if (targetElement?.closest("textarea, input") != null) return;
    const activeDraft = activeCellEditors.get(this.renderedTable!.ownerDocument);
    if (activeDraft === undefined || !activeDraft.isConnected) this.syncSourceCursor(view, coordinate);
    this.axisSelection = null;
    this.touchAxisAnchor = null;
    if (event.pointerType === "touch") {
      this.touchPointerId = event.pointerId;
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
        this.openPointerCell(view, coordinate, { caretOffset: this.table.rows[coordinate.row]?.cells[coordinate.column]?.raw.trim().length ?? 0 });
        return;
      }
      this.startTouchSelection(coordinate);
      const cell = this.cellElement(coordinate);
      if (activeDraft === undefined || !activeDraft.isConnected) cell?.focus({ preventScroll: true });
      return;
    }
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && (!event.altKey || link !== null)) {
      this.clickEditCandidate = {
        coordinate,
        caretOffset: this.renderedCaretOffset(event, coordinate),
        x: event.clientX, y: event.clientY,
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
    if (activeDraft === undefined || !activeDraft.isConnected) cell?.focus({ preventScroll: true });
  }

  private currentInteraction(view: EditorView): StructuralTableInteraction | null {
    for (const host of view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview")) {
      const current = interactions.get(host);
      if (current?.sourcePath === this.sourcePath && current.table.sourceTableIndex === this.table.sourceTableIndex
        && host.closest(".cm-editor") === view.dom) return current;
    }
    return null;
  }

  private startMouseRangeGesture(event: PointerEvent, view: EditorView, origin: TableCellCoordinate): void {
    const document = view.dom.ownerDocument;
    const file = view.state.field(editorInfoField, false)?.file;
    const editorIdentity = view.state.field(editorInfoField, false)?.editor;
    const before = this.selectionAnchor !== null && this.selectionHead !== null
      ? { first: this.selectionAnchor, last: this.selectionHead } : null;
    const current = (): StructuralTableInteraction | null => {
      const info = view.state.field(editorInfoField, false);
      return view.dom.isConnected && view.dom.ownerDocument === document && info?.file === file
        && info?.editor === editorIdentity && info?.file?.path === this.sourcePath ? this.currentInteraction(view) : null;
    };
    beginMouseRangeGesture(view, document, event, origin, {
      current: () => current() !== null,
      coordinate: (pointer) => {
        const owner = current();
        if (owner === null) return null;
        const target = document.elementFromPoint?.(pointer.clientX, pointer.clientY) ?? pointer.target;
        return owner.coordinateFor(target);
      },
      select: (first, last) => {
        const owner = current();
        if (owner === null) return false;
        if (owner.finishActiveGrid !== null && !owner.finishActiveGrid(first, last)) return false;
        const next = current();
        if (next !== null) {
          next.clickEditCandidate = null;
          next.dragging = false;
          next.selectBounds(first, last);
          document.getSelection()?.removeAllRanges();
          next.cellElement(first)?.focus({ preventScroll: true });
        }
        return true;
      },
      cancel: () => {
        const owner = current();
        if (owner === null) return;
        if (before === null) owner.clearSelection();
        else owner.selectBounds(before.first, before.last);
      },
    });
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

  private extendPointerSelection(event: PointerEvent, view: EditorView): void {
    if (hasMouseRangeGesture(view)) return;
    if (!this.dragging) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null || (coordinate.row === this.selectionHead?.row && coordinate.column === this.selectionHead.column)) return;
    event.preventDefault();
    this.clickEditCandidate = null;
    this.selectionHead = coordinate;
    this.updateSelection();
  }

  private extendTextSelection(event: PointerEvent): void {
    const candidate = this.clickEditCandidate;
    if (!this.dragging || candidate?.caretOffset == null || event.buttons !== 1) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate?.row !== candidate.coordinate.row || coordinate.column !== candidate.coordinate.column) return;
    if (Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) < 3) return;
    const offset = this.renderedCaretOffset(event, coordinate);
    if (offset !== null) candidate.endOffset = offset;
  }

  private openCellOnDesktopClick(event: MouseEvent, view: EditorView): void {
    const candidate = this.clickEditCandidate;
    this.clickEditCandidate = null;
    const element = event.target !== null && "closest" in event.target ? event.target as Element : null;
    if (candidate === null || element?.closest("textarea, input, button") != null
      || (element?.closest("a") != null && !event.altKey)) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null || coordinate.row !== candidate.coordinate.row
      || coordinate.column !== candidate.coordinate.column) return;
    event.preventDefault();
    event.stopPropagation();
    const raw = this.table.rows[coordinate.row]?.cells[coordinate.column]?.raw.trim() ?? "";
    const start = candidate.caretOffset ?? raw.length;
    this.openPointerCell(view, coordinate, candidate.endOffset !== undefined && candidate.endOffset !== start
      ? { selectionStart: Math.min(start, candidate.endOffset), selectionEnd: Math.max(start, candidate.endOffset),
        selectionDirection: candidate.endOffset < start ? "backward" : "forward" }
      : { caretOffset: start, pointer: { x: event.clientX, y: event.clientY, at: event.timeStamp } });
  }

  /**
   * Resolve a complete click on the original DOM before blurring the old
   * textarea: its commit can replace this widget before pointerup/click.
   * The destination must be re-resolved against the new source and DOM.
   */
  private openPointerCell(view: EditorView, coordinate: TableCellCoordinate, entryIntent: CellEditEntryIntent, explicitSecondaryActivation = false): void {
    const document = this.renderedTable?.ownerDocument;
    if (document === undefined) return;
    const prior = activeCellEditors.get(document);
    if (prior !== undefined && prior.isConnected) {
      const sourcePath = this.sourcePath;
      const expectedIndex = this.table.sourceTableIndex;
      const expectedSource = this.table.source;
      const sameTable = this.host?.contains(prior) === true;
      prior.blur();
      // A single click may not silently abandon a rejected or composing
      // draft. A separate explicit double-click in another cell may continue
      // while keeping a rejected (noncomposing) draft recoverable.
      if (prior.isConnected && (composingCellEditors.has(prior) || !explicitSecondaryActivation)) return;
      if (prior.isConnected) {
        this.beginCellEdit(view, coordinate, entryIntent);
        return;
      }
      const destination = (): StructuralTable | undefined =>
        parseEditableTables(view.state.doc.toString()).tables.find((table) =>
          table.sourceTableIndex === expectedIndex && table.valid
          && (sameTable || table.source === expectedSource));
      const current = destination();
      if (current !== undefined && this.host?.isConnected && current.source === this.table.source
        && current.range.from === this.table.range.from) {
        // No replacement occurred: the second editor can open synchronously.
        this.beginCellEdit(view, coordinate, entryIntent);
        return;
      }
      if (!view.dom.isConnected || view.dom.ownerDocument !== document
        || view.state.field(editorInfoField, false)?.file?.path !== sourcePath) return;
      const remounted = destination();
      if (remounted !== undefined) requestTableFocus(view, {
        from: remounted.range.from, source: remounted.source, sourcePath,
        coordinate, edit: true, entryIntent,
      });
      return;
    }
    this.beginCellEdit(view, coordinate, entryIntent);
  }

  private wordSelection(raw: string, offset: number): CellEditEntryIntent {
    const word = /[\p{L}\p{N}_]/u;
    let start = offset; let end = offset;
    while (start > 0 && word.test(raw[start - 1]!)) start -= 1;
    while (end < raw.length && word.test(raw[end]!)) end += 1;
    return start === end ? { caretOffset: offset } : { selectionStart: start, selectionEnd: end };
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

  private freezeGridSelection(view: EditorView): FrozenGridSelection | null {
    return freezeGridSelection(view, { table: this.table, sourcePath: this.sourcePath, host: this.host,
      selection: this.selection, selectionAnchor: this.selectionAnchor, selectionHead: this.selectionHead,
      selectionEpoch: this.selectionEpoch, axisSelection: this.axisSelection });
  }

  private currentTableForFrozenSelection(view: EditorView, frozen: FrozenGridSelection, snapshot?: TableDocumentSnapshot): StructuralTable | null {
    return currentFrozenTable(view, frozen, this.host, this.selectionEpoch, snapshot);
  }

  private frozenBounds(frozen: FrozenGridSelection) { return frozenSelectionBounds(frozen); }

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
    const bounds = this.frozenBounds(frozen);
    const target = tableRangePayload(current, bounds);
    const anchored = bounds.minRow === bounds.maxRow && bounds.minColumn === bounds.maxColumn
      && (payload.rows > 1 || payload.columns > 1);
    if (target === null || (!anchored && !sameTableRangeTopology(target, payload))) {
      new Notice(createTranslator(this.getSettings().language)("notice.rangeClipboardUnsupported"));
      return true;
    }
    const pastedBounds = anchored ? {
      first: { row: bounds.minRow, column: bounds.minColumn },
      last: { row: bounds.minRow + payload.rows - 1, column: bounds.minColumn + payload.columns - 1 },
    } : undefined;
    this.applyMenuOperation(
      view, (table) => pasteTableRangeRaw(table, bounds, payload),
      undefined, frozen.axisSelection, "owned-grid", frozen, undefined, pastedBounds,
    );
    return true;
  }

  private handleRangeCopyCut(
    event: ClipboardEvent,
    view: EditorView,
    cut: boolean,
  ): boolean {
    if (event.defaultPrevented || this.clipboardEventOwner(event) !== this.host) return false;
    if (event.target !== null && "closest" in event.target
      && (event.target as Element).closest("textarea, input") !== null) return false;
    const frozen = this.freezeGridSelection(view);
    if (frozen === null || event.clipboardData === null) return false;
    event.preventDefault();
    event.stopPropagation();
    if (this.currentTableForFrozenSelection(view, frozen) === null) {
      new Notice(createTranslator(this.getSettings().language)("notice.staleTable"));
      return true;
    }
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
    if (event.defaultPrevented || this.clipboardEventOwner(event) !== this.host) return false;
    if (event.target !== null && "closest" in event.target
      && (event.target as Element).closest("textarea, input") !== null) return false;
    const frozen = this.freezeGridSelection(view);
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

  private clipboardEventOwner(event: ClipboardEvent): Element | null {
    return event.target !== null && "closest" in event.target
      ? (event.target as Element).closest(".structural-tables-live-preview") : null;
  }

  private copyFrozenSelection(view: EditorView, frozen: FrozenGridSelection, cut: boolean,
    isCurrent = (): boolean => true): Promise<void> {
    return copyFrozenRange(frozen, cut, () => isCurrent() && this.clearFrozenSelection(view, frozen), createTranslator(this.getSettings().language));
  }

  private pasteFrozenSelectionFromNavigator(view: EditorView, frozen: FrozenGridSelection,
    isCurrent = (): boolean => true): Promise<void> {
    return pasteFrozenRange(frozen, (payload) => isCurrent() && this.pasteFrozenSelection(view, frozen, payload), createTranslator(this.getSettings().language));
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
    event.preventDefault();
    event.stopPropagation();
    const prior = activeCellEditors.get(view.dom.ownerDocument);
    if (prior?.isConnected && this.host?.contains(prior) !== true) {
      const priorHost = prior.closest<HTMLElement>(".structural-tables-live-preview");
      const priorOwner = priorHost === null ? undefined : interactions.get(priorHost);
      if (priorHost?.closest(".cm-editor") !== view.dom || priorOwner?.finishActiveDraft == null
        || !priorOwner.finishActiveDraft()) return;
      const next = this.currentInteraction(view);
      if (next !== null) {
        next.selectBounds(coordinate, coordinate);
        next.cellElement(coordinate)?.focus({ preventScroll: true });
        next.showSelectionMenu(view, Menu.forEvent(event));
      }
      return;
    }
    const priorRange = this.selectionAnchor !== null && this.selectionHead !== null && this.isCellSelected(coordinate)
      ? { first: this.selectionAnchor, last: this.selectionHead } : { first: coordinate, last: coordinate };
    if (this.finishActiveGrid !== null && !this.finishActiveGrid(priorRange.first, priorRange.last)) return;
    const owner = this.currentInteraction(view);
    if (owner !== null && owner !== this) {
      owner.selectBounds(priorRange.first, priorRange.last);
      owner.cellElement(coordinate)?.focus({ preventScroll: true });
      owner.showSelectionMenu(view, Menu.forEvent(event));
      return;
    }
    this.syncSourceCursor(view, coordinate);
    this.touchRangeAnchor = null;
    this.lastTouchTap = null;
    if (!this.isCellSelected(coordinate)) {
      this.selectionAnchor = coordinate;
      this.selectionHead = coordinate;
      this.updateSelection();
    }
    this.showSelectionMenu(view, Menu.forEvent(event));
  }

  private showSelectionMenu(view: EditorView, menu: Menu): void {
    const frozen = this.freezeGridSelection(view);
    if (frozen === null) return;
    const selection = frozen.selection;
    this.selectionMenuSession = frozen;
    this.selectionMenuOpen = true;
    const menuSession = this.menuOwner?.open(menu);
    if (menuSession == null) return;
    menuSession.onHide(() => {
      if (this.selectionMenuSession !== frozen) return;
      this.selectionMenuOpen = false;
      queueMicrotask(() => {
        if (this.selectionMenuSession !== frozen) return;
        this.selectionMenuSession = null;
        this.clearSelection();
      });
    });
    const t = createTranslator(this.getSettings().language);
    const protectedDraft = (): boolean => {
      const editor = this.host?.querySelector<HTMLTextAreaElement>("textarea.structural-tables-cell-editor");
      if (editor == null) return false;
      const coordinate = this.coordinateFor(editor);
      const cell = coordinate === null ? undefined : this.table.rows[coordinate.row]?.cells[coordinate.column];
      return composingCellEditors.has(editor) || cell === undefined || editor.value !== cell.raw.trim();
    };
    const clipboardCurrent = (): boolean => menuSession.isCurrent() && !protectedDraft();
    const activate = (action: () => void): void => {
      if (this.selectionMenuSession !== frozen || !menuSession.canActivate()) {
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
    const activateClipboard = (action: () => void): void => activate(() => {
      if (protectedDraft()) { new Notice(t("menu.finishEditing")); return; }
      action();
    });
    const info = view.state.field(editorInfoField, false);
    const sourceCoordinate = frozen.anchor;
    const direction = this.renderedTable?.ownerDocument.defaultView?.getComputedStyle(this.renderedTable).direction === "rtl" ? "rtl" : "ltr";
    const menuOptions = { fullEditor: true, explicitRemoval: true, direction,
      defaultSourceSyntax: this.getSettings().defaultSourceSyntax } as const;
    const applySelectionOperation = (operation: TableOperation, intent?: TableOperationIntent): void => activate(() => {
      if (this.finishActiveOperation !== null) {
        this.finishActiveOperation(operation, frozen.anchor, frozen.axisSelection);
        return;
      }
      this.applyMenuOperation(view, operation, undefined,
        frozen.axisSelection, intent, frozen);
    });
    menu.addItem((item) => item
      .setSection("structural-tables-clipboard")
      .setIcon("copy")
      .setTitle(t("menu.copySelection"))
      .onClick(() => activateClipboard(() => { void this.copyFrozenSelection(view, frozen, false, clipboardCurrent); })));
    menu.addItem((item) => item
      .setSection("structural-tables-clipboard")
      .setIcon("scissors")
      .setTitle(t("menu.cutSelection"))
      .onClick(() => activateClipboard(() => { void this.copyFrozenSelection(view, frozen, true, clipboardCurrent); })));
    menu.addItem((item) => item
      .setSection("structural-tables-clipboard")
      .setIcon("clipboard-paste")
      .setTitle(t("menu.pasteSelection"))
      .onClick(() => activateClipboard(() => { void this.pasteFrozenSelectionFromNavigator(view, frozen, clipboardCurrent); })));
    menu.addItem((item) => item.setSection("structural-tables-clipboard").setIcon("clipboard-paste")
      .setTitle(t("menu.pastePlainText")).setDisabled(new Set(selection.cells.map((cell) => `${cell.anchorRow}:${cell.anchorColumn}`)).size !== 1)
      .onClick(() => activateClipboard(() => {
        if (new Set(selection.cells.map((cell) => `${cell.anchorRow}:${cell.anchorColumn}`)).size !== 1) return;
        const initial = view.state.doc;
        void Promise.resolve().then(() => (frozen.host.ownerDocument.defaultView?.navigator.clipboard ?? navigator.clipboard).readText()).then((text) => {
          if (!clipboardCurrent() || view.state.doc !== initial || this.currentTableForFrozenSelection(view, frozen) === null) {
            new Notice(t("notice.staleTable")); return;
          }
          const literal = pasteLiteralCellText("", 0, 0, text);
          if (literal === null) { new Notice(t("notice.clipboardUnsupported")); return; }
          this.applyMenuOperation(view, (table) => editCellContent(table, frozen.anchor.row, frozen.anchor.column, literal),
            undefined, undefined, "owned-grid", frozen);
        }).catch(() => new Notice(t("notice.rangeClipboardReadFailed")));
      })));
    addSelectionEditingMenuItems(menu, t, selection, applySelectionOperation, menuOptions);
    // Whole-table confirmation outlives the grid selection. Snapshot the
    // editor/file/source, not its ephemeral selection epoch, for the modal.
    const editorIdentity = info?.editor;
    const fileIdentity = info?.file;
    const tableIdentity = frozen.selection.table;
    const ownerDocument = frozen.host.ownerDocument;
    const transposeRequest = {
      ownerDocument,
      draftRoot: frozen.host,
      isCurrent: (): boolean => {
        const currentInfo = view.state.field(editorInfoField, false);
        return view.dom.isConnected && this.host === frozen.host && frozen.host.isConnected
          && frozen.host.ownerDocument === ownerDocument && view.dom.ownerDocument === ownerDocument
          && view.contentDOM.ownerDocument === ownerDocument
          && this.sourcePath === frozen.sourcePath
          && currentInfo?.editor === editorIdentity && currentInfo?.file === fileIdentity
          && currentInfo?.file?.path === frozen.sourcePath
          && reparseUnchangedTable(view.state.doc.toString(), tableIdentity) !== null;
      },
      apply: (): void => this.applyMenuOperation(
        view, (current) => transposeTableInDocument(view.state.doc.toString(), current), undefined, undefined, "owned-grid", undefined, frozen.anchor,
      ),
    };
    addWholeTableTransposeMenuItem(menu, t, () => activate(() => requestWholeTableTranspose(
      this.app, t, tableIdentity, transposeRequest,
    )));
    if (this.previewGfm !== undefined && info?.editor !== undefined) {
      // The dialog can outlive this presentation widget during source-focus
      // changes. Its captured editor/file/source owns the write; the service
      // closes open dialogs when the plugin unloads.
      const gfmTarget = captureEditorPlainGfmTarget(this.app, info.editor, tableIdentity);
      addPlainGfmMenuItem(menu, t, () => activate(() => {
        if (gfmTarget === null) { new Notice(t("notice.staleTable")); return; }
        this.previewGfm?.(tableIdentity, gfmTarget);
      }));
    }
    menu.addItem((item) => item.setSection("structural-tables-output").setTitle(t("menu.copyWholeHtml")).setIcon("copy").onClick(() => activateClipboard(() => {
      void copyTableForWord(this.app, tableIdentity, this.getSettings().appearance, {
        sourcePath: frozen.sourcePath, direction,
        isCurrent: () => clipboardCurrent() && this.host === frozen.host && frozen.host.isConnected
          && view.dom.isConnected && view.dom.ownerDocument === ownerDocument
          && view.state.field(editorInfoField, false)?.editor === editorIdentity
          && view.state.field(editorInfoField, false)?.file === fileIdentity
          && fileIdentity?.path === frozen.sourcePath
          && reparseUnchangedTable(view.state.doc.toString(), tableIdentity) !== null,
      }, t, this.copySession);
    })));
    if (this.exportImage !== undefined) {
      addImageExportMenuItem(menu, t, () => activate(() => {
        const expected = this.table;
        this.exportImage?.(expected, this.sourcePath, () => view.dom.isConnected
          && view.state.field(editorInfoField, false)?.file?.path === this.sourcePath
          && reparseUnchangedTable(view.state.doc.toString(), expected) !== null, this.renderedTable ?? view.dom);
      }));
    }
    menu.addItem((item) => item
      .setSection("structural-tables-source")
      .setTitle(t("menu.editSource"))
      .setIcon("file-pen-line")
      .onClick(() => activate(() => this.focusTableSource(view, sourceCoordinate))));
    if (this.promote !== undefined && info?.editor !== undefined) {
      addBasePromotionMenuItem(menu, t, this.table, () => activate(() => this.promote?.(info.editor!, () => view.dom.isConnected ? view.state.field(editorInfoField, false) ?? null : null, this.table)));
    }
    addSelectionRemovalMenuItems(menu, t, selection, applySelectionOperation, menuOptions);
  }

  /**
   * Map DOM text into Markdown only if it is a unique literal substring.
   * This covers bold, italic, code, link labels and Unicode, including emoji.
   * Ambiguity, entity expansion and synthetic renderer output are not guessed.
   */
  private renderedCaretOffset(event: MouseEvent | PointerEvent, coordinate: TableCellCoordinate): number | null {
    const cell = this.table.rows[coordinate.row]?.cells[coordinate.column];
    const anchor = cell === undefined ? undefined : this.table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
    const element = anchor === undefined ? null : this.cellElement(anchor);
    const content = element?.querySelector<HTMLElement>(":scope > .structural-tables-cell-content") ?? null;
    if (anchor === undefined || content === null) return null;
    const owner = content.ownerDocument as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    const position = owner.caretPositionFromPoint?.(event.clientX, event.clientY);
    const node = position?.offsetNode;
    const offset = position?.offset;
    if (node === undefined || node.nodeType !== 3 || !content.contains(node)
      || offset === undefined) return null;
    const text = (node as Text).data;
    const raw = anchor.raw.trim();
    if (text === "" || offset < 0 || offset > text.length) return null;
    const decodeEntity = (value: string): string | null => {
      const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": "\u00a0" };
      if (Object.prototype.hasOwnProperty.call(named, value)) return named[value]!;
      if (!value.startsWith("&#")) return null;
      const hexadecimal = value[2]?.toLowerCase() === "x";
      const digits = value.slice(hexadecimal ? 3 : 2, -1);
      const point = Number.parseInt(digits, hexadecimal ? 16 : 10);
      return Number.isInteger(point) && point > 0 && point <= 0x10ffff
        && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : null;
    };
    const boundaries: Array<number | null> = [0];
    let projected = ""; let cursor = 0;
    const pushLiteral = (end: number): void => {
      while (cursor < end) {
        projected += raw[cursor]!;
        cursor += 1;
        boundaries.push(cursor);
      }
    };
    for (const match of raw.matchAll(/&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/gu)) {
      pushLiteral(match.index);
      const decoded = decodeEntity(match[0]);
      if (decoded === null) { pushLiteral(match.index + match[0].length); continue; }
      projected += decoded;
      for (let unit = 0; unit < decoded.length; unit += 1) {
        boundaries.push(unit === decoded.length - 1 ? match.index + match[0].length : null);
      }
      cursor = match.index + match[0].length;
    }
    pushLiteral(raw.length);
    const start = projected.indexOf(text);
    if (start < 0 || projected.indexOf(text, start + 1) >= 0) return null;
    return boundaries[start + offset] ?? null;
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
    this.selectionMenuSession = null;
    this.selectionMenuOpen = false;
    this.menuOwner?.dismiss();
    this.updateSelection();

    const draftFile = view.state.field(editorInfoField, false)?.file;
    const draftEditor = view.state.field(editorInfoField, false)?.editor;
    const draftHost = this.host;
    const draftDocument = element.ownerDocument;
    const ownsDraftTarget = (): boolean => view.dom.isConnected && view.dom.ownerDocument === draftDocument
      && draftHost !== null && this.host === draftHost && draftHost.isConnected
      && view.state.field(editorInfoField, false)?.file === draftFile
      && view.state.field(editorInfoField, false)?.editor === draftEditor
      && (draftFile == null || draftFile.path === this.sourcePath);
    const editor = element.ownerDocument.createElement("textarea");
    editor.className = "structural-tables-cell-editor";
    editor.dir = "auto";
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
    const draft = new CellDraftSession(editor);
    let contextMenuOpen = false;
    let contextMenuSession: TableMenuSession | null = null;
    let menuPointerAway = false;
    this.onMenuPointerAway = (event) => {
      if (contextMenuSession?.isVisible() && event.target !== editor) menuPointerAway = true;
    };
    const applyDraftMutation = (group: DraftHistoryGroup, mutate: () => void): void => {
      draft.mutate(group, mutate);
      resizeEditor();
      editor.focus({ preventScroll: true });
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
      composingCellEditors.delete(editor);
      releaseCellEditorFocus(editor);
    };
    const settle = (): void => {
      settled = true;
      this.onMenuPointerAway = null;
      composingCellEditors.delete(editor);
      releaseCellEditorFocus(editor);
      this.preserveDraft = null;
      this.finishActiveOperation = null;
    this.finishActiveGrid = null;
    this.finishActiveDraft = null;
      this.releaseCellScope(scope);
    };
    const retainDraft = (message: string): void => {
      draft.rejectedValue = editor.value;
      new Notice(message);
      queueMicrotask(() => {
        if (!settled && editor.isConnected && ownsCellEditorFocus(editor)) {
          editor.focus({ preventScroll: true });
        }
      });
    };
    const finish = (commit: boolean, next: TableCellCoordinate | null = null, focus = true, operation?: TableOperation, nextIntent: CellEditEntryIntent = "select-all",
      pastedBounds?: PendingCellFocus["selectionBounds"], axis?: AxisSelection): void => {
      if (settled) return;
      if (!commit) {
        settle();
        restore(focus);
        return;
      }
      if (!ownsDraftTarget()) { retainDraft(t("notice.staleTable")); return; }
      const snapshot = new TableDocumentSnapshot(view.state.doc.toString());
      const current = reparseUnchangedTable(snapshot, this.table);
      if (current === null) {
        retainDraft(t("notice.staleTable"));
        return;
      }
      const candidate = operation === undefined
        ? editCellContent(current, anchor.row, anchor.column, editor.value)
        : editCellAndTransform(current, anchor.row, anchor.column, editor.value, operation);
      // Cell-draft commits can also alter the complete-note parse boundary.
      // Validate the same full document as other structural write consumers.
      const result = validateTableOperationInDocument(snapshot, current, candidate);
      if (view.state.doc.toString() !== snapshot.source) {
        retainDraft(t("notice.staleTable"));
        return;
      }
      if (!result.changed && result.code !== "cell-edited") {
        // A refused external paste has no unsaved draft to protect. Keep the
        // unchanged editor usable, including its next single-click handoff.
        if (pastedBounds !== undefined && editor.value === anchor.raw.trim()) {
          new Notice(operationNotice(t, result.code));
          return;
        }
        retainDraft(operationNotice(t, result.code));
        return;
      }
      if (axis !== undefined && result.code === "rows-deleted") {
        const row = Math.max(0, Math.min(axis.start, current.rows.length - (axis.end - axis.start + 1) - 1));
        axis = { axis: "row", start: row, end: row };
        next = { row, column: Math.min(next?.column ?? 0, current.columnCount - 1) };
      } else if (axis !== undefined && result.code === "columns-deleted") {
        const column = Math.max(0, Math.min(axis.start, current.columnCount - (axis.end - axis.start + 1) - 1));
        axis = { axis: "column", start: column, end: column };
        next = { row: Math.min(next?.row ?? 0, current.rows.length - 1), column };
      }
      settle();
      if (!result.changed) {
        restore(focus);
        if (next !== null) requestTableFocus(view, {
          from: current.range.from, source: current.source, sourcePath: this.sourcePath, coordinate: next, edit: true, entryIntent: nextIntent,
        });
        return;
      }
      const nativeCallout = this.host?.closest(".callout") != null;
      const tableDeleted = result.code === "table-deleted";
      const scroller = element.closest<HTMLElement>(".structural-tables-container");
      const info = view.state.field(editorInfoField, false);
      const hostStyle = this.host === null ? null : this.host.ownerDocument.defaultView?.getComputedStyle(this.host);
      const height = this.host?.getBoundingClientRect().height ?? 0;
      const minHeight = height
        - (hostStyle === null || hostStyle === undefined || hostStyle.boxSizing === "border-box" ? 0
          : [hostStyle.paddingTop, hostStyle.paddingBottom, hostStyle.borderTopWidth, hostStyle.borderBottomWidth].reduce((sum, value) => sum + (Number.parseFloat(value) || 0), 0));
      const viewport = !focus && next === null && !nativeCallout && scroller !== null ? {
        document: element.ownerDocument, editor: info?.editor, file: info?.file, from: current.range.from,
        source: result.source, sourcePath: this.sourcePath, index: current.sourceTableIndex, left: scroller.scrollLeft,
        direction: element.ownerDocument.defaultView?.getComputedStyle(scroller).direction ?? "ltr",
      } : null;
      const target: PendingCellFocus = {
        from: current.range.from, source: result.source, sourcePath: this.sourcePath,
        coordinate: next ?? anchor, edit: next !== null && axis === undefined, entryIntent: nextIntent,
        ...(pastedBounds === undefined ? {} : { selectionBounds: pastedBounds }),
        ...(axis === undefined ? {} : { axisSelection: axis }),
      };
      const history = tableWriteHistory(current, result.source, this.sourcePath,
        axis === undefined ? anchor : next ?? anchor,
        tableDeleted ? { restorePresentation: true } : axis === undefined ? {} : { undoCoordinate: anchor });
      const blurEffect = !focus && next === null && !nativeCallout
        ? structuralTableCellBlurCommit.of({
          from: current.range.from, before: current.source, after: result.source,
          sourcePath: this.sourcePath, height, minHeight,
        }) : null;
      view.dispatch({
        changes: { from: current.range.from, to: current.range.to, insert: result.source },
        effects: blurEffect === null ? history.effects : [history.effects, blurEffect],
        annotations: history.annotations,
        ...(focus && !nativeCallout ? { selection: { anchor: current.range.from + result.source.length } } : {}),
      });
      if (viewport !== null) {
        const snapshot = { ...viewport, doc: view.state.doc };
        queueMicrotask(() => {
          const hosts = [...view.dom.querySelectorAll<HTMLElement>(".structural-tables-live-preview")]
            .filter((host) => host.closest(".cm-editor") === view.dom && host.dataset.structuralSourceTableIndex === String(snapshot.index));
          if (hosts.length === 1) interactions.get(hosts[0]!)?.restoreCellCommitViewport(view, snapshot);
        });
      }
      if (tableDeleted) requestNativeFocus(view, { ...target, edit: false });
      else if (nativeCallout && (focus || next !== null)) {
        this.restoreCalloutFocus(view, result.source, next ?? anchor, next !== null && axis === undefined,
          false, target.from, nextIntent, pastedBounds, axis);
      } else if (next !== null || focus) requestTableFocus(view, target);
    };
    this.finishActiveGrid = (first, last) => {
      if (draft.composing) return false;
      finish(true, null, true, undefined, "select-all", { first, last });
      return settled;
    };
    this.finishActiveDraft = () => {
      if (draft.composing) return false;
      finish(true, null, false);
      return settled;
    };
    this.finishActiveOperation = (operation, next, axis) => {
      if (!draft.composing) finish(true, next, true, operation, "select-all", undefined, axis);
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
      if (editor.value.includes("\n") || hasComplexBidi(editor.value)) return false;
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
      if (draft.composing || event.isComposing || contextMenuOpen) return;
      const noModifier = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      const collapsed = editor.selectionStart === editor.selectionEnd;
      const rtl = this.renderedTable?.ownerDocument.defaultView?.getComputedStyle(this.renderedTable).direction === "rtl";
      const backwardKey = rtl ? "ArrowRight" : "ArrowLeft";
      const forwardKey = rtl ? "ArrowLeft" : "ArrowRight";
      // Logical textarea offsets cannot establish a visual edge for mixed bidi
      // runs. Keep native text navigation there; Tab still moves between cells.
      const horizontalExit = !rtl && !/[\u0590-\u08ff\u200e-\u200f\u202a-\u202e\u2066-\u2069\ufb1d-\ufdff\ufe70-\ufeff]/u.test(editor.value);

      if (horizontalExit && noModifier && collapsed && event.key === backwardKey && editor.selectionStart === 0) {
        const previous = this.adjacentCell(anchor, "backward");
        if (previous !== null) {
          event.preventDefault();
          event.stopPropagation();
          finish(true, previous);
        }
        return;
      }
      if (horizontalExit && noModifier && collapsed && event.key === forwardKey && editor.selectionEnd === editor.value.length) {
        const next = this.adjacentCell(anchor, "forward");
        if (next !== null) {
          event.preventDefault();
          event.stopPropagation();
          finish(true, next);
        }
        return;
      }
      if (noModifier && collapsed && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        const direction = event.key === "ArrowUp" ? "up" : "down";
        const visual = textareaVisualExit(editor, direction);
        if (visual !== null || stableSingleVisualLine()) {
          const target = tableCellInDirection(this.table, anchor, direction);
          if (target !== null) {
            event.preventDefault();
            event.stopPropagation();
            const nextIntent: CellEditEntryIntent = visual === null
              ? { caretOffset: Math.min(editor.selectionStart, this.table.rows[target.row]?.cells[target.column]?.raw.trim().length ?? 0) }
              : { visual };
            finish(true, target, true, undefined, nextIntent);
          }
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
      if (draft.composing || event.isComposing || contextMenuOpen) return;
      handleKey(event);
      return false;
    });
    const registerDraftFormat = (key: "b" | "i", marker: "*" | "**"): void => {
      scope.register(["Mod"], key, (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (settled || draft.composing || event.isComposing || contextMenuOpen
          || !ownsCellEditorFocus(editor) || editor.ownerDocument.activeElement !== editor) return false;
        toggleDraftInlineFormat(marker);
        return false;
      });
    };
    registerDraftFormat("b", "**");
    registerDraftFormat("i", "*");
    const navigateDraftHistory = (redo: boolean, event: KeyboardEvent): void => {
      if (!draft.hasHistory && draft.pendingInput === null && editor.value === anchor.raw.trim()
        && reparseUnchangedTable(view.state.doc.toString(), this.table) !== null
        && view.state.field(editorInfoField, false)?.editor !== undefined) {
        finish(false, null, false);
        this.handleHistory(event, view, anchor);
        return;
      }
      event.preventDefault(); event.stopPropagation();
      if (draft.navigateHistory(redo)) { resizeEditor(); editor.focus({ preventScroll: true }); }
    };
    const registerDraftHistory = (
      modifiers: ("Mod" | "Ctrl" | "Shift")[], key: "z" | "y", redo: boolean,
    ): void => {
      scope.register(modifiers, key, (event) => {
        if (settled || draft.composing || event.isComposing || contextMenuOpen
          || !ownsCellEditorFocus(editor) || editor.ownerDocument.activeElement !== editor) return true;
        navigateDraftHistory(redo, event);
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
    editor.addEventListener("dblclick", (event) => {
      if (entryIntent === "select-all" || !("caretOffset" in entryIntent)
        || entryIntent.pointer === undefined || editor.value !== anchor.raw.trim()
        || draft.composing || event.timeStamp - entryIntent.pointer.at > TOUCH_DOUBLE_TAP_MAX_MS
        || Math.hypot(event.clientX - entryIntent.pointer.x, event.clientY - entryIntent.pointer.y) > 5) return;
      // The first click replaced rendered text with Markdown. Use its proven
      // source position for this double click, not the shifted textarea glyphs.
      const word = this.wordSelection(editor.value, entryIntent.caretOffset);
      if (word !== "select-all" && "selectionStart" in word) {
        event.preventDefault(); event.stopPropagation();
        editor.setSelectionRange(word.selectionStart, word.selectionEnd);
      }
    });
    editor.addEventListener("input", (event) => {
      draft.recordInput(event);
      resizeEditor();
    });
    editor.addEventListener("beforeinput", (event) => {
      // Soft keyboards can insert a line break before sending a useful keydown.
      // Use the same validated commit/navigation transaction as physical Enter.
      event.stopPropagation();
      if (event.defaultPrevented) return;
      // Gboard may replace the selection with an empty insertText before Enter.
      // Explicit deletion uses delete input types and must remain available.
      if (!draft.composing && !event.isComposing
        && event.inputType === "insertText" && event.data === ""
        && editor.selectionStart !== editor.selectionEnd) {
        event.preventDefault();
        return;
      }
      if (!draft.composing && !event.isComposing
        && (event.inputType === "insertLineBreak" || event.inputType === "insertParagraph")) {
        event.preventDefault();
        commitToNextRow();
        return;
      }
      draft.prepareInput(event);
    });
    const pasteClipboard = (event: ClipboardEvent): void => {
      if (event.clipboardData === null) return;
      const html = event.clipboardData?.getData("text/html") ?? "";
      const payload = readTableRangeFromDataTransfer(event.clipboardData, editor.ownerDocument);
      const owned = (event.clipboardData.types ?? []).some((type) => type === TABLE_RANGE_CLIPBOARD_MIME
        || type === TABLE_RANGE_CLIPBOARD_WEB_MIME) || html.includes(TABLE_RANGE_HTML_ATTRIBUTE);
      if (owned && payload === null) {
        event.preventDefault(); event.stopPropagation();
        new Notice(t("notice.rangeClipboardUnsupported"));
        return;
      }
      if (payload !== null && (payload.rows > 1 || payload.columns > 1)) {
        event.preventDefault(); event.stopPropagation();
        if (draft.composing || editor.value !== anchor.raw.trim() || draft.pendingInput !== null) {
          new Notice(t("notice.rangePasteDraft"));
          return;
        }
        const frozen = this.freezeGridSelection(view);
        if (frozen === null || this.currentTableForFrozenSelection(view, frozen) === null) {
          new Notice(t("notice.staleTable"));
          return;
        }
        const bounds = this.frozenBounds(frozen);
        // Validate and replace while the draft still owns focus. Closing it
        // first can remount the widget and invalidate the destination.
        finish(true, null, true, (table) => pasteTableRangeRaw(table, bounds, payload), "select-all", {
          first: { row: bounds.minRow, column: bounds.minColumn },
          last: { row: bounds.minRow + payload.rows - 1, column: bounds.minColumn + payload.columns - 1 },
        });
        return;
      }
      const result = cellClipboardText(html, event.clipboardData.getData("text/plain"));
      event.preventDefault();
      if (result.kind === "unsupported") {
        new Notice(t("notice.clipboardUnsupported"));
        return;
      }
      if (result.kind === "text" && result.fallback) new Notice(t("notice.clipboardPlainFallback"));
      const pasted = payload !== null ? payload.rawByOwner[payload.owners[0]![0]!]!
        : result.kind === "empty" ? "" : result.text;
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      // External HTML text has literal intent. Owned ranges keep their raw Markdown.
      const literal = html !== "" && payload === null
        ? pasteLiteralCellText(editor.value, start, end, pasted) : undefined;
      if (literal === null) { new Notice(t("notice.clipboardUnsupported")); return; }
      applyDraftMutation("paste", () => {
        if (literal === undefined) editor.setRangeText(pasted, start, end, "end");
        else {
          const inserted = literal.length - editor.value.length + end - start;
          editor.value = literal;
          editor.setSelectionRange(start + inserted, start + inserted);
        }
      });
    };
    editor.addEventListener("paste", pasteClipboard);
    editor.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      contextMenuOpen = true;
      const menu = Menu.forEvent(event);
      const menuSession = this.menuOwner?.open(menu);
      if (menuSession == null) return;
      contextMenuSession = menuSession;
      menuPointerAway = false;
      const snapshot = draft.snapshot();
      const sourceAtOpen = view.state.doc;
      const currentDraft = (): boolean => contextMenuSession === menuSession && menuSession.isCurrent()
        && !settled && !draft.composing && editor.isConnected && ownsDraftTarget()
        && view.state.doc === sourceAtOpen && editor.value === snapshot.value
        && editor.selectionStart === snapshot.start && editor.selectionEnd === snapshot.end;
      const activate = (action: () => void): void => {
        if (!menuSession.canActivate() || !currentDraft()) return;
        menuPointerAway = false;
        action();
      };
      menu.addItem((item) => item
        .setSection("structural-tables-cell")
        .setIcon("corner-down-left")
        .setTitle(t("menu.insertCellBreak"))
        .onClick(() => activate(() => insertBreak(start, end))));
      const clipboard = editor.ownerDocument.defaultView?.navigator.clipboard ?? navigator.clipboard;
      const item = (key: Parameters<typeof t>[0], icon: string, action: () => void): void => {
        menu.addItem((entry) => entry.setSection("structural-tables-cell-edit").setTitle(t(key)).setIcon(icon)
          .setDisabled(draft.composing).onClick(() => activate(action)));
      };
      item("menu.undo", "undo", () => navigateDraftHistory(false, new KeyboardEvent("keydown", { key: "z", ctrlKey: true, cancelable: true })));
      item("menu.redo", "redo", () => navigateDraftHistory(true, new KeyboardEvent("keydown", { key: "y", ctrlKey: true, cancelable: true })));
      const copy = (cut: boolean): void => {
        void Promise.resolve().then(() => {
          if (!currentDraft()) return;
          return clipboard.writeText(snapshot.value.slice(snapshot.start, snapshot.end));
        }).then(() => {
          if (cut && currentDraft()) applyDraftMutation("deletion", () => editor.setRangeText("", snapshot.start, snapshot.end, "end"));
        }).catch(() => new Notice(t("notice.clipboardFailed")));
      };
      item("menu.cut", "scissors", () => copy(true));
      item("menu.copy", "copy", () => copy(false));
      const paste = (plain: boolean): void => {
        if (!plain) {
          void Promise.resolve().then(() => readCellClipboardData(clipboard)).then((data) => {
            if (!currentDraft()) { new Notice(t("notice.staleTable")); return; }
            pasteClipboard({ clipboardData: data, preventDefault: () => {}, stopPropagation: () => {} } as ClipboardEvent);
          }).catch(() => new Notice(t("notice.rangeClipboardReadFailed")));
          return;
        }
        void Promise.resolve().then(() => clipboard.readText()).then((text) => {
          if (!currentDraft()) { new Notice(t("notice.staleTable")); return; }
          const value = pasteLiteralCellText(snapshot.value, snapshot.start, snapshot.end, text);
          if (value === null) { new Notice(t("notice.clipboardUnsupported")); return; }
          const inserted = value.length - snapshot.value.length + snapshot.end - snapshot.start;
          applyDraftMutation("paste", () => { editor.value = value; editor.setSelectionRange(snapshot.start + inserted, snapshot.start + inserted); });
        }).catch(() => new Notice(t("notice.rangeClipboardReadFailed")));
      };
      item("menu.paste", "clipboard-paste", () => paste(false));
      item("menu.pastePlainText", "clipboard-paste", () => paste(true));
      item("menu.selectAll", "text-select", () => editor.select());
      item("menu.bold", "bold", () => toggleDraftInlineFormat("**"));
      item("menu.italic", "italic", () => toggleDraftInlineFormat("*"));
      item("menu.finishEditing", "check", () => finish(true));
      item("menu.cancelEditing", "x", () => finish(false));
      addTableSubmenu(menu, t("menu.tableOperations"), (submenu) => {
        const selection = structuralTableSelectionFromBounds(this.table, anchor, anchor);
        if (selection === null) return;
        const apply = (operation: TableOperation): void => {
          activate(() => finish(true, null, true, operation));
        };
        const direction = this.renderedTable?.ownerDocument.defaultView?.getComputedStyle(this.renderedTable).direction === "rtl" ? "rtl" : "ltr";
        const options = { fullEditor: true, explicitRemoval: true, direction,
          defaultSourceSyntax: this.getSettings().defaultSourceSyntax } as const;
        addSelectionEditingMenuItems(submenu, t, selection, apply, options);
        addSelectionRemovalMenuItems(submenu, t, selection, apply, options);
      }, (submenu, menuEvent) => {
        if (!menuSession.canActivate() || !currentDraft()) return;
        menuPointerAway = false;
        menuSession.showFallbackMenu(submenu, menuEvent);
      });
      const draftAtOpen = editor.value;
      for (const suggestion of mathPipeSuggestions(draftAtOpen)) {
        menu.addItem((item) => item
          .setSection("structural-tables-cell")
          .setIcon("replace")
          .setTitle(t(suggestion.kind === "absolute-value"
            ? "menu.useMathAbsoluteSuggestion" : "menu.useMathConditionalSuggestion"))
          .onClick(() => activate(() => {
            editor.value = suggestion.replacement;
            resizeEditor();
            finish(true);
          })));
      }
      menuSession.onHide(() => {
        // Menu dismissal can run before the same Escape reaches the app scope.
        // Keep the guard until that event has finished, then return to the draft.
        (editor.ownerDocument.defaultView ?? window).setTimeout(() => {
          if (contextMenuSession !== menuSession || menuSession.isVisible()) return;
          contextMenuOpen = false;
          if (!menuSession.isCurrent()) return;
          const document = editor.ownerDocument;
          const active = document.activeElement;
          if (!settled && ownsCellEditorFocus(editor) && !menuPointerAway
            && (active === editor || active === document.body || active === document.documentElement)) editor.focus({ preventScroll: true });
        }, 0);
      });
    });
    editor.addEventListener("compositionstart", (event) => {
      draft.composing = true;
      composingCellEditors.add(editor);
      event.stopPropagation();
    });
    editor.addEventListener("compositionend", (event) => {
      draft.composing = false;
      composingCellEditors.delete(editor);
      event.stopPropagation();
      resizeEditor();
      if (editor.ownerDocument.activeElement !== editor && !contextMenuOpen) {
        releaseCellEditorFocus(editor);
        finish(true, null, false);
      }
    });
    editor.addEventListener("blur", (event) => {
      if (this.axisPreview !== null) { this.releaseCellScope(scope); return; }
      const target = event.relatedTarget !== null && "closest" in event.relatedTarget ? event.relatedTarget as HTMLElement : null;
      const handle = target?.closest<HTMLElement>("[data-structural-row-handle], [data-structural-column-handle]");
      if (this.axisPreview === null && handle !== null && handle !== undefined && this.host?.contains(handle)) {
        const axis: TableAxis = handle.dataset.structuralRowHandle === undefined ? "column" : "row";
        const index = Number(axis === "row" ? handle.dataset.structuralRowHandle : handle.dataset.structuralColumnHandle);
        const selection = this.axisSelection?.axis === axis && index >= this.axisSelection.start && index <= this.axisSelection.end
          ? this.axisSelection : { axis, start: index, end: index };
        const focus = { index, anchor: selection === this.axisSelection ? this.axisAnchor : index, touchAnchor: null };
        const owner = this.completeAxisSelection(view, selection, focus);
        const source = view.state.doc;
        // Native focus completes after blur dispatch; the original target may
        // have been removed by the commit. Restore only that empty focus slot.
        queueMicrotask(() => {
          const document = owner?.host?.ownerDocument;
          if (owner !== null && view.state.doc === source && this.currentInteraction(view) === owner
            && document !== undefined && document.activeElement === document.body && !owner.selectionMenuOpen) owner.focusAxis(selection, focus);
        });
        return;
      }
      if (!contextMenuOpen && !draft.composing) releaseCellEditorFocus(editor);
      if (!draft.composing && !contextMenuOpen && draft.rejectedValue !== editor.value) {
        // Let the native pointer handler finish choosing its source destination
        // before a whole-table replacement maps the old logical cell cursor.
        if (tableSourcePointerPending(view)) {
          const document = editor.ownerDocument; const doc = view.state.doc;
          const host = this.host;
          const info = view.state.field(editorInfoField, false); const file = info?.file;
          const editorIdentity = info?.editor;
          const sourcePath = file?.path;
          queueMicrotask(() => {
            if (settled) return;
            const current = view.state.field(editorInfoField, false);
            if (view.state.doc !== doc || !view.dom.isConnected || view.dom.ownerDocument !== document
              || view.contentDOM.ownerDocument !== document || editor.ownerDocument !== document
              || host === null || this.host !== host || !view.contentDOM.contains(host) || host.closest(".cm-editor") !== view.dom || !host.contains(editor)
              || current?.editor !== editorIdentity || current?.file !== file || file?.path !== sourcePath || sourcePath !== this.sourcePath) {
              if (editor.value !== anchor.raw.trim()) retainCellDraft(this.app, { sourcePath: this.sourcePath, row: anchor.row, column: anchor.column, text: editor.value }, t);
              settle(); restore(false); return;
            }
            finish(true, null, false);
          });
        } else finish(true, null, false);
      }
      this.releaseCellScope(scope);
    });
    editor.focus({ preventScroll: true });
    if (entryIntent === "select-all") editor.select();
    else if ("selectionStart" in entryIntent) editor.setSelectionRange(entryIntent.selectionStart, entryIntent.selectionEnd, entryIntent.selectionDirection);
    else if ("caretOffset" in entryIntent) editor.setSelectionRange(entryIntent.caretOffset, entryIntent.caretOffset);
    else {
      const offset = textareaCaretAtVisualEdge(editor, entryIntent.visual)
        ?? (entryIntent.visual.edge === "first" ? 0 : editor.value.length);
      editor.setSelectionRange(offset, offset);
    }
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
        completedAxisPointers.add(view);
        const { axis, start, end } = selection;
        const movedStart = destination > end ? destination - (end - start + 1) : destination;
        const nextSelection = { axis, start: movedStart, end: movedStart + end - start };
        const operation: TableOperation = (table) => reorderTableAxis(table, axis, start, end, destination);
        const next = axis === "row" ? { row: movedStart, column: 0 } : { row: 0, column: movedStart };
        // The pointer was held through a cell draft. Commit text and the reorder
        // together instead of letting focus/blur discard this first drag.
        if (this.finishActiveOperation !== null) this.finishActiveOperation(operation, next, nextSelection);
        else this.applyMenuOperation(view, operation, next, nextSelection);
        if (this.finishActiveGrid !== null) this.rollbackAxisPreview();
        else this.axisPreview = null;
      }, (outcome) => { if (outcome === "cancel") this.rollbackAxisPreview(); });
    const ownerWindow = host.ownerDocument.defaultView;
    if (ownerWindow !== null) this.component?.registerDomEvent(ownerWindow, "keydown", (event) => {
      if (event.key !== "Escape" || this.axisPreview === null) return;
      event.preventDefault(); event.stopPropagation(); this.rollbackAxisPreview();
    }, { capture: true });
    const installAxisHandle = (handle: HTMLButtonElement, axis: TableAxis, index: number): void => {
      // Obsidian listens to touch events separately from pointer events for sidebar swipes.
      // Keep those gestures local to the handle without disabling its native long-press menu.
      for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"] as const) {
        handle.addEventListener(type, (event) => event.stopPropagation(), { passive: true });
      }
      handle.addEventListener("pointerdown", (event) => {
        if (event.isPrimary && event.button === 2) { event.preventDefault(); event.stopPropagation(); return; }
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.cancelledAxisClick = false;
        completedAxisPointers.delete(view);
        this.rollbackAxisPreview(false);
        const before = { anchor: this.selectionAnchor, head: this.selectionHead, axis: this.axisSelection,
          axisAnchor: this.axisAnchor, touchAnchor: this.touchAxisAnchor };
        const retainPreview = (): void => {
          if (this.finishActiveGrid === null || this.axisSelection === null) return;
          const selection = this.axisSelection;
          const focus = { index, anchor: this.axisAnchor, touchAnchor: this.touchAxisAnchor };
          const restore = (): void => {
              this.axisAnchor = before.axisAnchor;
              this.touchAxisAnchor = before.touchAnchor;
              this.axisSelection = before.axis;
              this.selectionAnchor = before.anchor;
              this.selectionHead = before.head;
              if (before.anchor === null || before.head === null) this.clearSelection();
              else this.updateSelection();
          };
          this.axisPreview = { selection, index, anchor: focus.anchor, touchAnchor: focus.touchAnchor, pointerId: event.pointerId, restore,
            complete: () => {
              this.axisPreview = null;
              completedAxisPointers.add(view);
              this.completeAxisSelection(view, selection, focus, restore);
            } };
        };
        if (this.axisDrag?.start(event, axis, index)) { retainPreview(); return; }
        const touchAnchor = event.pointerType === "touch" ? this.touchAxisAnchor : null;
        const extendTouch = touchAnchor?.axis === axis && touchAnchor.index !== index;
        if (extendTouch) this.axisAnchor = touchAnchor.index;
        else if (!event.shiftKey || this.axisSelection?.axis !== axis) this.axisAnchor = index;
        this.selectAxis({ axis, start: Math.min(this.axisAnchor, index), end: Math.max(this.axisAnchor, index) });
        this.touchAxisAnchor = event.pointerType === "touch" && !extendTouch ? { axis, index } : null;
        // Focusing the handle while a modified textarea is active synchronously
        // blurs and commits it, which destroys this drag controller mid-pointer.
        // Retain the live editor until drop; the drop callback combines edits.
        if (this.finishActiveOperation === null) {
          handle.focus({ preventScroll: true });
          this.activateAxisClearScope(view, handle, axis, index);
        }
        // Arm the new merge-closed selection on the same held pointer.
        if (!event.shiftKey && !extendTouch) this.axisDrag?.start(event, axis, index);
        retainPreview();
      });
      handle.addEventListener("click", (event) => {
        const consumed = this.axisDrag?.consumeClick();
        if (event.detail > 0 && (consumed || this.cancelledAxisClick || completedAxisPointers.has(view))) {
          completedAxisPointers.delete(view);
          this.rollbackAxisPreview(); this.cancelledAxisClick = false; return;
        }
        completedAxisPointers.delete(view);
        const preview = this.axisPreview;
        this.axisPreview = null;
        const selected = preview?.selection ?? (this.axisSelection?.axis === axis
          && index >= this.axisSelection.start && index <= this.axisSelection.end ? this.axisSelection : { axis, start: index, end: index });
        const owner = this.completeAxisSelection(view, selected,
          { index, anchor: preview?.anchor ?? (selected === this.axisSelection ? this.axisAnchor : index),
            touchAnchor: preview?.touchAnchor ?? this.touchAxisAnchor }, preview?.restore);
        if (owner === null) return;
      });
      handle.addEventListener("contextmenu", (event) => {
        completedAxisPointers.delete(view);
        event.preventDefault();
        event.stopPropagation();
        this.rollbackAxisPreview(false);
        const selection = this.axisSelection?.axis === axis && index >= this.axisSelection.start && index <= this.axisSelection.end
          ? this.axisSelection : { axis, start: index, end: index };
        const identity = view.state.field(editorInfoField, false);
        const document = host.ownerDocument;
        const file = identity?.file; const editorIdentity = identity?.editor; const sourcePath = this.sourcePath;
        const x = event.clientX; const y = event.clientY;
        let cleanup = (): void => {};
        let cancelled = false;
        let source: EditorView["state"]["doc"] | null = null;
        let menuCurrent = (): boolean => true;
        const current = (): boolean => {
          const info = view.state.field(editorInfoField, false);
          return !cancelled && view.dom.isConnected && view.dom.ownerDocument === document && view.state.doc === source
            && info?.file === file && info?.editor === editorIdentity && file?.path === sourcePath && menuCurrent();
        };
        const focus: NonNullable<PendingCellFocus["axisFocus"]> = { index,
          anchor: selection === this.axisSelection ? this.axisAnchor : index, touchAnchor: null,
          isCurrent: current, onReady: () => {
            cleanup();
            if (!current()) return;
            const live = this.currentInteraction(view);
            if (live === null) return;
            const menu = new Menu();
            live.showSelectionMenu(view, menu);
            menu.showAtPosition({ x, y }, document);
          } };
        const owner = this.completeAxisSelection(view, selection, focus);
        if (owner !== null) owner.showSelectionMenu(view, Menu.forEvent(event));
        else {
          const pending = pendingCellFocus.get(view);
          if (pending?.axisFocus !== focus) return;
          source = view.state.doc;
          menuCurrent = captureTableMenuGeneration(this.app, document);
          const invalidate = (): void => {
            cancelled = true;
            if (pendingCellFocus.get(view) === pending) cancelPendingTableFocus(view);
            cleanup();
          };
          const visibility = (): void => { if (document.hidden) invalidate(); };
          const window = document.defaultView;
          const timer = window?.setTimeout(invalidate, 5000);
          cleanup = () => {
            if (timer !== undefined) window?.clearTimeout(timer);
            document.removeEventListener("pointerdown", invalidate, true);
            document.removeEventListener("keydown", invalidate, true);
            document.removeEventListener("wheel", invalidate, true);
            document.removeEventListener("beforeinput", invalidate, true);
            document.removeEventListener("visibilitychange", visibility);
            window?.removeEventListener("blur", invalidate);
          };
          document.addEventListener("pointerdown", invalidate, true);
          document.addEventListener("keydown", invalidate, true);
          document.addEventListener("wheel", invalidate, true);
          document.addEventListener("beforeinput", invalidate, true);
          document.addEventListener("visibilitychange", visibility);
          window?.addEventListener("blur", invalidate);
        }
      });
    };
    const rowHandles = this.table.rows.map((_row, row) => {
      const handle = host.ownerDocument.createElement("button");
      handle.type = "button";
      handle.className = "structural-tables-row-handle";
      handle.dataset.structuralRowHandle = String(row);
      this.appendHandleIcon(handle, "grip-vertical");
      handle.setAttribute("aria-label", withCount(t("handle.row"), row + 1));
      handle.title = t("handle.dragHint");
      installAxisHandle(handle, "row", row);
      host.appendChild(handle);
      return handle;
    });
    const columnHandles = this.table.alignments.map((_alignment, column) => {
      const handle = host.ownerDocument.createElement("button");
      handle.type = "button";
      handle.className = "structural-tables-column-handle";
      handle.dataset.structuralColumnHandle = String(column);
      this.appendHandleIcon(handle, "grip-horizontal");
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
      addRow.style.top = `${scrollRect.bottom - hostRect.top}px`;
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
          `${tableRect.top - hostRect.top}px`,
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
    const OwnerResizeObserver = host.ownerDocument.defaultView?.ResizeObserver;
    if (OwnerResizeObserver !== undefined) {
      this.resizeObserver = new OwnerResizeObserver(positionHandles);
      this.resizeObserver.observe(rendered);
      if (scroller !== null) this.resizeObserver.observe(scroller, { box: "border-box" });
    }
  }

  private appendHandleIcon(handle: HTMLElement, icon: string): void {
    const decoration = handle.ownerDocument.createElement("span");
    decoration.className = "structural-tables-handle-icon";
    decoration.setAttribute("aria-hidden", "true");
    setIcon(decoration, icon);
    const svg = decoration.querySelector("svg");
    svg?.setAttribute("aria-hidden", "true");
    svg?.setAttribute("focusable", "false");
    svg?.setAttribute("tabindex", "-1");
    handle.appendChild(decoration);
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
        const axis: TableAxis = orientation === "vertical" ? "row" : "column";
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
        const axis: TableAxis = orientation === "vertical" ? "row" : "column";
        const selection = this.axisSelection?.axis === axis && targetIndex >= this.axisSelection.start && targetIndex <= this.axisSelection.end
          ? this.axisSelection : { axis, start: targetIndex, end: targetIndex };
        const owner = this.completeAxisSelection(view, selection,
          { index: targetIndex, anchor: selection === this.axisSelection ? this.axisAnchor : targetIndex, touchAnchor: null });
        const target = owner?.host?.querySelector<HTMLElement>(`[data-structural-${axis}-handle='${targetIndex}']`);
        const table = owner?.renderedTable;
        if (orientation === "horizontal" && table != null) {
          const scroller = table.closest<HTMLElement>(".structural-tables-container");
          if (scroller !== null) {
            const bounds = tableAxisBoundaries(table, "column", owner!.table.columnCount);
            const center = (bounds[targetIndex]! + bounds[targetIndex + 1]!) / 2;
            const rect = scroller.getBoundingClientRect();
            scroller.scrollLeft += center - Math.max(rect.left + 12, Math.min(rect.right - 12, center));
            owner!.positionHandles?.();
          }
        } else target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
        target?.focus({ preventScroll: true });
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

  private rollbackAxisPreview(cancelClick = true): void {
    const preview = this.axisPreview;
    if (preview === null) return;
    this.axisPreview = null;
    preview.restore();
    if (cancelClick) this.cancelledAxisClick = true;
  }

  private completeAxisSelection(view: EditorView, requested: AxisSelection,
    focus: NonNullable<PendingCellFocus["axisFocus"]>, restore?: () => void): StructuralTableInteraction | null {
    const first = requested.axis === "row" ? { row: requested.start, column: 0 } : { row: 0, column: requested.start };
    const last = requested.axis === "row" ? { row: requested.end, column: this.table.columnCount - 1 }
      : { row: this.table.rows.length - 1, column: requested.end };
    const bounds = structuralTableSelectionFromBounds(this.table, first, last);
    if (bounds === null) { restore?.(); return null; }
    const selection: AxisSelection = { axis: requested.axis, start: requested.axis === "row" ? bounds.minRow : bounds.minColumn,
      end: requested.axis === "row" ? bounds.maxRow : bounds.maxColumn };
    if (this.finishActiveGrid !== null && !this.finishActiveGrid(first, last)) {
      restore?.();
      const editor = this.host?.querySelector<HTMLTextAreaElement>("textarea.structural-tables-cell-editor");
      editor?.focus({ preventScroll: true });
      queueMicrotask(() => {
        if (editor?.isConnected && ownsCellEditorFocus(editor) && this.finishActiveGrid !== null) {
          const active = editor.ownerDocument.activeElement;
          if (active === editor.ownerDocument.body || active === editor || this.host?.contains(active)) editor.focus({ preventScroll: true });
        }
      });
      return null;
    }
    this.selectionMenuSession = null; this.selectionMenuOpen = false; this.menuOwner?.dismiss();
    const pending = pendingCellFocus.get(view);
    if (pending !== undefined && pending.from === this.table.range.from && pending.sourcePath === this.sourcePath) {
      pending.axisSelection = selection; pending.axisFocus = focus;
    }
    const owner = this.currentInteraction(view);
    if (owner !== null) {
      delete focus.onReady;
      delete focus.isCurrent;
      owner.host?.ownerDocument.getSelection()?.removeAllRanges();
      owner.focusAxis(selection, focus);
    }
    return owner;
  }

  private focusAxis(selection: AxisSelection, focus?: PendingCellFocus["axisFocus"]): void {
    this.selectAxis(selection);
    this.axisAnchor = focus?.anchor ?? selection.start;
    this.touchAxisAnchor = focus?.touchAnchor ?? null;
    this.host?.querySelector<HTMLElement>(`[data-structural-${selection.axis}-handle='${focus?.index ?? selection.start}']`)
      ?.focus({ preventScroll: true });
  }

  private applyMenuOperation(
    view: EditorView,
    operation: TableOperation,
    next?: TableCellCoordinate,
    axisSelection?: AxisSelection,
    intent: TableOperationIntent = "standard",
    frozen?: FrozenGridSelection,
    wholeTableAnchor?: TableCellCoordinate,
    pastedBounds?: { first: TableCellCoordinate; last: TableCellCoordinate },
  ): void {
    const t = createTranslator(this.getSettings().language);
    const expected = frozen?.selection.table ?? this.table;
    if (intent === "owned-grid"
      && view.state.field(editorInfoField, false)?.file?.path !== (frozen?.sourcePath ?? this.sourcePath)) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const snapshot = new TableDocumentSnapshot(view.state.doc.toString());
    const current = frozen === undefined
      ? reparseUnchangedTable(snapshot, expected)
      : this.currentTableForFrozenSelection(view, frozen, snapshot);
    if (current === null) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const selection = frozen?.selection ?? this.selection;
    const selectionAnchor = wholeTableAnchor ?? frozen?.anchor ?? this.selectionAnchor;
    const selectionHead = frozen?.head ?? this.selectionHead;
    const result = validateTableOperationInDocument(snapshot, current, operation(current));
    if (view.state.doc.toString() !== snapshot.source) {
      new Notice(t("notice.staleTable"));
      return;
    }
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
    if (result.code === "range-pasted" && pastedBounds !== undefined) restoredBounds = pastedBounds;

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

    const preTransposeCoordinate = selectionAnchor ?? { row: 0, column: 0 };
    if (result.code === "table-transposed") {
      coordinate = {
        row: preTransposeCoordinate.column,
        column: preTransposeCoordinate.row,
      };
      restoredAxis = undefined;
      restoredBounds = undefined;
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
      ...tableWriteHistory(
          current,
          result.source,
          this.sourcePath,
          historyCoordinate,
          tableDeleted ? { restorePresentation: true }
            : result.code === "table-transposed" ? { undoCoordinate: preTransposeCoordinate } : {},
        ),
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
