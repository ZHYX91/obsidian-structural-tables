// @vitest-environment happy-dom

import { EditorState, Prec, StateField, type Extension } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { App, MarkdownRenderer, editorInfoField, editorLivePreviewField, type Editor, type TFile } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, type StructuralTablesSettings } from "../src/config/settings";
import type { StructuralTable } from "../src/core/model";
import { parseEditableTables } from "../src/core/parser";
import { StructuralTableEditorController } from "../src/editor/table-live-preview";
import { activeScopes, lastMenu } from "./mocks/obsidian";

interface ObsidianElementOptions {
  cls?: string;
}

class NativeTableWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "test-native-table";
    return element;
  }
}

class NativeCalloutWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "callout";
    element.innerHTML = "<div class='callout-title'>Note</div><div class='callout-content'><table><thead><tr><th>A</th><th>&lt;</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table></div>";
    return element;
  }
}

const screenshotTable = [
  "|  |  |  |  |  |",
  "| --- | --- | --- | --- | --- |",
  "|  |  |  |  |  |",
  "|  |  |  |  |  |",
  "|  |  |  |  | < |",
  "|  |  |  | ^ | ^ |",
].join("\n");

beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: ObsidianElementOptions,
  ): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function createDiv(options?: ObsidianElementOptions): HTMLDivElement {
    return this.createEl("div", options);
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function mountEditor(
  source: string,
  selection: { anchor: number; head?: number },
  extensions: Extension[] = [],
  promote?: (editor: Editor, sourceFile: TFile | null, table: StructuralTable) => void,
  settingsOverride: Partial<StructuralTablesSettings> = {},
): {
    parent: HTMLElement;
    view: EditorView;
    updateSettings: (update: Partial<StructuralTablesSettings>) => void;
  } {
  let settings = { ...DEFAULT_SETTINGS, ...settingsOverride, enableLivePreview: true };
  const controller = new StructuralTableEditorController(
    new App(),
    () => settings,
    promote,
  );
  const state = EditorState.create({
    doc: source,
    selection,
    extensions: [
      editorLivePreviewField,
      editorInfoField,
      ...extensions,
      controller.createExtension(),
    ],
  });
  const parent = document.body.appendChild(document.createElement("div"));
  return {
    parent,
    view: new EditorView({ state, parent }),
    updateSettings: (update) => {
      settings = { ...settings, ...update };
      controller.refresh();
    },
  };
}

function dispatchPointerDown(
  target: HTMLElement,
  pointerType: "mouse" | "touch",
  timeStamp?: number,
): Event {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    isPrimary: { value: true },
    button: { value: 0 },
    shiftKey: { value: false },
    ...(timeStamp === undefined ? {} : { timeStamp: { value: timeStamp } }),
  });
  target.dispatchEvent(event);
  return event;
}

describe("StructuralTableEditorController", () => {
  it("moves a two-tap handle range in one history transaction and keeps its handles selected", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n| C | D |\n| E | F |\n\nEnd";
    const rectangle = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("structural-tables-live-preview")) return rectangle(0, 0, 300, 230);
      if (this.tagName === "TABLE") return rectangle(40, 20, 200, 160);
      if (this.tagName === "TR") {
        const index = [...this.closest("table")!.rows].indexOf(this as HTMLTableRowElement);
        return rectangle(40, 20 + index * 40, 200, 40);
      }
      if (this.dataset.structuralColumn !== undefined) return rectangle(40 + Number(this.dataset.structuralColumn) * 100,
        20 + Number(this.dataset.structuralRow) * 40, 100, 40);
      return rectangle(0, 0, 0, 0);
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const pointer = (type: string, y: number) => new PointerEvent(type,
      { pointerId: 1, isPrimary: true, button: 0, pointerType: "touch", clientX: 25, clientY: y, bubbles: true, cancelable: true });
    try {
      const first = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!;
      const second = parent.querySelector<HTMLElement>("[data-structural-row-handle='2']")!;
      first.dispatchEvent(pointer("pointerdown", 80));
      window.dispatchEvent(pointer("pointerup", 80));
      second.dispatchEvent(pointer("pointerdown", 120));
      window.dispatchEvent(pointer("pointerup", 120));
      expect(parent.querySelectorAll(".structural-tables-row-handle.is-selected")).toHaveLength(2);
      first.dispatchEvent(pointer("pointerdown", 80));
      window.dispatchEvent(pointer("pointermove", 180));
      window.dispatchEvent(pointer("pointerup", 180));
      await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[0]!.content).toBe("E"));
      await vi.waitFor(() => expect(parent.querySelectorAll(".structural-tables-row-handle.is-selected")).toHaveLength(2));
      expect((document.activeElement as HTMLElement).dataset.structuralRowHandle).toBe("2");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("cancels an armed axis drag when external content replaces its source", () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n| C | D |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    const pointer = (type: string, y: number) => new PointerEvent(type,
      { pointerId: 1, isPrimary: true, button: 0, pointerType: "mouse", clientX: 25, clientY: y, bubbles: true, cancelable: true });
    try {
      const handle = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!;
      handle.dispatchEvent(pointer("pointerdown", 80));
      window.dispatchEvent(pointer("pointerup", 80));
      handle.dispatchEvent(pointer("pointerdown", 80));
      const from = source.indexOf("| A") + 2;
      view.dispatch({ changes: { from, to: from + 1, insert: "Changed" } });
      const changed = view.state.doc.toString();
      window.dispatchEvent(pointer("pointermove", 200));
      window.dispatchEvent(pointer("pointerup", 200));
      expect(view.state.doc.toString()).toBe(changed);
      expect(parent.querySelector("[data-reorder-state]")).toBeNull();
    } finally { view.destroy(); }
  });
  it("terminal Tab appends one row, opens its first cell and undoes the edit with the row", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Saved";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='2'][data-structural-column='0'] textarea")).not.toBeNull());
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows).toHaveLength(3);
      expect(view.state.doc.toString()).toContain("Saved");
      parent.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("adds a column together with an active draft and focuses the new header", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      cell.querySelector<HTMLTextAreaElement>("textarea")!.value = "Draft";
      parent.querySelector<HTMLButtonElement>(".structural-tables-add-column")!.click();
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='0'][data-structural-column='2'] textarea")).not.toBeNull());
      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table.columnCount).toBe(3);
      expect(table.rows[1]!.cells[1]!.content).toBe("Draft");
      parent.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("adds a bottom data row to a header-only table and preserves backward Tab at the start", async () => {
    const source = "Before\n\n| H | < |\n| --- | --- |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      parent.querySelector<HTMLButtonElement>(".structural-tables-add-row")!.click();
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='1'][data-structural-column='0'] textarea")).not.toBeNull());
      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table.headerRowCount).toBe(1);
      expect(table.rows).toHaveLength(2);
      const editor = parent.querySelector("textarea")!;
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='0'][data-structural-column='0'] textarea")).not.toBeNull());
      const before = view.state.doc.toString();
      parent.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
      expect(view.state.doc.toString()).toBe(before);
    } finally { view.destroy(); }
  });
  it.each(["row", "column"] as const)("keeps Callout add-%s activation local and opens the new cell after a rebuild", async (axis) => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div"); element.className = options.cls; return element;
    });
    const nativeTable = (source: string): HTMLElement => {
      const table = document.createElement("table");
      const parsed = parseEditableTables(source).tables[0]!;
      parsed.rows.forEach((row, index) => {
        const section = table.querySelector(index < parsed.headerRowCount ? "thead" : "tbody")
          ?? table.appendChild(document.createElement(index < parsed.headerRowCount ? "thead" : "tbody"));
        const tr = section.appendChild(document.createElement("tr"));
        row.cells.forEach((cell) => {
          tr.appendChild(document.createElement(index < parsed.headerRowCount ? "th" : "td")).textContent = cell.content;
        });
      });
      return table;
    };
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const container = args[2] as HTMLElement;
      if (container.className === "structural-tables-container") container.replaceChildren(nativeTable(args[1] as string));
    });
    class GrowingCallout extends NativeCalloutWidget {
      constructor(private readonly source: string) { super(); }
      override toDOM(): HTMLElement {
        const element = super.toDOM();
        element.querySelector(".callout-content")!.replaceChildren(nativeTable(this.source));
        return element;
      }
    }
    const nativeFor = (source: string) => Decoration.set([
      Decoration.replace({ widget: new GrowingCallout(source), block: true })
        .range(source.indexOf("> [!note]"), source.indexOf("\n\nEnd")),
    ]);
    const native = StateField.define({
      create: (state) => nativeFor(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged ? nativeFor(transaction.newDoc.toString()) : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const source = "Before\n\n> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native, history()]);
    try {
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      const activateNativeSource = vi.fn(() => view.dispatch({ selection: { anchor: source.indexOf("> | A") } }));
      parent.querySelector(".callout")!.addEventListener("click", activateNativeSource);
      parent.querySelector<HTMLButtonElement>(`.structural-tables-add-${axis}`)!.click();
      expect(activateNativeSource).not.toHaveBeenCalled();
      const coordinate = axis === "row" ? "[data-structural-row='2'][data-structural-column='0']"
        : "[data-structural-row='0'][data-structural-column='2']";
      await vi.waitFor(() => expect(parent.querySelector(`.callout ${coordinate} textarea`)).not.toBeNull());
      expect(document.activeElement).toBe(parent.querySelector(`.callout ${coordinate} textarea`));
      expect(view.state.doc.toString().split("\n").filter((line) => line.includes("|")).every((line) => line.startsWith("> "))).toBe(true);
      parent.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("returns native focus to the table source when splitting a Callout's last merged cell", async () => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div"); element.className = options.cls; return element;
    });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const container = args[2] as HTMLElement;
      if (container.className === "structural-tables-container") {
        container.innerHTML = new NativeCalloutWidget().toDOM().querySelector(".callout-content")!.innerHTML;
      }
    });
    const source = "Before\n\n> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n\nEnd";
    const native = StateField.define({
      create: () => Decoration.set([Decoration.replace({ widget: new NativeCalloutWidget(), block: true })
        .range(source.indexOf("> [!note]"), source.indexOf("\n\nEnd"))]),
      update: (value, transaction) => value.map(transaction.changes),
      provide: (field) => EditorView.decorations.from(field),
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native, history()]);
    try {
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      const cell = parent.querySelector<HTMLElement>(".callout [data-structural-row='0'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Split merged cell")?.callback?.();
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).toBeNull());
      expect(view.hasFocus).toBe(true);
      // A host block widget can move the caret to its boundary; it must never
      // remain at the old paragraph before the Callout.
      expect(view.state.selection.main.anchor).toBeGreaterThanOrEqual(source.indexOf("> | A"));
      expect(view.state.selection.main.anchor).toBeLessThanOrEqual(view.state.doc.toString().indexOf("\n\nEnd") + 1);
      expect(view.state.doc.toString()).not.toContain("| < |");
      expect(undo(view)).toBe(true);
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      expect(redo(view)).toBe(true);
      await vi.waitFor(() => {
        expect(view.hasFocus).toBe(true);
        expect(view.state.selection.main.anchor).toBeGreaterThanOrEqual(source.indexOf("> | A"));
      });
    } finally { view.destroy(); }
  });
  it("restores a rebuilt Callout cell after commit and host command undo/redo", async () => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div"); element.className = options.cls; return element;
    });
    let completeRender: (() => void) | undefined;
    let delayUpdated = true;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const source = args[1] as string;
      const container = args[2] as HTMLElement;
      if (container.className !== "structural-tables-container") return;
      if (source.includes("Updated") && delayUpdated) await new Promise<void>((resolve) => { completeRender = resolve; });
      container.innerHTML = new NativeCalloutWidget().toDOM().querySelector(".callout-content")!.innerHTML
        .replace("<td>y</td>", source.includes("Updated") ? "<td>Updated</td>" : "<td>y</td>");
    });
    class RebuiltCallout extends NativeCalloutWidget {
      constructor(private readonly updated: boolean) { super(); }
      override toDOM(): HTMLElement {
        const element = super.toDOM();
        if (this.updated) element.querySelectorAll("td")[1]!.textContent = "Updated";
        return element;
      }
    }
    const nativeFor = (source: string) => Decoration.set([
      Decoration.replace({ widget: new RebuiltCallout(source.includes("Updated")), block: true })
        .range(source.indexOf("> [!note]"), source.indexOf("\n\nEnd")),
    ]);
    const native = StateField.define({
      create: (state) => nativeFor(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged ? nativeFor(transaction.newDoc.toString()) : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const source = "Before\n\n> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native, history()]);
    await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
    const cell = parent.querySelector<HTMLElement>(".callout [data-structural-row='1'][data-structural-column='1']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.value = "Updated";
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(view.state.selection.main.anchor).toBe(0);
    await vi.waitFor(() => expect(completeRender).toBeDefined());
    completeRender!();
    await vi.waitFor(() => expect(document.activeElement).toBe(parent.querySelector(".callout [data-structural-row='1'][data-structural-column='1']")));
    expect(view.state.doc.toString()).toContain("Updated");
    delayUpdated = false;
    const external = document.body.appendChild(document.createElement("button"));
    external.focus();
    expect(undo(view)).toBe(true);
    await vi.waitFor(() => {
      const restored = parent.querySelector(".callout [data-structural-row='1'][data-structural-column='1']");
      expect(view.state.doc.toString()).toBe(source);
      expect(restored).not.toBeNull();
      expect(document.activeElement).toBe(restored);
    });
    external.focus();
    expect(redo(view)).toBe(true);
    await vi.waitFor(() => {
      const restored = parent.querySelector(".callout [data-structural-row='1'][data-structural-column='1']");
      expect(view.state.doc.toString()).toContain("Updated");
      expect(restored).not.toBeNull();
      expect(document.activeElement).toBe(restored);
    });
    view.destroy();
  });
  it("mounts the shared cell editor inside a native callout and releases ownership on disable", async () => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div");
      element.className = options.cls;
      return element;
    });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const container = args[2] as HTMLElement;
      if (container.className === "structural-tables-container") {
        container.innerHTML = new NativeCalloutWidget().toDOM().querySelector(".callout-content")!.innerHTML;
      }
    });
    const source = "> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n\nEnd";
    const native = EditorView.decorations.of(Decoration.set([
      Decoration.replace({ widget: new NativeCalloutWidget(), block: true }).range(0, source.indexOf("\n\n")),
    ]));
    const { parent, view, updateSettings } = mountEditor(source, { anchor: source.length }, [native]);
    await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview th")?.getAttribute("colspan")).toBe("2"));
    expect(parent.querySelector(".callout-title")?.textContent).toBe("Note");
    updateSettings({ enableLivePreview: false });
    await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).toBeNull());
    expect(parent.querySelectorAll(".callout th")).toHaveLength(2);
    view.destroy();
  });
  it.each([false, true])("keeps the new cell scope when focus transfers directly between cell editors (changed=%s)", async (changed) => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cells = parent.querySelectorAll<HTMLElement>("[data-structural-row='0'][data-structural-column]");
    cells[0]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    if (changed) parent.querySelector<HTMLTextAreaElement>("textarea")!.value = "First draft saved";
    cells[1]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await Promise.resolve();
    expect(parent.querySelectorAll("textarea")).toHaveLength(1);
    expect(activeScopes).toHaveLength(1);
    if (changed) expect(view.state.doc.toString()).toContain("First draft saved");
    activeScopes[0]!.handlers.find((handler) => handler.key === "Escape")!
      .callback(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(parent.querySelector("textarea")).toBeNull();
    view.destroy();
    expect(activeScopes).toHaveLength(0);
  });

  it("refreshes appearance without changing source or merge semantics", () => {
    const { parent, view, updateSettings } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const before = view.state.doc.toString();
    const spans = () => [...parent.querySelectorAll("td, th")].map((cell) => [cell.getAttribute("rowspan"), cell.getAttribute("colspan")]);
    const expectedSpans = spans();
    for (const appearance of ["grid", "three-line", "theme"] as const) {
      updateSettings({ appearance });
      expect(parent.querySelector<HTMLElement>(".structural-tables-live-preview")?.dataset.appearance).toBe(appearance);
      expect(spans()).toEqual(expectedSpans);
      expect(view.state.doc.toString()).toBe(before);
    }
    view.destroy();
  });

  it("rebuilds from current source after rendering is disabled and re-enabled", () => {
    const source = `Introduction\n\n${screenshotTable}`;
    const { parent, view, updateSettings } = mountEditor(source, { anchor: 0 });
    updateSettings({ enableLivePreview: false });
    expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
    view.dispatch({ changes: { from: 0, insert: "Another paragraph\n\n" } });
    updateSettings({ enableLivePreview: true });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.value = "Current source";
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.state.doc.toString()).toContain("Current source");
    view.destroy();
  });

  it("owns Escape before the host keymap and releases the cell scope on cancel and destroy", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.value = "Cancelled draft";
    expect(activeScopes).toHaveLength(1);
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    expect(activeScopes[0]!.handlers.find((handler) => handler.key === "Escape")!.callback(escape)).toBe(false);
    expect(escape.defaultPrevented).toBe(true);
    expect(activeScopes).toHaveLength(1);
    expect(activeScopes[0]!.handlers.some((handler) => handler.key === "F2")).toBe(true);
    expect(view.state.doc.toString()).toBe(screenshotTable);
    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    view.destroy();
    expect(activeScopes).toHaveLength(0);
  });

  it.each([false, true])("rebinds a shifted table without losing an open draft (%s)", async (openBeforeShift) => {
    const source = `Introduction\n\n${screenshotTable}\n\nEnd`;
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      if (openBeforeShift) cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const draft = cell.querySelector<HTMLTextAreaElement>("textarea");
      if (draft !== null) draft.value = "Preserved draft";
      view.dispatch({ changes: { from: 0, insert: "Added paragraph\n\n" } });
      if (!openBeforeShift) {
        parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!
          .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      }
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      if (openBeforeShift) {
        expect(editor).toBe(draft);
        expect(editor.value).toBe("Preserved draft");
      } else editor.value = "Preserved draft";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
      expect(view.state.doc.toString()).toContain("Preserved draft");
      expect(view.state.doc.toString()).toMatch(/^Added paragraph\n\nIntroduction/u);
    } finally { view.destroy(); }
  });

  it("keeps a shifted identical table's identity for editing and subsequent Tab navigation", async () => {
    const prefix = "Introduction\n\n";
    const source = `${prefix}${screenshotTable}\n\n${screenshotTable}\n\nEnd`;
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      view.dispatch({ changes: { from: 0, insert: "| New | Table |\n| --- | --- |\n| A | B |\n\n" } });
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      expect(Array.from(hosts, (host) => host.dataset.structuralSourceTableIndex)).toEqual(["1", "2"]);
      hosts[1]!.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = hosts[1]!.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Second table only";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      await Promise.resolve();
      expect(view.state.doc.toString()).toContain(`${screenshotTable}\n\n| Second table only`);
      expect(parent.querySelector("textarea")?.closest<HTMLElement>(".structural-tables-live-preview")
        ?.dataset.structuralSourceTableIndex).toBe("2");
    } finally { view.destroy(); }
  });

  it.each([false, true])("navigates every visible anchor once through row spans (backward=%s)", async (backward) => {
    const source = "Intro\n\n| H1 | H2 |\n| --- | --- |\n| A | B |\n| ^ | C |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const coordinate = backward ? [2, 1] : [0, 0];
      parent.querySelector<HTMLElement>(`[data-structural-row='${coordinate[0]}'][data-structural-column='${coordinate[1]}']`)!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const visited: string[] = [];
      for (let step = 0; step < 5; step += 1) {
        const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
        visited.push(editor.value);
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: backward, bubbles: true }));
        await Promise.resolve();
      }
      expect(visited).toEqual(backward ? ["C", "B", "A", "H2", "H1"] : ["H1", "H2", "A", "B", "C"]);
      if (backward) {
        expect(parent.querySelector("textarea")).toBeNull();
        expect(view.state.doc.toString()).toBe(source);
      } else {
        expect(parent.querySelector("[data-structural-row='3'][data-structural-column='0'] textarea")).not.toBeNull();
        expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows).toHaveLength(4);
      }
    } finally { view.destroy(); }
  });

  it.each([false, true])("does not steal focus when a cell editor loses focus (changed=%s)", async (changed) => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      if (changed) parent.querySelector<HTMLTextAreaElement>("textarea")!.value = "Saved on blur";
      const outside = document.body.appendChild(document.createElement("button"));
      outside.focus();
      await Promise.resolve();
      expect(document.activeElement).toBe(outside);
      expect(parent.querySelector("textarea")).toBeNull();
    } finally { view.destroy(); }
  });

  it("restores keyboard focus to the committed cell and routes document history without intercepting draft history", async () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    try {
      const undo = vi.fn();
      const redo = vi.fn();
      Object.assign(view.state.field(editorInfoField).editor!, { undo, redo });
      const selector = "[data-structural-row='1'][data-structural-column='2']";
      const oldCell = parent.querySelector<HTMLElement>(selector)!;
      oldCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Committed";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      expect(undo).not.toHaveBeenCalled();
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
      const cell = parent.querySelector<HTMLElement>(selector)!;
      expect(cell).not.toBe(oldCell);
      expect(document.activeElement).toBe(cell);
      expect(cell.tabIndex).toBe(0);
      expect(view.state.doc.toString()).toContain("Committed");
      for (const [key, ctrlKey, metaKey, shiftKey] of [
        ["z", true, false, false], ["z", false, true, false],
        ["z", true, false, true], ["y", true, false, false],
      ] as const) {
        const event = new KeyboardEvent("keydown", { key, ctrlKey, metaKey, shiftKey, bubbles: true, cancelable: true });
        cell.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await Promise.resolve();
      }
      expect(undo).toHaveBeenCalledTimes(2);
      expect(redo).toHaveBeenCalledTimes(2);
      const f2 = new KeyboardEvent("keydown", { key: "F2", cancelable: true });
      expect(activeScopes[0]!.handlers.find((handler) => handler.key === "F2")!.callback(f2)).toBe(false);
      expect(f2.defaultPrevented).toBe(true);
      expect(parent.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Committed");
      expect(activeScopes).toHaveLength(1);
      expect(activeScopes[0]!.handlers.some((handler) => handler.key === "Escape")).toBe(true);
    } finally { view.destroy(); }
  });

  it("provides block replacements through editor state so opening a Markdown view succeeds", () => {
    const source = [
      "Introduction",
      "",
      "| Region | Sales | < |",
      "| Quarter | Q1 | Q2 |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();

    view.destroy();
  });

  it("renders a merged table when the cursor is at its exclusive end boundary", () => {
    const { parent, view } = mountEditor(`${screenshotTable}\n`, { anchor: screenshotTable.length });

    const merged = parent.querySelector<HTMLTableCellElement>(
      "[data-structural-row='3'][data-structural-column='3']",
    );
    expect(merged).not.toBeNull();
    expect(merged?.rowSpan).toBe(2);
    expect(merged?.colSpan).toBe(2);
    expect(parent.textContent).not.toContain("<");
    expect(parent.textContent).not.toContain("^");

    view.destroy();
  });

  it("keeps source visible while the cursor is genuinely inside the table", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: 1 });

    expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();

    view.destroy();
  });

  it.each([
    ["multi-row column headers", "| A | B |\n| C | D |\n| --- | --- |\n| E | F |"],
    ["row-header columns", "| A | B |\n| --- || --- |\n| C | D |"],
  ])("renders %s after an operation leaves the cursor at the table end", (_name, source) => {
    const { parent, view } = mountEditor(source, { anchor: source.length });

    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();

    view.destroy();
  });

  it("wins an exact-range replacement conflict with an earlier high-priority native decoration", () => {
    const prefix = "Before\n\n";
    const source = `${prefix}${screenshotTable}`;
    const nativeTableField = StateField.define({
      create: () => Decoration.set([
        Decoration.replace({ widget: new NativeTableWidget(), block: true })
          .range(prefix.length, source.length),
      ]),
      update: (value) => value,
      provide: (field) => Prec.high(EditorView.decorations.from(field)),
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [nativeTableField]);

    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
    expect(parent.querySelector(".test-native-table")).toBeNull();

    view.destroy();
  });

  it("takes over ordinary GFM tables only while the opt-in setting is enabled", () => {
    const source = "| Name | Status |\n| --- | --- |\n| Alice | Doing |";
    const disabled = mountEditor(source, { anchor: source.length });
    expect(disabled.parent.querySelector(".structural-tables-live-preview")).toBeNull();
    disabled.view.destroy();

    const requested: StructuralTable[] = [];
    const enabled = mountEditor(
      source,
      { anchor: source.length },
      [],
      (_editor, _sourceFile, table) => { requested.push(table); },
      { takeOverOrdinaryTables: true },
    );
    const host = enabled.parent.querySelector<HTMLElement>(".structural-tables-live-preview");
    expect(host?.dataset.tableKind).toBe("ordinary");
    const cell = host?.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']");
    cell?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(lastMenu?.items.map((item) => item.title)).toContain("Upgrade to Base…");
    expect(lastMenu?.items.map((item) => item.title)).toContain("Insert row above");
    lastMenu?.items.find((item) => item.title === "Upgrade to Base…")?.callback?.();
    expect(requested[0]?.structural).toBe(false);

    enabled.updateSettings({ takeOverOrdinaryTables: false });
    expect(enabled.parent.querySelector(".structural-tables-live-preview")).toBeNull();
    expect(enabled.view.state.doc.toString()).toBe(source);
    enabled.view.destroy();
  });

  it("provides row and column handles with the full structural-table menu", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const rows = parent.querySelectorAll<HTMLElement>("[data-structural-row-handle]");
    const columns = parent.querySelectorAll<HTMLElement>("[data-structural-column-handle]");
    expect(rows).toHaveLength(5);
    expect(columns).toHaveLength(5);

    rows[2]?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(rows[2]?.classList.contains("is-selected")).toBe(true);
    expect(Array.from(rows).filter((handle) => handle.classList.contains("is-selected"))).toEqual([rows[2]]);
    expect(Array.from(columns).some((handle) => handle.classList.contains("is-selected"))).toBe(false);
    expect(lastMenu?.items.map((item) => item.title)).toContain("Insert row above");
    expect(lastMenu?.items.map((item) => item.title)).toContain("Delete selected rows");

    columns[1]?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(Array.from(columns).filter((handle) => handle.classList.contains("is-selected"))).toEqual([columns[1]]);
    expect(Array.from(rows).some((handle) => handle.classList.contains("is-selected"))).toBe(false);

    view.destroy();
  });

  it("keeps handle touches out of host swipe gestures while allowing cell scrolling and handle menus", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const swipe = vi.fn();
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) parent.addEventListener(type, swipe);
    const handle = parent.querySelector<HTMLElement>("[data-structural-column-handle='1']")!;
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      const touch = new Event(type, { bubbles: true, cancelable: true });
      handle.dispatchEvent(touch);
      expect(touch.defaultPrevented).toBe(false);
    }
    expect(swipe).not.toHaveBeenCalled();
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new Event("touchmove", { bubbles: true, cancelable: true }));
    expect(swipe).toHaveBeenCalledOnce();
    handle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(lastMenu?.items.length).toBeGreaterThan(0);
    view.destroy();
  });

  it("reveals only the row and column handles corresponding to the hovered cell", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
    const move = new Event("pointermove", { bubbles: true });
    Object.defineProperties(move, {
      pointerType: { value: "mouse" },
      clientX: { value: 0 },
      clientY: { value: 0 },
    });
    cell.dispatchEvent(move);

    const rows = Array.from(parent.querySelectorAll<HTMLElement>(".structural-tables-row-handle.is-revealed"));
    const columns = Array.from(parent.querySelectorAll<HTMLElement>(".structural-tables-column-handle.is-revealed"));
    expect(rows.map((handle) => handle.dataset.structuralRowHandle)).toEqual(["2"]);
    expect(columns.map((handle) => handle.dataset.structuralColumnHandle)).toEqual(["1"]);

    parent.querySelector<HTMLElement>(".structural-tables-live-preview")
      ?.dispatchEvent(new Event("pointerleave"));
    expect(parent.querySelector(".is-revealed")).toBeNull();
    view.destroy();
  });

  it("positions overlaid handles from the actual centered table rectangle", () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      if (this.classList.contains("structural-tables-live-preview")) {
        return { left: 20, right: 520, top: 10, bottom: 310, width: 500, height: 300, x: 20, y: 10, toJSON: () => ({}) };
      }
      if (this.classList.contains("structural-tables-table")) {
        return { left: 170, right: 370, top: 50, bottom: 250, width: 200, height: 200, x: 170, y: 50, toJSON: () => ({}) };
      }
      return originalRect.call(this);
    };
    try {
      const { parent, view } = mountEditor(
        screenshotTable,
        { anchor: screenshotTable.length },
        [],
        undefined,
        { layout: "content-center" },
      );
      const row = parent.querySelector<HTMLElement>(".structural-tables-row-handle")!;
      const column = parent.querySelector<HTMLElement>(".structural-tables-column-handle")!;
      expect(row.style.getPropertyValue("inset-inline-start")).toBe("calc(150px - var(--structural-table-handle-gutter))");
      expect(column.style.getPropertyValue("inset-block-start")).toBe("calc(40px - var(--structural-table-handle-gutter))");
      expect(column.style.left).toBe("170px");
      view.destroy();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it("uses one tab stop per cell and handle group with arrow-key navigation", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cells = Array.from(parent.querySelectorAll<HTMLElement>(
      "[data-structural-row][data-structural-column]",
    ));
    const rows = Array.from(parent.querySelectorAll<HTMLButtonElement>("[data-structural-row-handle]"));
    const columns = Array.from(parent.querySelectorAll<HTMLButtonElement>("[data-structural-column-handle]"));
    expect(cells.filter((cell) => cell.tabIndex === 0)).toEqual([cells[0]]);
    expect(rows.filter((handle) => handle.tabIndex === 0)).toEqual([rows[0]]);
    expect(columns.filter((handle) => handle.tabIndex === 0)).toEqual([columns[0]]);

    cells[0]?.focus();
    cells[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(cells[1]);
    expect(cells.filter((cell) => cell.tabIndex === 0)).toEqual([cells[1]]);
    expect(cells[1]?.getAttribute("aria-selected")).toBe("true");

    rows[0]?.focus();
    rows[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    expect(rows.filter((handle) => handle.tabIndex === 0)).toEqual([rows[1]]);

    columns[0]?.focus();
    columns[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(columns[1]);
    expect(columns.filter((handle) => handle.tabIndex === 0)).toEqual([columns[1]]);

    const table = parent.querySelector<HTMLTableElement>(".structural-tables-table")!;
    table.style.direction = "rtl";
    cells[0]?.focus();
    cells[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement).toBe(cells[1]);
    columns[0]?.focus();
    columns[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement).toBe(columns[1]);
    view.destroy();
  });

  it("does not select every handle when a structural cell is selected", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

    expect(parent.querySelector(".structural-tables-row-handle.is-selected")).toBeNull();
    expect(parent.querySelector(".structural-tables-column-handle.is-selected")).toBeNull();
    view.destroy();
  });

  it.each([200, 2_000])("preserves a touch rectangle through a subsequent long press after %ims", (delay) => {
    const source = "| A | B |\n| --- || --- |\n| C | D |\n| E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const first = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
    const last = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;

    const firstTap = dispatchPointerDown(first, "touch", 1_000);
    first.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(firstTap.defaultPrevented).toBe(false);
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.querySelector(".structural-tables-cell-editor")).toBeNull();

    const secondTap = dispatchPointerDown(last, "touch", 2_000);
    last.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(secondTap.defaultPrevented).toBe(false);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);

    const longPress = dispatchPointerDown(last, "touch", 2_000 + delay);
    expect(longPress.defaultPrevented).toBe(false);
    expect(parent.querySelector("textarea")).toBeNull();
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
    last.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(lastMenu?.items.map((item) => item.title)).toContain("Merge selected cells");
    view.destroy();
  });

  it("starts a new touch range outside a completed rectangle and allows double-tap editing inside it", () => {
    const source = "| A | B |\n| --- || --- |\n| C | D |\n| E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const cell = (row: number, column: number) => parent.querySelector<HTMLElement>(
      `[data-structural-row='${row}'][data-structural-column='${column}']`,
    )!;
    dispatchPointerDown(cell(1, 0), "touch", 1_000);
    dispatchPointerDown(cell(2, 1), "touch", 2_000);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);

    dispatchPointerDown(cell(0, 0), "touch", 3_000);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(1);
    dispatchPointerDown(cell(1, 1), "touch", 4_000);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);

    dispatchPointerDown(cell(1, 0), "touch", 5_000);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
    dispatchPointerDown(cell(1, 0), "touch", 5_300);
    expect(cell(1, 0).querySelector("textarea")).not.toBeNull();
    view.destroy();
  });

  it("opens the cell editor after two touch taps on the same cell", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;

    const firstTap = dispatchPointerDown(cell, "touch", 1_000);
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(firstTap.defaultPrevented).toBe(false);
    expect(cell.querySelector(".structural-tables-cell-editor")).toBeNull();

    const secondTap = dispatchPointerDown(cell, "touch", 1_500);
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(secondTap.defaultPrevented).toBe(true);
    expect(cell.querySelector(".structural-tables-cell-editor")).not.toBeNull();
    view.destroy();
  });

  it.each([false, true])("restores focus after a structural menu changes table ownership (takeover=%s)", async (takeOverOrdinaryTables) => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length }, [], undefined, { takeOverOrdinaryTables });
    try {
      const selector = "[data-structural-row='3'][data-structural-column='3']";
      const cell = parent.querySelector<HTMLElement>(selector)!;
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const split = lastMenu?.items.find((item) => item.title === "Split merged cell");
      expect(split).toBeDefined();
      split?.callback?.();
      await Promise.resolve();
      const restored = parent.querySelector<HTMLTableCellElement>(selector)!;
      if (takeOverOrdinaryTables) {
        expect(restored.rowSpan).toBe(1);
        expect(restored.colSpan).toBe(1);
        expect(document.activeElement).toBe(restored);
      } else {
        expect(restored).toBeNull();
        expect(view.hasFocus).toBe(true);
      }
    } finally { view.destroy(); }
  });

  it("keeps desktop pointer drag ownership separate from touch selection", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;

    const pointerDown = dispatchPointerDown(cell, "mouse");
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(cell.getAttribute("aria-selected")).toBe("true");
    view.destroy();
  });

  it("clears owned cell selection when the editor cursor moves elsewhere", () => {
    const source = `${screenshotTable}\n\nOutside`;
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
    dispatchPointerDown(cell, "mouse");
    expect(cell.getAttribute("aria-selected")).toBe("true");

    view.dispatch({ selection: { anchor: source.length - "Outside".length } });

    expect(parent.querySelector("[aria-selected='true']")).toBeNull();
    expect(parent.querySelector(".structural-tables-row-handle.is-selected")).toBeNull();
    expect(parent.querySelector(".structural-tables-column-handle.is-selected")).toBeNull();
    view.destroy();
  });

  it("keeps selection local to the structural table receiving the pointer", () => {
    const second = screenshotTable.split("|  |").join("| x |");
    const source = `${screenshotTable}\n\n${second}\n\nOutside`;
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
    expect(hosts).toHaveLength(2);
    const firstHost = hosts.item(0);
    const secondHost = hosts.item(1);
    const firstCell = firstHost.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
    const secondCell = secondHost.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;

    dispatchPointerDown(firstCell, "mouse");
    expect(firstCell.getAttribute("aria-selected")).toBe("true");
    dispatchPointerDown(secondCell, "mouse");

    expect(firstCell.getAttribute("aria-selected")).toBe("false");
    expect(secondCell.getAttribute("aria-selected")).toBe("true");
    view.destroy();
  });

  it("offers structural expansion and Base upgrade from the owned context menu", () => {
    const requested: StructuralTable[] = [];
    const { parent, view } = mountEditor(
      screenshotTable,
      { anchor: screenshotTable.length },
      [],
      (_editor, _sourceFile, table) => { requested.push(table); },
    );
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

    const item = lastMenu?.items.find((candidate) => candidate.title === "Expand structure and upgrade to Base…");
    expect(item).toBeDefined();
    item?.callback?.();
    expect(requested[0]?.structural).toBe(true);
    view.destroy();
  });

  it("edits a Live Preview cell on a desktop click and escapes a pasted Wiki-link pipe", async () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    dispatchPointerDown(cell, "mouse");
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor")!;
    expect(editor).not.toBeNull();

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "[[Target|Alias]]" },
    });
    editor.dispatchEvent(paste);
    expect(editor.value).toBe(String.raw`[[Target\|Alias]]`);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(view.state.doc.toString()).toContain(String.raw`[[Target\|Alias]]`);
    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
    view.destroy();
  });

  it("pastes one Excel cell without its TSV quoting or trailing record separator", async () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: (type: string) => type === "text/html"
        ? '<td>"First"<br />Second</td>'
        : '"""First""\nSecond"\r\n' },
    });
    editor.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(editor.value).toBe('"First"<br>Second');
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(view.state.doc.toString()).toContain('"First"<br>Second');
    view.destroy();
  });

  it.each(["Escape", "Enter"])("preserves rendered sizing content and restores the same nodes after %s", (key) => {
    const source = "| Name | Value |\n| --- || --- |\n| Long | abcdefghijklmnopqrstuvwxyz |\n| Next | Short |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
    const content = cell.querySelector<HTMLElement>(".structural-tables-cell-content")!;
    const text = content.appendChild(document.createTextNode("abcdefghijklmnopqrstuvwxyz"));
    const link = content.appendChild(document.createElement("a"));
    link.textContent = "Rendered link";
    const activated = vi.fn();
    link.addEventListener("click", activated);
    const originalNodes = [...cell.childNodes];

    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(text.isConnected).toBe(true);
    expect(link.parentNode).toBe(content);
    expect(cell.classList.contains("is-editing")).toBe(true);
    expect(view.state.doc.toString()).toBe(source);

    editor.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect([...cell.childNodes]).toEqual(originalNodes);
    expect(cell.classList.contains("is-editing")).toBe(false);
    expect(view.state.doc.toString()).toBe(source);
    link.click();
    expect(activated).toHaveBeenCalledOnce();
    view.destroy();
  });

  it("pastes multiline text and inserts cell breaks from Shift+Enter and the editor menu", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor")!;
    expect(editor.getAttribute("cols")).toBe("1");
    expect(editor.getAttribute("rows")).toBe("1");
    editor.value = "First";
    editor.setSelectionRange(5, 5);

    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(editor.value).toBe("First<br>");

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "Second\r\nThird" } });
    editor.dispatchEvent(paste);
    expect(editor.value).toBe("First<br>Second<br>Third");

    editor.setSelectionRange(5, 5);
    editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const item = lastMenu?.items.find((candidate) => candidate.title === "Insert line break in cell");
    expect(item).toBeDefined();
    item?.callback?.();
    expect(editor.value).toBe("First<br><br>Second<br>Third");
    expect(cell.querySelector(".structural-tables-cell-editor")).toBe(editor);
    view.destroy();
  });

  it("keeps drag selection and links separate from desktop click editing", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const first = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    const last = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;

    dispatchPointerDown(first, "mouse");
    last.dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
    last.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
    expect(parent.querySelector(".structural-tables-cell-editor")).toBeNull();

    const link = first.appendChild(document.createElement("a"));
    link.textContent = "Link";
    dispatchPointerDown(link, "mouse");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(parent.querySelector(".structural-tables-cell-editor")).toBeNull();
    view.destroy();
  });

  it.each(["insertLineBreak", "insertParagraph"])("commits a selected neighbouring cell before soft-keyboard %s can replace its text", async (inputType) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Software | Applications |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const hostInput = vi.fn();
    parent.addEventListener("beforeinput", hostInput);
    try {
      parent.querySelector("[data-structural-row='1'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      parent.querySelector("[data-structural-row='1'][data-structural-column='1']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = parent.querySelector("textarea")!;
      expect(editor.value).toBe("Applications");
      expect(editor.selectionEnd - editor.selectionStart).toBe(editor.value.length);
      const enter = new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });
      editor.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(true);
      expect(hostInput).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
      expect(parent.querySelector("textarea")).toBeNull();
      expect(undo(view)).toBe(false);

      parent.querySelector("[data-structural-row='1'][data-structural-column='1']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      parent.querySelector("textarea")!.value = "Updated";
      parent.querySelector("textarea")!.dispatchEvent(new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(view.state.doc.toString()).toContain("Updated"));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("keeps the cell editor open during IME composition and uses Tab as one undoable commit", async () => {
    let documentChanges = 0;
    const listener = EditorView.updateListener.of((update) => {
      if (update.docChanged) documentChanges += 1;
    });
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length }, [listener]);
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor")!;
    editor.value = "输入";
    editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "输" }));
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const composingInput = new InputEvent("beforeinput", {
      inputType: "insertLineBreak", isComposing: true, bubbles: true, cancelable: true,
    });
    editor.dispatchEvent(composingInput);
    expect(composingInput.defaultPrevented).toBe(false);
    expect(cell.querySelector(".structural-tables-cell-editor")).toBe(editor);
    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();

    editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "输入" }));
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await Promise.resolve();
    const next = parent.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor");
    expect(view.state.doc.toString()).toContain("输入");
    expect(next?.closest<HTMLElement>("[data-structural-column]")?.dataset.structuralColumn).toBe("1");

    expect(documentChanges).toBe(1);
    view.destroy();
  });
});
