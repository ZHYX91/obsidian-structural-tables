// The buttons sit outside the tablist so paging never changes the active panel.
export function createScrollButton(
  bar: HTMLElement,
  direction: "previous" | "next",
  label: string,
): HTMLButtonElement {
  const button = bar.createEl("button", {
    cls: "structural-tables-settings-tab-scroll",
    attr: { type: "button", "data-direction": direction, "aria-label": label, title: label },
  });
  button.hidden = true;
  return button;
}

export function observeTabOverflow(
  bar: HTMLElement,
  list: HTMLElement,
  previous: HTMLButtonElement,
  next: HTMLButtonElement,
): () => void {
  const win = list.ownerDocument.defaultView;
  const tabs = Array.from(list.children) as HTMLElement[];
  const isRtl = () => win?.getComputedStyle(list).direction === "rtl";

  function distanceToEdge(tab: HTMLElement, viewport: DOMRect, towardRight: boolean): number {
    const rect = tab.getBoundingClientRect();
    return towardRight ? rect.right - viewport.right : viewport.left - rect.left;
  }

  function firstClippedTab(towardRight: boolean): HTMLElement | undefined {
    const viewport = list.getBoundingClientRect();
    if (viewport.width <= 0) return;
    let nearest = Infinity;
    let target: HTMLElement | undefined;
    for (const tab of tabs) {
      const distance = distanceToEdge(tab, viewport, towardRight);
      // Scroll extents are rounded to CSS pixels; label bounds can be fractional.
      if (distance <= 1 || distance >= nearest) continue;
      nearest = distance;
      target = tab;
    }
    return target;
  }

  function update(): void {
    if (!bar.clientWidth || !tabs.length) return;
    // Compare natural tab width to the whole bar, including space occupied by controls.
    const first = tabs[0]!.getBoundingClientRect();
    const last = tabs[tabs.length - 1]!.getBoundingClientRect();
    const width = Math.max(first.right, last.right) - Math.min(first.left, last.left);
    const overflows = width > bar.getBoundingClientRect().width + 1;
    bar.classList.toggle("has-overflow", overflows);
    const focused = list.ownerDocument.activeElement;
    const rtl = isRtl();
    const canScrollPrevious = overflows && firstClippedTab(rtl) !== undefined;
    const canScrollNext = overflows && firstClippedTab(!rtl) !== undefined;
    const viewport = canScrollPrevious && previous.hidden ? list.getBoundingClientRect() : undefined;
    previous.hidden = !canScrollPrevious;
    next.hidden = !canScrollNext;
    // Keep the same content in view when a scroll reveals the start control.
    if (viewport !== undefined) {
      const resized = list.getBoundingClientRect();
      list.scrollLeft += rtl ? resized.right - viewport.right : resized.left - viewport.left;
    }
    if ((focused === previous && previous.hidden) || (focused === next && next.hidden)) {
      const target = !previous.hidden ? previous : !next.hidden ? next : tabs.find(tab => tab.tabIndex === 0);
      target?.focus({ preventScroll: true });
    }
  }

  let followSelectedTab = true;
  function onScroll(): void {
    update();
    const viewport = list.getBoundingClientRect();
    const selected = tabs.find(tab => tab.getAttribute("aria-selected") === "true")?.getBoundingClientRect();
    if (!selected || !viewport.width) return;
    // Keep following a visible selection on resize. Preserve a different page
    // when the user has scrolled the selection out of view.
    const visible = Math.min(selected.right, viewport.right) - Math.max(selected.left, viewport.left);
    followSelectedTab = visible >= Math.min(selected.width, viewport.width) - 1;
  }

  function measure(): void {
    update();
    if (!list.clientWidth) return;
    if (!bar.classList.contains("has-overflow")) {
      followSelectedTab = true;
      return;
    }
    if (!followSelectedTab) return;
    const active = tabs.find(tab => tab.getAttribute("aria-selected") === "true");
    if (!active) return;
    const viewport = list.getBoundingClientRect();
    const selected = active.getBoundingClientRect();
    if (selected.left < viewport.left && selected.right < viewport.right) list.scrollLeft += selected.left - viewport.left;
    else if (selected.right > viewport.right && selected.left > viewport.left) list.scrollLeft += selected.right - viewport.right;
    update();
  }

  function scroll(towardNext: boolean): void {
    const towardRight = towardNext !== isRtl();
    const target = firstClippedTab(towardRight);
    if (target === undefined) return;
    // Reveal the same tab after reserving space for the reverse control.
    const other = towardNext ? previous : next;
    other.hidden = false;
    const viewport = list.getBoundingClientRect();
    const distance = Math.max(0, Math.min(distanceToEdge(target, viewport, towardRight), viewport.width));
    if (distance > 0) list.scrollBy({ left: towardRight ? distance : -distance, behavior: "instant" });
    update();
  }

  previous.onclick = () => scroll(false);
  next.onclick = () => scroll(true);
  list.addEventListener("scroll", onScroll, { passive: true });
  const observer = win?.ResizeObserver ? new win.ResizeObserver(measure) : null;
  observer?.observe(bar);
  for (const tab of tabs) observer?.observe(tab);
  measure();
  return () => {
    observer?.disconnect();
    list.removeEventListener("scroll", onScroll);
  };
}
