// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { parseStructuralTables } from "../src/core/parser";
import { TableAxisDrag, tableAxisBoundaries, type AxisSelection } from "../src/editor/table-axis-drag";

function bounds(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
}

function setup() {
  const table = parseStructuralTables("| H | V |\n| --- || --- |\n| A | B |\n| C | D |\n| E | F |").tables[0]!;
  const host = document.body.appendChild(document.createElement("div"));
  host.createDiv = (options) => {
    const element = host.appendChild(document.createElement("div"));
    if (typeof options === "object" && typeof options.cls === "string") element.className = options.cls;
    return element;
  };
  const rendered = host.appendChild(document.createElement("table"));
  rendered.innerHTML = table.rows.map((row) => `<tr>${row.cells.map((cell) =>
    `<td data-structural-column="${cell.column}">${cell.content}</td>`).join("")}</tr>`).join("");
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(bounds(0, 0, 260, 210));
  vi.spyOn(rendered, "getBoundingClientRect").mockReturnValue(bounds(40, 20, 200, 160));
  [...rendered.rows].forEach((row, index) => {
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue(bounds(40, 20 + index * 40, 200, 40));
    [...row.cells].forEach((cell, column) => vi.spyOn(cell, "getBoundingClientRect")
      .mockReturnValue(bounds(40 + column * 100, 20 + index * 40, 100, 40)));
  });
  let selection: AxisSelection | null = null;
  const move = vi.fn();
  const controller = new TableAxisDrag(host, rendered, () => table, () => selection, move);
  const pointer = (type: string, x: number, y: number, pointerId = 1) => new PointerEvent(type,
    { clientX: x, clientY: y, pointerId, pointerType: "touch", button: 0, isPrimary: true, bubbles: true, cancelable: true });
  return { host, rendered, move, controller, pointer, select: (value: AxisSelection) => { selection = value; } };
}

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

describe("explicit axis dragging", () => {
  it("does not reorder on the first selection gesture and commits a selected row only on drop", () => {
    const { controller, pointer, select, move, host } = setup();
    try {
      expect(controller.start(pointer("pointerdown", 25, 80), "row", 1)).toBe(false);
      window.dispatchEvent(pointer("pointermove", 25, 180));
      window.dispatchEvent(pointer("pointerup", 25, 180));
      expect(move).not.toHaveBeenCalled();
      select({ axis: "row", start: 1, end: 1 });
      expect(controller.start(pointer("pointerdown", 25, 80), "row", 1)).toBe(true);
      window.dispatchEvent(pointer("pointermove", 25, 180, 2));
      expect(host.dataset.reorderState).toBeUndefined();
      window.dispatchEvent(pointer("pointermove", 25, 180));
      expect(host.dataset.reorderState).toBe("allowed");
      expect(move).not.toHaveBeenCalled();
      window.dispatchEvent(pointer("pointerup", 25, 180));
      expect(move).toHaveBeenCalledExactlyOnceWith({ axis: "row", start: 1, end: 1 }, 4);
      expect(controller.consumeClick()).toBe(true);
      expect(host.dataset.reorderState).toBeUndefined();
    } finally { controller.destroy(); }
  });

  it("rejects a header drop and cancels Escape, pointer cancellation and outside drops", () => {
    const { controller, pointer, select, move, host } = setup();
    try {
      select({ axis: "row", start: 1, end: 1 });
      controller.start(pointer("pointerdown", 25, 80), "row", 1);
      window.dispatchEvent(pointer("pointermove", 25, 20));
      expect(host.dataset.reorderState).toBe("blocked");
      window.dispatchEvent(pointer("pointerup", 25, 20));
      for (const cancel of [new KeyboardEvent("keydown", { key: "Escape" }), pointer("pointercancel", 25, 180), pointer("pointerup", 900, 900)]) {
        controller.start(pointer("pointerdown", 25, 80), "row", 1);
        window.dispatchEvent(pointer("pointermove", 25, 180));
        window.dispatchEvent(cancel);
        window.dispatchEvent(pointer("pointerup", 25, 180));
      }
      expect(move).not.toHaveBeenCalled();
      expect(host.querySelector<HTMLElement>(".structural-tables-drop-line")!.hidden).toBe(true);
    } finally { controller.destroy(); }
  });

  it("measures RTL boundaries in source order for unequal columns", () => {
    const { controller, rendered } = setup();
    try {
      rendered.style.direction = "rtl";
      for (const row of rendered.rows) {
        vi.mocked(row.cells[0]!.getBoundingClientRect).mockReturnValue(bounds(160, 20, 80, 40));
        vi.mocked(row.cells[1]!.getBoundingClientRect).mockReturnValue(bounds(40, 20, 120, 40));
      }
      expect(tableAxisBoundaries(rendered, "column", 2)).toEqual([240, 160, 40]);
    } finally { controller.destroy(); }
  });
});
