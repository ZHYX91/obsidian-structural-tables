import type { Component } from "obsidian";

const CORNERS = [
  { side: "start-start", source: "tr[data-structural-last-header-row='true'] > :first-child" },
  { side: "start-end", source: "tr[data-structural-last-header-row='true'] > :last-child" },
  { side: "end-start", source: "tr[data-structural-last-row='true'] > :first-child" },
  { side: "end-end", source: "tr[data-structural-last-row='true'] > :last-child" },
] as const;

function suffix(side: string): string {
  return side.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

/** Do not invent a radius for themes whose tables are intentionally square. */
function hasRadius(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && !/^(?:0+(?:\.0+)?(?:px|rem|em|%)?)(?:\s+0+(?:\.0+)?(?:px|rem|em|%)?)*$/u.test(trimmed);
}

/**
 * Preserve an actual theme radius when DOM child selectors miss spanning anchors.
 * The ready flags are set only after a real radius has been resolved, so CSS
 * declarations with missing custom properties cannot erase a theme's styling.
 */
export function installThemeCornerRemap(table: HTMLTableElement, component: Component): void {
  if (!CORNERS.some(({ side }) => table.dataset[`structuralRemap${suffix(side)}`] === "true")) return;
  let disposed = false;
  const refresh = (): void => {
    if (disposed || !table.isConnected) return;
    for (const { side } of CORNERS) {
      delete table.dataset[`structuralReady${suffix(side)}`];
      table.style.removeProperty(`--structural-tables-corner-${side}`);
    }
    if (table.closest<HTMLElement>("[data-appearance]")?.dataset.appearance !== "theme") return;
    const view = table.ownerDocument.defaultView;
    if (view === null) return;
    const tableStyle = view.getComputedStyle(table);
    const themeVariable = ["--table-radius", "--table-border-radius"]
      .find((property) => hasRadius(tableStyle.getPropertyValue(property)));
    const repairs: { side: string; radius: string }[] = [];
    for (const { side, source } of CORNERS) {
      if (table.dataset[`structuralRemap${suffix(side)}`] !== "true"
        || table.querySelector(`[data-structural-corner-${side}="true"]`) === null) continue;
      const positional = table.querySelector<HTMLElement>(source);
      const positionalRadius = positional === null ? "" : view.getComputedStyle(positional)
        .getPropertyValue(`border-${side}-radius`);
      const tableRadius = tableStyle.getPropertyValue(`border-${side}-radius`);
      const radius = hasRadius(positionalRadius) ? positionalRadius
        : themeVariable !== undefined ? `var(${themeVariable})`
          : hasRadius(tableRadius) ? tableRadius : null;
      if (radius !== null) repairs.push({ side, radius });
    }
    for (const { side, radius } of repairs) {
      table.style.setProperty(`--structural-tables-corner-${side}`, radius);
      table.dataset[`structuralReady${suffix(side)}`] = "true";
    }
  };
  // Popout and test documents have their own observer realm; never require
  // the main window's global MutationObserver to exist.
  const Observer = table.ownerDocument.defaultView?.MutationObserver;
  if (Observer !== undefined) {
    const observer = new Observer(() => queueMicrotask(refresh));
    observer.observe(table.ownerDocument.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    if (table.ownerDocument.body !== null) {
      observer.observe(table.ownerDocument.body, { attributes: true, attributeFilter: ["class", "style"] });
    }
    component.register(() => { disposed = true; observer.disconnect(); });
  } else {
    component.register(() => { disposed = true; });
  }
  queueMicrotask(refresh);
}
