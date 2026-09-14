import type { StructuralTable } from "../core/model";
import { reorderTableAxis, type OperationResult, type TableAxis } from "../core/operations";

export interface AxisSelection { axis: TableAxis; start: number; end: number }

/** Physical boundaries in logical source order, including RTL columns. */
export function tableAxisBoundaries(table: HTMLTableElement, axis: TableAxis, count: number): number[] {
  const rect = table.getBoundingClientRect();
  if (axis === "row") return Array.from({ length: count + 1 }, (_unused, index) => {
    const row = table.rows.item(index)?.getBoundingClientRect();
    return index === count ? rect.bottom : row !== undefined && row.height > 0 ? row.top : rect.top + rect.height * index / count;
  });
  const rtl = table.ownerDocument.defaultView?.getComputedStyle(table).direction === "rtl";
  const cells = [...table.querySelectorAll<HTMLElement>("[data-structural-column]")];
  return Array.from({ length: count + 1 }, (_unused, index) => {
    if (index === count) return rtl ? rect.left : rect.right;
    const cell = cells.filter((candidate) => {
      const start = Number(candidate.dataset.structuralColumn);
      return start <= index && start + Number(candidate.getAttribute("colspan") ?? 1) > index;
    }).sort((left, right) => Number(left.getAttribute("colspan") ?? 1) - Number(right.getAttribute("colspan") ?? 1))[0];
    const bounds = cell?.getBoundingClientRect();
    if (cell === undefined || bounds === undefined || bounds.width <= 0) {
      return rtl ? rect.right - rect.width * index / count : rect.left + rect.width * index / count;
    }
    const fraction = (index - Number(cell.dataset.structuralColumn)) / Number(cell.getAttribute("colspan") ?? 1);
    return rtl ? bounds.right - bounds.width * fraction : bounds.left + bounds.width * fraction;
  });
}

interface DragSession {
  selection: AxisSelection;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
  destination: number | null;
  preview?: { source: string; destination: number; result: OperationResult };
}

/** Only a second gesture on an explicitly selected axis can reorder it. */
export class TableAxisDrag {
  private session: DragSession | null = null;
  private suppressClick = false;
  private readonly line: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly window: Window | null;

  constructor(private readonly host: HTMLElement, private readonly rendered: HTMLTableElement,
    private readonly current: () => StructuralTable,
    private readonly selected: () => AxisSelection | null,
    private readonly blockedMessage: (result: OperationResult) => string,
    private readonly move: (selection: AxisSelection, destination: number) => void) {
    this.line = host.createDiv({ cls: "structural-tables-drop-line" });
    this.line.hidden = true;
    this.hint = host.createDiv({ cls: "structural-tables-drop-hint" });
    this.hint.hidden = true;
    this.hint.setAttribute("role", "status");
    this.hint.setAttribute("aria-live", "polite");
    this.window = host.ownerDocument.defaultView;
    this.window?.addEventListener("pointermove", this.onMove, { passive: false });
    this.window?.addEventListener("pointerup", this.onUp);
    this.window?.addEventListener("pointercancel", this.cancel);
    this.window?.addEventListener("blur", this.cancel);
    this.window?.addEventListener("keydown", this.onKey, true);
  }

  start(event: PointerEvent, axis: TableAxis, index: number): boolean {
    this.suppressClick = false;
    const selection = this.selected();
    if (event.button !== 0 || event.isPrimary === false || event.shiftKey || selection?.axis !== axis
      || index < selection.start || index > selection.end) return false;
    event.preventDefault();
    event.stopPropagation();
    this.session = { selection: { ...selection }, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, moved: false, destination: null };
    return true;
  }

  consumeClick(): boolean {
    const consumed = this.suppressClick;
    this.suppressClick = false;
    return consumed;
  }

  destroy(): void {
    this.cancel();
    this.window?.removeEventListener("pointermove", this.onMove);
    this.window?.removeEventListener("pointerup", this.onUp);
    this.window?.removeEventListener("pointercancel", this.cancel);
    this.window?.removeEventListener("blur", this.cancel);
    this.window?.removeEventListener("keydown", this.onKey, true);
    this.line.remove();
    this.hint.remove();
  }

  private readonly cancel = (): void => {
    this.session = null;
    this.line.hidden = true;
    this.hint.hidden = true;
    this.hint.textContent = "";
    delete this.host.dataset.reorderState;
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.session === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.suppressClick = true;
    this.cancel();
  };

  private scrollColumnEdge(scroller: HTMLElement, pointerX: number): void {
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const rect = scroller.getBoundingClientRect();
    if (rect.width <= 0) return;
    const threshold = Math.min(40, rect.width / 4);
    const step = (distance: number): number => Math.min(24, Math.max(0, Math.ceil(distance / threshold * 24)));
    let delta = 0;
    if (pointerX < rect.left + threshold) delta = -step(rect.left + threshold - pointerX);
    else if (pointerX > rect.right - threshold) delta = step(pointerX - (rect.right - threshold));
    if (delta !== 0) scroller.scrollLeft += delta;
  }

  private readonly onMove = (event: PointerEvent): void => {
    const session = this.session;
    if (session === null || session.pointerId !== event.pointerId) return;
    if (!session.moved && Math.hypot(event.clientX - session.x, event.clientY - session.y) < 6) return;
    session.moved = true;
    this.suppressClick = true;
    event.preventDefault();
    const table = this.current();
    const { axis, start, end } = session.selection;
    const scroller = this.rendered.closest<HTMLElement>(".structural-tables-container");
    if (axis === "column" && scroller !== null) this.scrollColumnEdge(scroller, event.clientX);
    const rect = this.rendered.getBoundingClientRect();
    const containerRect = scroller?.getBoundingClientRect();
    const visibleLeft = containerRect !== undefined && containerRect.width > 0 ? Math.max(rect.left, containerRect.left) : rect.left;
    const visibleRight = containerRect !== undefined && containerRect.width > 0 ? Math.min(rect.right, containerRect.right) : rect.right;
    const hostRect = this.host.getBoundingClientRect();
    const boundaries = tableAxisBoundaries(this.rendered, axis, axis === "row" ? table.rows.length : table.columnCount);
    const value = axis === "row" ? event.clientY : event.clientX;
    const nearby = event.clientX >= hostRect.left - 48 && event.clientX <= hostRect.right + 48
      && event.clientY >= rect.top - 48 && event.clientY <= rect.bottom + 48;
    if (!nearby) {
      session.destination = null;
      this.line.hidden = true;
      this.hint.hidden = true;
      this.hint.textContent = "";
      this.host.dataset.reorderState = "blocked";
      return;
    }
    let destination = 0;
    for (let index = 1; index < boundaries.length; index += 1) {
      if (Math.abs(value - boundaries[index]!) < Math.abs(value - boundaries[destination]!)) destination = index;
    }
    session.destination = destination;
    let result = session.preview?.source === table.source && session.preview.destination === destination
      ? session.preview.result : null;
    if (result === null) {
      result = reorderTableAxis(table, axis, start, end, destination);
      session.preview = { source: table.source, destination, result };
    }
    const noChange = !result.changed && (result.code === "row-moved" || result.code === "column-moved");
    if (noChange) {
      delete this.host.dataset.reorderState;
      this.line.hidden = true;
      this.hint.hidden = true;
      this.hint.textContent = "";
      return;
    }
    this.host.dataset.reorderState = result.changed ? "allowed" : "blocked";
    this.line.hidden = axis === "column" && (boundaries[destination]! < visibleLeft || boundaries[destination]! > visibleRight);
    this.line.dataset.axis = axis;
    this.line.style.left = `${axis === "row" ? visibleLeft - hostRect.left : boundaries[destination]! - hostRect.left}px`;
    this.line.style.top = `${axis === "row" ? boundaries[destination]! - hostRect.top : rect.top - hostRect.top}px`;
    this.line.style.width = `${axis === "row" ? Math.max(0, visibleRight - visibleLeft) : 2}px`;
    this.line.style.height = `${axis === "row" ? 2 : rect.height}px`;
    if (result.changed) {
      this.hint.hidden = true;
      this.hint.textContent = "";
    } else {
      this.hint.textContent = this.blockedMessage(result);
      this.hint.style.left = `${Math.max(8, visibleLeft - hostRect.left + 8)}px`;
      const hintTop = (axis === "row" ? boundaries[destination]! : rect.top) - hostRect.top + 6;
      this.hint.style.top = `${Math.max(0, Math.min(hostRect.height - 24, hintTop))}px`;
      this.hint.hidden = false;
    }
  };

  private readonly onUp = (event: PointerEvent): void => {
    const session = this.session;
    if (session === null || session.pointerId !== event.pointerId) return;
    if (session.moved) this.onMove(event);
    const destination = session.destination;
    const allowed = this.host.dataset.reorderState === "allowed";
    this.cancel();
    if (session.moved && allowed && destination !== null) this.move(session.selection, destination);
  };
}
