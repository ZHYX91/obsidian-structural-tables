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

  function hiddenEdges() {
    const viewport = list.getBoundingClientRect();
    const edges = tabs.map(tab => tab.getBoundingClientRect());
    const left = edges.filter(edge => edge.left < viewport.left - 0.5);
    const right = edges.filter(edge => edge.right > viewport.right + 0.5);
    return { viewport, left, right };
  }

  function update(): void {
    if (!bar.clientWidth || !tabs.length) return;
    // Compare natural tab width to the whole bar, including space occupied by controls.
    const first = tabs[0]!.getBoundingClientRect();
    const last = tabs[tabs.length - 1]!.getBoundingClientRect();
    const width = Math.max(first.right, last.right) - Math.min(first.left, last.left);
    const overflows = width > bar.getBoundingClientRect().width + 0.5;
    bar.classList.toggle("has-overflow", overflows);
    const { left, right } = hiddenEdges();
    const focused = list.ownerDocument.activeElement;
    previous.hidden = !overflows || (isRtl() ? right : left).length === 0;
    next.hidden = !overflows || (isRtl() ? left : right).length === 0;
    if ((focused === previous && previous.hidden) || (focused === next && next.hidden)) {
      const target = !previous.hidden ? previous : !next.hidden ? next : tabs.find(tab => tab.tabIndex === 0);
      target?.focus({ preventScroll: true });
    }
  }

  function scroll(towardNext: boolean): void {
    const { viewport, left, right } = hiddenEdges();
    const towardRight = towardNext !== isRtl();
    const distances = towardRight
      ? right.map(edge => edge.right - viewport.right)
      : left.map(edge => viewport.left - edge.left);
    if (!distances.length || viewport.width <= 0) return;
    const step = Math.min(viewport.width, ...distances);
    list.scrollBy({ left: towardRight ? step : -step, behavior: "instant" });
    update();
  }

  previous.onclick = () => scroll(false);
  next.onclick = () => scroll(true);
  list.addEventListener("scroll", update, { passive: true });
  const observer = win?.ResizeObserver ? new win.ResizeObserver(update) : null;
  observer?.observe(bar);
  for (const tab of tabs) observer?.observe(tab);
  update();
  return () => {
    observer?.disconnect();
    list.removeEventListener("scroll", update);
  };
}
