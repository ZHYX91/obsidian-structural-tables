import { JSDOM, type DOMWindow } from "jsdom";
import MarkdownIt from "markdown-it";
import { App, editorInfoField, MarkdownRenderer, type MarkdownPostProcessorContext, MarkdownRenderChild, TFile } from "obsidian";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { ReadingBlockMapper } from "../src/reading/block-mapping";
import { StructuralTableReadingProcessor } from "../src/reading/table-postprocessor";
import { renderTableSignatures } from "../src/rendering/native-table-mapping";
import { tableRenderingComplete } from "../src/rendering/table-renderer";
import type { EditorView } from "@codemirror/view";
import { cancelPendingTableFocus, StructuralTableWidget } from "../src/editor/table-widget";
import { CalloutTables } from "../src/editor/callout-tables";
import { calloutRanges } from "../src/core/source-lines";

const markdown = new MarkdownIt();
const ordinary = "| Name | Value |\n| --- | --- |\n| North | 10 |";
const merged = "| Name | < |\n| --- | --- |\n| North | 10 |";
const rowHeader = "| Name | Value |\n| --- || --- |\n| North | 10 |";
const settings = { ...DEFAULT_SETTINGS, takeOverOrdinaryTables: true };
let main: JSDOM;
let popout: JSDOM;
let targets: HTMLElement[];
let children: MarkdownRenderChild[];

/** Obsidian's helpers close over the window that defines their prototype. */
function installHelpers(window: DOMWindow): void {
  const document = window.document;
  window.HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(
    tag: K, options?: { cls?: string },
  ): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    this.appendChild(element);
    return element;
  };
  window.HTMLElement.prototype.createDiv = function(options?: { cls?: string }): HTMLDivElement {
    return this.createEl("div", options);
  };
  window.HTMLElement.prototype.setCssProps = function(props: Record<string, string>): void {
    for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
  };
}

beforeEach(() => {
  main = new JSDOM(undefined, { runScripts: "outside-only" });
  popout = new JSDOM(undefined, { runScripts: "outside-only" });
  installHelpers(main.window);
  installHelpers(popout.window);
  vi.stubGlobal("document", main.window.document);
  vi.stubGlobal("Node", main.window.Node);
  vi.stubGlobal("HTMLElement", main.window.HTMLElement);
  vi.stubGlobal("createEl", <K extends keyof HTMLElementTagNameMap>(tag: K) => main.window.document.createElement(tag));
  vi.stubGlobal("createDiv", (options?: { cls?: string }) => {
    const element = main.window.document.createElement("div");
    if (options?.cls !== undefined) element.className = options.cls;
    return element;
  });
  targets = [];
  children = [];
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, target) => {
    targets.push(target);
    // Native comparisons preserve block boundaries; cell rendering also uses
    // a host helper so a foreign prototype cannot be hidden by innerHTML alone.
    const content = target.classList.contains("structural-tables-cell-content")
      ? target.createDiv({ cls: "host-rendered-content" }) : target;
    // The host's Markdown parser imports native content in the main document.
    // Appending adopts its document without replacing those native prototypes.
    const parsed = main.window.document.createElement("div");
    parsed.innerHTML = markdown.render(text);
    content.append(...parsed.childNodes);
  });
});

describe("Live Preview DOM realms", () => {
  const source = "Before\n\n| Name | Value |\n| --- || --- |\n| North | 10 |\n| ^ | 20 |\n\nAfter";

  function mount(): { view: EditorView; widget: StructuralTableWidget; host: HTMLElement; writes: () => number } {
    const dom = popout.window.document.body.appendChild(popout.window.document.createElement("div"));
    let state = EditorState.create({ doc: source, extensions: [editorInfoField] });
    let writes = 0;
    const view = { dom, get state() { return state; },
      dispatch: (spec: TransactionSpec) => {
        const transaction = state.update(spec);
        if (transaction.docChanged) writes += 1;
        state = transaction.state;
      }, focus: () => dom.focus(),
    } as unknown as EditorView;
    const widget = new StructuralTableWidget(new App(), parseEditableTables(source).tables[0]!, "Test.md", settings, () => settings);
    const host = widget.toDOM(view);
    dom.appendChild(host);
    return { view, widget, host, writes: () => writes };
  }

  function destroy(mounted: ReturnType<typeof mount>): void {
    cancelPendingTableFocus(mounted.view);
    mounted.widget.destroy(mounted.host);
  }

  it("creates interactive hosts, cells and controls with independent owner constructors", async () => {
    const mounted = mount();
    try {
      await tableRenderingComplete(mounted.host.querySelector("table")!);
      for (const element of [mounted.host, ...mounted.host.querySelectorAll<HTMLElement>(
        ".structural-tables-container, table, caption, thead, tbody, tr, th, td, button, .structural-tables-cell-content",
      )]) expectPopoutElement(element);
      expect(mounted.view.state.doc.toString()).toBe(source);
    } finally { destroy(mounted); }
  });

  it.each(["row", "column"] as const)("clears an owner-window %s and its merge closure while refusing a different window's key event", (axis) => {
    const mounted = mount();
    try {
      const handle = mounted.host.querySelector<HTMLElement>(`[data-structural-${axis}-handle='1']`)!;
      handle.click();
      handle.focus();
      const foreign = new popout.window.KeyboardEvent("keydown", {
        key: "Delete", bubbles: true, cancelable: true, view: main.window as unknown as Window,
      });
      handle.dispatchEvent(foreign);
      expect(foreign.defaultPrevented).toBe(false);
      expect(mounted.writes()).toBe(0);
      const own = new popout.window.KeyboardEvent("keydown", {
        key: "Delete", bubbles: true, cancelable: true, view: popout.window as unknown as Window,
      });
      handle.dispatchEvent(own);
      expect(own.defaultPrevented).toBe(true);
      expect(mounted.writes()).toBe(1);
      const table = parseEditableTables(mounted.view.state.doc.toString()).tables[0]!;
      expect(table.valid).toBe(true);
      expect(table.rows).toHaveLength(3);
      expect(table.columnCount).toBe(2);
      expect(table.headerRowCount).toBe(1);
      expect(table.rowHeaderColumnCount).toBe(1);
      expect(table.rows[2]!.cells[0]!.marker).toBe("up");
      expect(table.rows[1]!.cells[1]!.content).toBe("");
      expect(table.rows[1]!.cells[0]!.content).toBe(axis === "row" ? "" : "North");
      expect(table.rows[2]!.cells[1]!.content).toBe("");
      expect(table.rows[0]!.cells[0]!.content).toBe("Name");
      expect(table.rows[0]!.cells[1]!.content).toBe(axis === "row" ? "Value" : "");
      expect(mounted.view.state.doc.toString().startsWith("Before\n\n")).toBe(true);
      expect(mounted.view.state.doc.toString().endsWith("\n\nAfter")).toBe(true);
    } finally { destroy(mounted); }
  });

  it("creates and focuses a cell draft in the owner window without editing source on Escape", () => {
    const mounted = mount();
    try {
      const cell = mounted.host.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new popout.window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(editor).toBeInstanceOf(popout.window.HTMLTextAreaElement);
      expect(editor).not.toBeInstanceOf(main.window.HTMLTextAreaElement);
      expect(popout.window.document.activeElement).toBe(editor);
      expect(editor.value).toBe("10");
      editor.dispatchEvent(new popout.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(cell.querySelector("textarea")).toBeNull();
      expect(mounted.writes()).toBe(0);
    } finally { destroy(mounted); }
  });

  it("positions a newly connected table from the owner observer and releases that observer", () => {
    let callback: ResizeObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    const MainObserver = vi.fn();
    vi.stubGlobal("ResizeObserver", MainObserver);
    Object.defineProperty(popout.window, "ResizeObserver", { configurable: true, value: class {
      constructor(next: ResizeObserverCallback) { callback = next; }
      observe = observe;
      disconnect = disconnect;
    } });
    const original = popout.window.HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(popout.window.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
      if (this.isConnected && this.classList.contains("structural-tables-live-preview")) return new popout.window.DOMRect(20, 10, 500, 300);
      if (this.isConnected && this.classList.contains("structural-tables-table")) return new popout.window.DOMRect(70, 50, 200, 200);
      return original.call(this);
    });
    const mounted = mount();
    try {
      expect(MainObserver).not.toHaveBeenCalled();
      expect(callback).toBeTypeOf("function");
      expect(observe.mock.calls.map(([element]) => element)).toEqual([
        mounted.host.querySelector("table"), mounted.host.querySelector(".structural-tables-container"),
      ]);
      callback!([], {} as ResizeObserver);
      const column = mounted.host.querySelector<HTMLElement>("[data-structural-column-handle='1']")!;
      expect(column.style.left).toBe("200px");
      expect(column.style.getPropertyValue("inset-block-start")).toBe("40px");
      expect(mounted.view.state.doc.toString()).toBe(source);
    } finally { destroy(mounted); }
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

afterEach(() => {
  for (const child of children) child.unload();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  main.window.close();
  popout.window.close();
});

function container(html: string): HTMLDivElement {
  const element = popout.window.document.createElement("div");
  element.innerHTML = html;
  return element;
}

function context(source: string): MarkdownPostProcessorContext {
  return {
    sourcePath: "Report.md",
    getSectionInfo: () => ({ text: source, lineStart: 0, lineEnd: source.split("\n").length - 1 }),
    addChild: (child: MarkdownRenderChild) => { children.push(child); child.load(); },
  } as unknown as MarkdownPostProcessorContext;
}

function expectPopoutElement(element: HTMLElement): void {
  expect(element.ownerDocument).toBe(popout.window.document);
  expect(element).toBeInstanceOf(popout.window.HTMLElement);
  expect(element).not.toBeInstanceOf(main.window.HTMLElement);
}

async function expectPopoutTable(root: HTMLElement): Promise<void> {
  const table = root.querySelector<HTMLTableElement>(".structural-tables-table");
  expect(table).not.toBeNull();
  await tableRenderingComplete(table!);
  const wrapper = table!.parentElement!;
  expect(wrapper.constructor).toBe(popout.window.HTMLDivElement);
  expect(table!.constructor).toBe(popout.window.HTMLTableElement);
  for (const element of [wrapper, ...wrapper.querySelectorAll<HTMLElement>("*")]) {
    expect(element.ownerDocument).toBe(popout.window.document);
  }
  for (const element of [wrapper, ...wrapper.querySelectorAll<HTMLElement>(
    ".structural-tables-table, thead, tbody, tr, th, td, .structural-tables-cell-content, .host-rendered-content",
  )]) expectPopoutElement(element);
  expect(table!.querySelector(".host-rendered-content p")).toBeInstanceOf(main.window.HTMLElement);
  expect(targets.length).toBeGreaterThan(0);
  for (const target of targets) expectPopoutElement(target);
  expect(table!.textContent).toContain("North");
}

describe("Reading View DOM realms", () => {
  it("uses independent element constructors and preserves creation prototypes during adoption", () => {
    expect(main.window.Array).not.toBe(popout.window.Array);
    expect(main.window.HTMLElement).not.toBe(popout.window.HTMLElement);
    expect(main.window.HTMLDivElement).not.toBe(popout.window.HTMLDivElement);
    const adopted = popout.window.document.adoptNode(main.window.document.createElement("div"));
    expect(adopted.ownerDocument).toBe(popout.window.document);
    expect(adopted.constructor).toBe(main.window.HTMLDivElement);
    expect(adopted).not.toBeInstanceOf(popout.window.HTMLElement);
    const descendant = adopted.createDiv();
    expect(descendant.ownerDocument).toBe(popout.window.document);
    expect(descendant.constructor).toBe(main.window.HTMLDivElement);
  });

  it.each([ordinary, merged])("renders a native table with its section's constructors: %s", async (source) => {
    const root = container(`<p>Before</p>${markdown.render(source)}<p>After</p>`);
    new StructuralTableReadingProcessor({} as App, () => settings).process(root, context(source));
    await expectPopoutTable(root);
    expect(root.firstElementChild?.textContent).toBe("Before");
    expect(root.lastElementChild?.textContent).toBe("After");
    expect(children[0]?.containerEl).toBe(root.querySelector(".structural-tables-container"));
  });

  it("keeps callout comparisons and replacements in the callout's realm", async () => {
    const source = `> [!note] Report\n${merged.split("\n").map(line => `> ${line}`).join("\n")}`;
    const root = container(`<div class="callout"><div class="callout-content"><p>Before</p>${markdown.render(merged)}<p>After</p></div></div>`);
    new StructuralTableReadingProcessor({} as App, () => settings).process(root, context(source));
    await vi.waitFor(() => expect(root.querySelector(".structural-tables-table")).not.toBeNull());
    await expectPopoutTable(root);
    expect(targets.some(target => target.className === "structural-tables-container")).toBe(true);
    expect(root.querySelector(".callout-content")?.textContent).toContain("Before");
    expect(root.querySelector(".callout-content")?.textContent).toContain("After");
  });

  it("keeps deferred block comparisons and replacement cells in the section's realm", async () => {
    const root = container(markdown.render(rowHeader));
    const info = { text: rowHeader, lineStart: 0, lineEnd: 2 };
    new ReadingBlockMapper({} as App, () => settings).process(root, context(rowHeader), info, parseEditableTables(rowHeader).tables);
    await vi.waitFor(() => expect(root.querySelector(".structural-tables-table")).not.toBeNull());
    await expectPopoutTable(root);
    expect(root.querySelector("tbody th")?.getAttribute("scope")).toBe("row");
  });

  it("keeps standalone source snapshots and rendered cells in the export's realm", async () => {
    const root = container(markdown.render(merged));
    const file = Object.assign(Object.create(TFile.prototype) as TFile, { path: "Report.md" });
    const app = { vault: { getAbstractFileByPath: () => file, cachedRead: async () => merged } } as unknown as App;
    const exportContext = { ...context(merged), getSectionInfo: () => null };
    await new StructuralTableReadingProcessor(app, () => settings).process(root, exportContext);
    await expectPopoutTable(root);
    expect(targets.filter(target => target.className === "structural-tables-container")).toHaveLength(2);
    expect(root.querySelector("[colspan='2']")?.textContent).toContain("Name");
  });

  it("renders native signatures in the requested document", async () => {
    const table = parseEditableTables(merged).tables[0]!;
    const signatures = await renderTableSignatures({} as App, table, "Report.md", popout.window.document);
    expect(signatures).toHaveLength(1);
    expect(targets).toHaveLength(1);
    expectPopoutElement(targets[0]!);
  });

  it.each(["popout", "adopted"])("mounts a native Live Preview callout created in the %s document", async (realm) => {
    const source = `> [!note] Report\n${merged.split("\n").map(line => `> ${line}`).join("\n")}`;
    const editor = popout.window.document.createElement("div");
    editor.className = "cm-editor";
    const boundary = (realm === "adopted" ? main : popout).window.document.createElement("div");
    boundary.innerHTML = `<div class="callout"><div class="callout-content"><p>Before</p>${markdown.render(merged)}<p>After</p></div></div>`;
    editor.append(boundary);
    expect(boundary.ownerDocument).toBe(popout.window.document);
    expect(boundary instanceof popout.window.HTMLElement).toBe(realm !== "adopted");
    const table = parseEditableTables(source).tables[0]!;
    const view = { dom: editor, viewport: { from: 0, to: source.length },
      domAtPos: () => ({ node: editor, offset: 0 }) } as unknown as EditorView;
    const manager = new CalloutTables(view, () => ({ tables: [table], ranges: calloutRanges(source),
      sourcePath: "Report.md", owns: () => true,
      render: (candidate) => renderTableSignatures({} as App, candidate, "Report.md", editor.ownerDocument),
      widget: () => ({ toDOM: () => {
        const host = editor.ownerDocument.createElement("div");
        host.className = "structural-tables-live-preview";
        return host;
      }, updateDOM: () => true, destroy: () => {} }) as unknown as StructuralTableWidget,
    }));
    try {
      await vi.waitFor(() => expect(manager.diagnostics[0]?.state).toBe("mounted"));
      expect(editor.querySelector(".structural-tables-live-preview")).not.toBeNull();
      expect(editor.textContent).toContain("Before");
      expect(editor.textContent).toContain("After");
      manager.destroy();
      expect(editor.querySelector("table")?.textContent).toContain("North");
    } finally { manager.destroy(); }
  });
});
