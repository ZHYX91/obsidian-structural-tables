import {
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import {
  App,
  Component,
  Menu,
  Notice,
  editorInfoField,
  editorLivePreviewField,
  type Editor,
  type TFile,
} from "obsidian";

import { createTranslator, operationNotice, withCount } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { editCellContent, normalizeTableCellInput } from "../core/operations";
import { parseEditableTables, parseStructuralTables } from "../core/parser";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { diagnosticText, renderStructuralTable } from "../rendering/table-renderer";
import {
  addBasePromotionMenuItem,
  addSelectionMenuItems,
  hasSelectionMenuItems,
  type TableOperation,
} from "./table-menu";
import {
  structuralTableSelectionFromBounds,
  structuralTableSelectionFromCoordinates,
  type StructuralTableSelection,
  type TableCellCoordinate,
} from "./table-selection";

export const refreshStructuralTables = StateEffect.define<void>();

const TOUCH_DOUBLE_TAP_MAX_MS = 600;

class StructuralTableWidget extends WidgetType {
  private component: Component | null = null;
  private clickEditCandidate: TableCellCoordinate | null = null;
  private dragging = false;
  private renderedTable: HTMLTableElement | null = null;
  private selection: StructuralTableSelection | null = null;
  private selectionAnchor: TableCellCoordinate | null = null;
  private selectionHead: TableCellCoordinate | null = null;
  private touchRangeAnchor: TableCellCoordinate | null = null;
  private touchRangeArmed = false;
  private lastTouchTap: { coordinate: TableCellCoordinate; at: number } | null = null;
  private pointerWindow: Window | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private host: HTMLElement | null = null;

  constructor(
    private readonly app: App,
    private readonly table: StructuralTable,
    private readonly sourcePath: string,
    private readonly settings: StructuralTablesSettings,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote?: (editor: Editor, sourceFile: TFile | null, table: StructuralTable) => void,
  ) {
    super();
  }

  override eq(other: StructuralTableWidget): boolean {
    return this.table.source === other.table.source
      && this.sourcePath === other.sourcePath
      && this.settings.density === other.settings.density
      && this.settings.layout === other.settings.layout
      && this.settings.zebraRows === other.settings.zebraRows
      && this.settings.takeOverOrdinaryTables === other.settings.takeOverOrdinaryTables
      && this.promote === other.promote;
  }

  override toDOM(view: EditorView): HTMLElement {
    this.component = new Component();
    this.component.load();
    const host = view.dom.ownerDocument.createElement("div");
    host.className = "structural-tables-live-preview";
    host.dataset.layout = this.settings.layout;
    host.dataset.density = this.settings.density;
    host.dataset.zebra = String(this.settings.zebraRows);
    host.dataset.tableKind = this.table.structural ? "structural" : "ordinary";
    host.dataset.structuralSourceTableIndex = String(this.table.sourceTableIndex);
    this.host = host;
    const rendered = renderStructuralTable(this.app, this.table, host, this.sourcePath, this.component);
    this.installInteraction(view, host, rendered);
    return host;
  }

  override destroy(): void {
    this.pointerWindow?.removeEventListener("pointerup", this.endPointerSelection);
    this.pointerWindow?.removeEventListener("pointercancel", this.endPointerSelection);
    this.pointerWindow = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.host = null;
    this.renderedTable = null;
    this.clickEditCandidate = null;
    this.lastTouchTap = null;
    this.component?.unload();
    this.component = null;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  private installInteraction(view: EditorView, host: HTMLElement, rendered: HTMLTableElement): void {
    this.renderedTable = rendered;
    rendered.classList.add("is-interactive");
    for (const cell of rendered.querySelectorAll<HTMLElement>("[data-structural-row][data-structural-column]")) {
      cell.tabIndex = 0;
    }
    rendered.addEventListener("pointerdown", (event) => this.startPointerSelection(event, view));
    rendered.addEventListener("pointerover", (event) => this.extendPointerSelection(event));
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

  private coordinateFor(target: EventTarget | null): TableCellCoordinate | null {
    if (target === null || !("closest" in target) || this.renderedTable === null) return null;
    const cell = (target as Element).closest<HTMLElement>("[data-structural-row][data-structural-column]");
    if (cell === null || !this.renderedTable.contains(cell)) return null;
    const row = Number(cell.dataset.structuralRow);
    const column = Number(cell.dataset.structuralColumn);
    return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
  }

  private startPointerSelection(event: PointerEvent, view: EditorView): void {
    this.clickEditCandidate = null;
    if (!event.isPrimary || event.button !== 0) return;
    if (event.target !== null && "closest" in event.target
      && (event.target as Element).closest("textarea, input, a") !== null) return;
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null) return;
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
        this.touchRangeArmed = false;
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
    this.touchRangeArmed = false;
    if (!event.shiftKey || this.selectionAnchor === null) this.selectionAnchor = coordinate;
    this.selectionHead = coordinate;
    this.dragging = true;
    this.updateSelection();
    const cell = this.cellElement(coordinate);
    cell?.focus({ preventScroll: true });
  }

  private startTouchSelection(coordinate: TableCellCoordinate): void {
    if (!this.touchRangeArmed || this.touchRangeAnchor === null) {
      this.touchRangeAnchor = coordinate;
      this.touchRangeArmed = true;
      this.selectionAnchor = coordinate;
      this.selectionHead = coordinate;
    } else {
      this.selectionAnchor = this.touchRangeAnchor;
      this.selectionHead = coordinate;
      this.touchRangeAnchor = null;
      this.touchRangeArmed = false;
    }
    this.dragging = false;
    this.updateSelection();
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

  private openContextMenu(event: MouseEvent, view: EditorView): void {
    const coordinate = this.coordinateFor(event.target);
    if (coordinate === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.touchRangeAnchor = null;
    this.touchRangeArmed = false;
    const selected = this.selection?.cells.some((cell) => (
      cell.anchorRow === coordinate.row && cell.anchorColumn === coordinate.column
    )) ?? false;
    if (!selected) {
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
    const t = createTranslator(this.getSettings().language);
    const info = view.state.field(editorInfoField, false);
    if (this.promote !== undefined && info?.editor !== undefined) {
      addBasePromotionMenuItem(menu, t, this.table, () => this.promote?.(info.editor!, info.file, this.table));
    }
    const menuOptions = { fullEditor: true } as const;
    if (!hasSelectionMenuItems(selection, menuOptions)) return;
    addSelectionMenuItems(
      menu,
      t,
      selection,
      (operation) => this.applyMenuOperation(view, operation),
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
    const cell = this.table.rows[coordinate.row]?.cells[coordinate.column];
    const anchor = cell === undefined ? undefined : this.table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
    const element = anchor === undefined ? null : this.cellElement(anchor);
    if (anchor === undefined || element === null || element.querySelector(".structural-tables-cell-editor") !== null) return;
    this.selectionAnchor = { row: anchor.row, column: anchor.column };
    this.selectionHead = this.selectionAnchor;
    this.updateSelection();

    const originalNodes = Array.from(element.childNodes);
    const editor = element.ownerDocument.createElement("textarea");
    editor.className = "structural-tables-cell-editor";
    editor.value = anchor.raw.trim();
    const t = createTranslator(this.getSettings().language);
    editor.setAttribute("aria-label", t("editor.cell")
      .replace("{row}", String(anchor.row + 1))
      .replace("{column}", String(anchor.column + 1)));
    element.replaceChildren(editor);
    let settled = false;
    let composing = false;

    const restore = (): void => {
      element.replaceChildren(...originalNodes);
      element.focus({ preventScroll: true });
    };
    const finish = (commit: boolean, next: TableCellCoordinate | null = null): void => {
      if (settled) return;
      settled = true;
      if (!commit) {
        restore();
        return;
      }
      const current = reparseUnchangedTable(view.state.doc.toString(), this.table);
      if (current === null) {
        restore();
        new Notice(t("notice.staleTable"));
        return;
      }
      const result = editCellContent(current, anchor.row, anchor.column, editor.value);
      if (!result.changed) {
        restore();
        if (result.code !== "cell-edited") new Notice(operationNotice(t, result.code));
        if (next !== null) queueMicrotask(() => this.beginCellEdit(view, next));
        return;
      }
      view.dispatch({
        changes: { from: current.range.from, to: current.range.to, insert: result.source },
        selection: { anchor: current.range.from + result.source.length },
      });
      if (next !== null) queueMicrotask(() => this.openCellAfterUpdate(view, next));
    };

    editor.addEventListener("keydown", (event) => {
      if (composing || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        finish(true, this.adjacentCell(anchor, event.shiftKey ? "backward" : "forward"));
      }
    });
    editor.addEventListener("paste", (event) => {
      const pasted = event.clipboardData?.getData("text/plain");
      if (pasted === undefined) return;
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = normalizeTableCellInput(`${editor.value.slice(0, start)}${pasted}${editor.value.slice(end)}`);
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });
    editor.addEventListener("compositionstart", (event) => {
      composing = true;
      event.stopPropagation();
    });
    editor.addEventListener("compositionend", (event) => {
      composing = false;
      event.stopPropagation();
    });
    editor.addEventListener("blur", () => {
      if (!composing) finish(true);
    });
    editor.focus({ preventScroll: true });
    editor.select();
  }

  private adjacentCell(cell: TableCellCoordinate, direction: "backward" | "forward"): TableCellCoordinate | null {
    let row = cell.row;
    let column = cell.column;
    const anchor = this.table.rows[row]?.cells[column];
    if (anchor === undefined) return null;
    if (direction === "forward") {
      column = anchor.anchorColumn + anchor.columnSpan;
      if (column >= this.table.columnCount) {
        row += 1;
        column = 0;
      }
      if (row >= this.table.rows.length) return null;
    } else {
      column = anchor.anchorColumn - 1;
      if (column < 0) {
        row -= 1;
        column = this.table.columnCount - 1;
      }
      if (row < 0) return null;
    }
    const target = this.table.rows[row]?.cells[column];
    return target === undefined ? null : { row: target.anchorRow, column: target.anchorColumn };
  }

  private openCellAfterUpdate(view: EditorView, coordinate: TableCellCoordinate): void {
    const host = view.dom.querySelector<HTMLElement>(
      `[data-structural-source-table-index='${this.table.sourceTableIndex}']`,
    );
    const target = host?.querySelector<HTMLElement>(
      `[data-structural-row='${coordinate.row}'][data-structural-column='${coordinate.column}']`,
    );
    const MouseEventConstructor = target?.ownerDocument.defaultView?.MouseEvent;
    if (target === undefined || target === null || MouseEventConstructor === undefined) return;
    target.dispatchEvent(new MouseEventConstructor("dblclick", { bubbles: true }));
  }

  private installHandles(view: EditorView, host: HTMLElement, rendered: HTMLTableElement): void {
    const t = createTranslator(this.getSettings().language);
    const rowHandles = this.table.rows.map((_row, row) => {
      const handle = host.ownerDocument.createElement("button");
      handle.type = "button";
      handle.className = "structural-tables-row-handle";
      handle.dataset.structuralRowHandle = String(row);
      handle.textContent = "⋮";
      handle.setAttribute("aria-label", withCount(t("handle.row"), row + 1));
      handle.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch") {
          event.preventDefault();
          event.stopPropagation();
        }
        this.selectBounds({ row, column: 0 }, { row, column: this.table.columnCount - 1 });
        handle.focus({ preventScroll: true });
      });
      handle.addEventListener("click", () => {
        this.selectBounds({ row, column: 0 }, { row, column: this.table.columnCount - 1 });
      });
      handle.addEventListener("contextmenu", (event) => {
        this.selectBounds({ row, column: 0 }, { row, column: this.table.columnCount - 1 });
        this.showSelectionMenu(event, view);
      });
      host.appendChild(handle);
      return handle;
    });
    const columnHandles = this.table.alignments.map((_alignment, column) => {
      const handle = host.ownerDocument.createElement("button");
      handle.type = "button";
      handle.className = "structural-tables-column-handle";
      handle.dataset.structuralColumnHandle = String(column);
      handle.textContent = "⋯";
      handle.setAttribute("aria-label", withCount(t("handle.column"), column + 1));
      handle.addEventListener("pointerdown", (event) => {
        if (event.pointerType !== "touch") {
          event.preventDefault();
          event.stopPropagation();
        }
        this.selectBounds({ row: 0, column }, { row: this.table.rows.length - 1, column });
        handle.focus({ preventScroll: true });
      });
      handle.addEventListener("click", () => {
        this.selectBounds({ row: 0, column }, { row: this.table.rows.length - 1, column });
      });
      handle.addEventListener("contextmenu", (event) => {
        this.selectBounds({ row: 0, column }, { row: this.table.rows.length - 1, column });
        this.showSelectionMenu(event, view);
      });
      host.appendChild(handle);
      return handle;
    });
    const positionHandles = (): void => {
      const hostRect = host.getBoundingClientRect();
      const tableRect = rendered.getBoundingClientRect();
      rowHandles.forEach((handle, row) => {
        const rowRect = rendered.rows.item(row)?.getBoundingClientRect();
        const fallback = (row + 0.5) / this.table.rows.length;
        handle.style.top = `${rowRect === undefined || rowRect.height === 0
          ? 24 + fallback * Math.max(0, tableRect.height)
          : rowRect.top - hostRect.top + rowRect.height / 2}px`;
      });
      columnHandles.forEach((handle, column) => {
        let left: number | null = null;
        for (const element of rendered.querySelectorAll<HTMLElement>("[data-structural-column]")) {
          const start = Number(element.dataset.structuralColumn);
          const span = Number(element.getAttribute("colspan") ?? "1");
          if (column < start || column >= start + span) continue;
          const rect = element.getBoundingClientRect();
          if (rect.width > 0) left = rect.left - hostRect.left + rect.width * ((column - start + 0.5) / span);
          break;
        }
        const fallback = 24 + (column + 0.5) / this.table.columnCount * Math.max(0, tableRect.width);
        handle.style.left = `${left ?? fallback}px`;
      });
    };
    positionHandles();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(positionHandles);
      this.resizeObserver.observe(rendered);
    }
  }

  private selectBounds(first: TableCellCoordinate, last: TableCellCoordinate): void {
    this.touchRangeAnchor = null;
    this.touchRangeArmed = false;
    this.selectionAnchor = first;
    this.selectionHead = last;
    this.updateSelection();
  }

  private applyMenuOperation(view: EditorView, operation: TableOperation): void {
    const t = createTranslator(this.getSettings().language);
    const current = reparseUnchangedTable(view.state.doc.toString(), this.table);
    if (current === null) {
      new Notice(t("notice.staleTable"));
      return;
    }
    const result = operation(current);
    if (result.changed) {
      view.dispatch({
        changes: { from: current.range.from, to: current.range.to, insert: result.source },
        selection: { anchor: current.range.from + result.source.length },
      });
    }
    new Notice(operationNotice(t, result.code));
  }
}

interface DecorationEntry {
  from: number;
  to: number;
  decoration: Decoration;
}

interface StructuralTableDecorationState {
  composing: boolean;
  decorations: DecorationSet;
}

const structuralTableComposition = StateEffect.define<boolean>();

export class StructuralTableEditorController {
  private readonly views = new Set<EditorView>();

  constructor(
    private readonly app: App,
    private readonly getSettings: () => StructuralTablesSettings,
    private readonly promote?: (editor: Editor, sourceFile: TFile | null, table: StructuralTable) => void,
  ) {}

  createExtension(): Extension {
    const app = this.app;
    const settingsProvider = this.getSettings;
    const promote = this.promote;
    const views = this.views;
    const buildDecorations = (state: EditorState): DecorationSet => {
      const settings = settingsProvider();
      const livePreview = state.field(editorLivePreviewField, false) ?? false;
      if (!livePreview || !settings.enableLivePreview) return Decoration.none;
      const source = state.doc.toString();
      const sourcePath = state.field(editorInfoField, false)?.file?.path ?? "";
      const selections = state.selection.ranges;
      const entries: DecorationEntry[] = [];
      const tables = settings.takeOverOrdinaryTables
        ? parseEditableTables(source).tables
        : parseStructuralTables(source).tables;
      for (const table of tables) {
        const active = selections.some((selection) => selection.empty
          ? selection.from >= table.range.from && selection.from < table.range.to
          : selection.from < table.range.to && selection.to > table.range.from);
        if (active) continue;
        if (table.valid) {
          entries.push({
            from: table.range.from,
            to: table.range.to,
            decoration: Decoration.replace({
              widget: new StructuralTableWidget(app, table, sourcePath, settings, settingsProvider, promote),
              block: true,
            }),
          });
        } else if (settings.showDiagnostics) {
          const line = state.doc.lineAt(table.range.from);
          entries.push({
            from: line.from,
            to: line.from,
            decoration: Decoration.line({
              attributes: {
                class: "structural-tables-invalid",
                title: diagnosticText(table),
              },
            }),
          });
        }
      }
      entries.sort((left, right) => left.from - right.from || left.to - right.to);
      const builder = new RangeSetBuilder<Decoration>();
      for (const entry of entries) builder.add(entry.from, entry.to, entry.decoration);
      return builder.finish();
    };
    const shouldRebuild = (transaction: Transaction): boolean => {
      const refreshed = transaction.effects.some((effect) => effect.is(refreshStructuralTables));
      const compositionChanged = transaction.effects.some((effect) => effect.is(structuralTableComposition));
      const modeChanged = transaction.startState.field(editorLivePreviewField, false)
        !== transaction.state.field(editorLivePreviewField, false);
      return transaction.docChanged || transaction.selection !== undefined || refreshed || compositionChanged || modeChanged;
    };
    const decorationField = StateField.define<StructuralTableDecorationState>({
      create: (state) => ({ composing: false, decorations: buildDecorations(state) }),
      update: (value, transaction) => {
        const composition = transaction.effects.find((effect) => effect.is(structuralTableComposition));
        const composing = composition?.value ?? value.composing;
        if (!shouldRebuild(transaction)) return value;
        return {
          composing,
          decorations: composing ? Decoration.none : buildDecorations(transaction.state),
        };
      },
      provide: (field) => Prec.highest(EditorView.decorations.from(field, (value) => value.decorations)),
    });
    const viewTracker = ViewPlugin.fromClass(class {
      constructor(private readonly view: EditorView) {
        views.add(view);
      }

      destroy(): void {
        views.delete(this.view);
      }
    });
    const compositionHandlers = EditorView.domEventHandlers({
      compositionstart: (_event, view) => {
        view.dispatch({ effects: structuralTableComposition.of(true) });
        return false;
      },
      compositionend: (_event, view) => {
        view.dispatch({ effects: structuralTableComposition.of(false) });
        return false;
      },
    });
    return [decorationField, viewTracker, compositionHandlers];
  }

  refresh(): void {
    for (const view of this.views) view.dispatch({ effects: refreshStructuralTables.of(undefined) });
  }
}
