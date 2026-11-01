import type { TableCellCoordinate } from "./table-selection";

interface RangeGestureOwner {
  current: () => boolean;
  coordinate: (event: PointerEvent) => TableCellCoordinate | null;
  select: (first: TableCellCoordinate, last: TableCellCoordinate) => boolean;
  cancel: () => void;
}
const gestures = new WeakMap<object, () => void>();

/** A mouse gesture outlives the widget replaced by a validated draft commit. */
export function beginMouseRangeGesture(key: object, document: Document, event: PointerEvent,
  first: TableCellCoordinate, owner: RangeGestureOwner): void {
  gestures.get(key)?.();
  let crossed = false;
  let last = first;
  let point = { x: event.clientX, y: event.clientY };
  const stop = (): void => {
    for (const type of ["pointermove", "pointerover"]) document.removeEventListener(type, move, true);
    document.defaultView?.removeEventListener("pointerup", end, true);
    document.defaultView?.removeEventListener("pointercancel", cancel, true);
    document.removeEventListener("keydown", escape, true);
    document.defaultView?.removeEventListener("blur", cancel);
    if (gestures.get(key) === stop) gestures.delete(key);
  };
  const move = (input: Event): void => {
    const next = input as PointerEvent;
    if (!owner.current()) { stop(); return; }
    if (next.pointerId !== undefined && next.pointerId !== event.pointerId) return;
    if (next.buttons !== undefined && next.buttons !== 1) return;
    // Reflow may generate another hover at the same physical point after commit.
    if (Number.isFinite(next.clientX) && Number.isFinite(next.clientY)
      && point.x === next.clientX && point.y === next.clientY) return;
    const coordinate = owner.coordinate(next);
    if (coordinate === null || (coordinate.row === last.row && coordinate.column === last.column)) return;
    point = { x: next.clientX, y: next.clientY };
    if (!owner.select(first, coordinate)) { stop(); return; }
    crossed = true;
    last = coordinate;
    next.preventDefault();
  };
  const end = (input: Event): void => {
    const next = input as PointerEvent;
    if (next.pointerId !== undefined && next.pointerId !== event.pointerId) return;
    if (next.button !== undefined && next.button !== 0) return;
    stop();
  };
  const cancel = (input?: Event): void => {
    const next = input as PointerEvent | undefined;
    if (next?.pointerId !== undefined && next.pointerId !== event.pointerId) return;
    stop(); if (crossed && owner.current()) owner.cancel();
  };
  const escape = (input: Event): void => {
    if ((input as KeyboardEvent).key !== "Escape") return;
    if (!owner.current()) { stop(); return; }
    if (crossed) { input.preventDefault(); input.stopImmediatePropagation(); }
    cancel();
  };
  for (const type of ["pointermove", "pointerover"]) document.addEventListener(type, move, true);
  document.defaultView?.addEventListener("pointerup", end, true);
  document.defaultView?.addEventListener("pointercancel", cancel, true);
  document.addEventListener("keydown", escape, true);
  document.defaultView?.addEventListener("blur", cancel);
  gestures.set(key, stop);
}

export function hasMouseRangeGesture(key: object): boolean { return gestures.has(key); }
