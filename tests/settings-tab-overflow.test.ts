// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { observeTabOverflow } from "../src/app/settings-tab-overflow";

function bounds(left: number, width: number): DOMRect {
  return { left, right: left + width, width } as DOMRect;
}

describe("settings tab overflow", () => {
  it.each(["ltr", "rtl"])("reveals clipped tabs without selecting them in %s", direction => {
    const rtl = direction === "rtl";
    const bar = document.createElement("div");
    const list = document.createElement("div");
    const previous = document.createElement("button");
    const next = document.createElement("button");
    const tabs = Array.from({ length: 3 }, () => document.createElement("button"));
    tabs[0]!.setAttribute("aria-selected", "true");
    list.style.direction = direction;
    list.append(...tabs);
    bar.append(previous, list, next);
    document.body.append(bar);
    let width = 180;
    let offset = 0;
    // A 220 px middle label exceeds the initial viewport width.
    const widths = [60, 220, 60];
    const starts = [0, 60, 280];
    const visibleWidth = () => width - (bar.classList.contains("has-overflow") ? 64 : 0);
    vi.spyOn(bar, "clientWidth", "get").mockImplementation(() => width);
    vi.spyOn(bar, "getBoundingClientRect").mockImplementation(() => bounds(0, width));
    vi.spyOn(list, "getBoundingClientRect").mockImplementation(() => bounds(0, visibleWidth()));
    tabs.forEach((tab, index) => {
      vi.spyOn(tab, "getBoundingClientRect").mockImplementation(() => bounds(
        rtl ? visibleWidth() + offset - starts[index]! - widths[index]! : starts[index]! - offset,
        widths[index]!,
      ));
    });
    const scroll = vi.spyOn(list, "scrollBy").mockImplementation((options: number | ScrollToOptions) => {
      if (typeof options !== "object") return;
      offset += (rtl ? -1 : 1) * (options.left ?? 0);
    });
    const dispose = observeTabOverflow(bar, list, previous, next);
    try {
      expect([previous.hidden, next.hidden]).toEqual([true, false]);
      next.click();
      expect(offset).toBe(116);
      expect([previous.hidden, next.hidden]).toEqual([false, false]);
      next.click();
      expect(offset).toBe(164);
      next.focus();
      next.click();
      expect(offset).toBe(224);
      expect([previous.hidden, next.hidden]).toEqual([false, true]);
      expect(document.activeElement).toBe(previous);
      previous.click();
      expect(offset).toBe(108);
      expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
      expect(scroll).toHaveBeenCalledTimes(4);

      // Native horizontal scroll and resizing both recalculate the controls.
      offset = 0;
      list.dispatchEvent(new Event("scroll"));
      expect(previous.hidden).toBe(true);
      width = 341;
      list.dispatchEvent(new Event("scroll"));
      expect([previous.hidden, next.hidden]).toEqual([true, true]);
      expect(bar.classList.contains("has-overflow")).toBe(false);
    } finally {
      dispose();
      bar.remove();
    }
  });
});

describe("settings tablist scroll end", () => {
  it.each(["ltr", "rtl"])("hides an exhausted forward control at a fractional %s edge", direction => {
    const bar = document.createElement("div");
    const list = document.createElement("div");
    const previous = document.createElement("button");
    const next = document.createElement("button");
    const first = document.createElement("button");
    const last = document.createElement("button");
    list.style.direction = direction;
    list.append(first, last);
    bar.append(previous, list, next);
    document.body.append(bar);
    next.focus();

    // Chromium may clamp the native scroll offset to a whole CSS pixel while
    // translated labels leave a fractional remainder in their bounding boxes.
    vi.spyOn(bar, "clientWidth", "get").mockReturnValue(240);
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(bounds(0, 240));
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue(bounds(32, 176));
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(
      direction === "rtl" ? bounds(369, 33) : bounds(-162, 33),
    );
    vi.spyOn(last, "getBoundingClientRect").mockReturnValue(
      direction === "rtl" ? bounds(31.02, 92.39) : bounds(116.59, 92.39),
    );
    const dispose = observeTabOverflow(bar, list, previous, next);
    try {
      expect(previous.hidden).toBe(false);
      expect(next.hidden).toBe(true);
      expect(document.activeElement).toBe(previous);
    } finally {
      dispose();
      bar.remove();
    }
  });
});

describe("restored settings tab", () => {
  it.each(["ltr", "rtl"])("reveals it once when the initially hidden %s strip is measured", direction => {
    const outside = document.createElement("button");
    const bar = document.createElement("div");
    const list = document.createElement("div");
    const previous = document.createElement("button");
    const next = document.createElement("button");
    const first = document.createElement("button");
    const selected = document.createElement("button");
    previous.hidden = next.hidden = true;
    selected.setAttribute("aria-selected", "true");
    list.style.direction = direction;
    list.append(first, selected);
    bar.append(previous, list, next);
    document.body.append(outside, bar);
    outside.focus();

    let width = 0;
    const rtl = direction === "rtl";
    vi.spyOn(bar, "clientWidth", "get").mockImplementation(() => width);
    vi.spyOn(list, "clientWidth", "get").mockImplementation(() => width);
    vi.spyOn(bar, "getBoundingClientRect").mockImplementation(() => bounds(0, width));
    vi.spyOn(list, "getBoundingClientRect").mockImplementation(() => bounds(0, width));
    for (const [i, tab] of [first, selected].entries()) {
      vi.spyOn(tab, "getBoundingClientRect").mockImplementation(() => {
        const start = rtl ? width - (i + 1) * 100 : i * 100;
        return bounds(start - list.scrollLeft, 100);
      });
    }
    let notifyResize = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(notify: () => void) { notifyResize = notify; }
      observe() {}
      disconnect() {}
    });
    const dispose = observeTabOverflow(bar, list, previous, next);
    try {
      expect(list.scrollLeft).toBe(0);
      width = 120;
      notifyResize();
      expect(list.scrollLeft).toBe(rtl ? -80 : 80);
      expect(document.activeElement).toBe(outside);

      // Native/manual paging after initial restoration must stay independent of selection.
      list.scrollLeft = 0;
      list.dispatchEvent(new Event("scroll"));
      notifyResize();
      expect(list.scrollLeft).toBe(0);
      expect(selected.getAttribute("aria-selected")).toBe("true");

      width = 320;
      notifyResize();
      width = 120;
      notifyResize();
      expect(list.scrollLeft).toBe(rtl ? -80 : 80);
    } finally {
      dispose();
      vi.unstubAllGlobals();
      outside.remove();
      bar.remove();
    }
  });
});
