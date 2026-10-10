import type { Component } from "obsidian";

const CORNERS = ["start-start", "start-end", "end-start", "end-end"] as const;

function suffix(side: string): string {
  return side.split("-").map((part) => part[0]!.toUpperCase() + part.slice(1)).join("");
}

function hasRadius(value: string): boolean {
  return value.trim() !== "" && !/^(?:0+(?:\.0+)?(?:px|rem|em|%)?)(?:\s+0+(?:\.0+)?(?:px|rem|em|%)?)*$/u.test(value.trim());
}

/** Measure native positional styling on a small, inert rectangular reference.
 * A covered final row has no DOM cell to sample; row headers can also have a
 * different tag from the theme's td selector. Never add cells to the real table.
 */
function themeRadii(table: HTMLTableElement): string[] {
  const document = table.ownerDocument;
  const view = document.defaultView;
  if (view === null || document.body === null) return [];
  const probe = table.cloneNode(false) as HTMLTableElement;
  probe.removeAttribute("id");
  for (const side of CORNERS) {
    delete probe.dataset[`structuralReady${suffix(side)}`];
    probe.style.removeProperty(`--structural-tables-corner-${side}`);
  }
  const top = probe.createTHead().insertRow();
  top.createEl("th");
  top.createEl("th");
  const bottom = probe.createTBody().insertRow();
  bottom.insertCell();
  bottom.insertCell();
  // Preserve scoped theme selectors and inherited variables, including detached
  // MarkdownRenderer containers whose result will be cloned by an exporter.
  let root: HTMLElement = probe;
  for (let ancestor = table.parentElement; ancestor !== null && ancestor !== document.body;
    ancestor = ancestor.parentElement) {
    const shell = ancestor.cloneNode(false) as HTMLElement;
    shell.removeAttribute("id");
    shell.append(root);
    root = shell;
  }
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("inert", "");
  root.classList.add("structural-tables-theme-probe");
  document.body.append(root);
  try {
    const cells = [top.cells[0]!, top.cells[1]!, bottom.cells[0]!, bottom.cells[1]!];
    return CORNERS.map((side, index) => view.getComputedStyle(cells[index]!)
      .getPropertyValue(`border-${side}-radius`));
  } finally {
    root.remove();
  }
}

type Refresh = () => void;
const subscriptions = new WeakMap<Document, { callbacks: Set<Refresh>; disconnect: () => void }>();

/** One observer per document, with component-owned subscriptions. */
function subscribe(document: Document, refresh: Refresh, component: Component): void {
  let subscription = subscriptions.get(document);
  if (subscription === undefined) {
    const callbacks = new Set<Refresh>();
    let queued = false;
    const notify = (): void => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; for (const callback of callbacks) callback(); });
    };
    const Observer = document.defaultView?.MutationObserver;
    const observer = Observer === undefined ? undefined : new Observer(notify);
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    observer?.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    observer?.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
    document.addEventListener("load", notify, true);
    subscription = { callbacks, disconnect: () => {
      observer?.disconnect();
      document.removeEventListener("load", notify, true);
    } };
    subscriptions.set(document, subscription);
  }
  const owned = subscription;
  owned.callbacks.add(refresh);
  component.register(() => {
    owned.callbacks.delete(refresh);
    if (owned.callbacks.size === 0) { owned.disconnect(); subscriptions.delete(document); }
  });
}

/** Resolved values are part of the rendered DOM, so awaited clones retain them. */
export function installThemeCornerRemap(table: HTMLTableElement, component: Component): void {
  if (!CORNERS.some((side) => table.dataset[`structuralRemap${suffix(side)}`] === "true")) return;
  let disposed = false;
  const refresh = (): void => {
    if (disposed) return;
    for (const side of CORNERS) {
      delete table.dataset[`structuralReady${suffix(side)}`];
      table.style.removeProperty(`--structural-tables-corner-${side}`);
    }
    if (table.closest<HTMLElement>("[data-appearance]")?.dataset.appearance !== "theme") return;
    const radii = themeRadii(table);
    CORNERS.forEach((side, index) => {
      const radius = radii[index] ?? "";
      if (!hasRadius(radius)) return;
      table.style.setProperty(`--structural-tables-corner-${side}`, radius);
      table.dataset[`structuralReady${suffix(side)}`] = "true";
    });
  };
  component.register(() => { disposed = true; });
  subscribe(table.ownerDocument, refresh, component);
  queueMicrotask(refresh);
}
