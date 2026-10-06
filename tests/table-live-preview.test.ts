import type { BaseEditorInfo } from "../src/app/base-promotion-service";
// @vitest-environment happy-dom

import { EditorState, Prec, StateField, type Extension } from "@codemirror/state";
import { history, redo, undo } from "@codemirror/commands";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { App, MarkdownRenderer, editorInfoField, editorLivePreviewField, type Editor } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, type StructuralTablesSettings } from "../src/config/settings";
import type { StructuralTable } from "../src/core/model";
import { parseEditableTables } from "../src/core/parser";
import { recoveredCellDrafts } from "../src/editor/cell-draft-recovery";
import { StructuralTableEditorController } from "../src/editor/table-live-preview";
import {
  activeScopes,
  dispatchScopeCaptureThenDom,
  lastMenu,
  notices,
  resetMockModKey,
  setMockModKey,
  type MockModKey,
} from "./mocks/obsidian";

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
  HTMLElement.prototype.setCssProps = function setCssProps(props: Record<string, string>): void {
    for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetMockModKey();
  document.body.replaceChildren();
});

function mountEditor(
  source: string,
  selection: { anchor: number; head?: number },
  extensions: Extension[] = [],
  promote?: (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable) => void,
  settingsOverride: Partial<StructuralTablesSettings> = {},
): {
    app: App;
    parent: HTMLElement;
    view: EditorView;
    updateSettings: (update: Partial<StructuralTablesSettings>) => void;
  } {
  let settings = { ...DEFAULT_SETTINGS, ...settingsOverride, enableLivePreview: true };
  const app = new App();
  const controller = new StructuralTableEditorController(
    app,
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
    app,
    parent,
    view: new EditorView({ state, parent }),
    updateSettings: (update) => {
      settings = { ...settings, ...update };
      controller.refresh();
    },
  };
}

function draftInputEvent(
  type: "beforeinput" | "input",
  inputType: string,
  data: string | null,
  isComposing = false,
): InputEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: type === "beforeinput",
  }) as InputEvent;
  Object.defineProperties(event, {
    inputType: { value: inputType },
    data: { value: data },
    isComposing: { value: isComposing },
  });
  return event;
}

function typeDraftText(editor: HTMLTextAreaElement, text: string): void {
  for (const character of text) {
    const before = draftInputEvent("beforeinput", "insertText", character);
    if (!editor.dispatchEvent(before)) continue;
    editor.setRangeText(character, editor.selectionStart, editor.selectionEnd, "end");
    editor.dispatchEvent(draftInputEvent("input", "insertText", character));
  }
}

function replaceDraftText(editor: HTMLTextAreaElement, text: string): void {
  editor.select();
  typeDraftText(editor, text);
}

function modEvent(
  key: string,
  platform: MockModKey = "ctrl",
  shiftKey = false,
): KeyboardEvent {
  setMockModKey(platform);
  return new KeyboardEvent("keydown", {
    key,
    ctrlKey: platform === "ctrl",
    metaKey: platform === "meta",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
}

function dispatchDraftShortcut(
  editor: HTMLTextAreaElement,
  key: string,
  platform: MockModKey = "ctrl",
  shiftKey = false,
): KeyboardEvent {
  const event = modEvent(key, platform, shiftKey);
  dispatchScopeCaptureThenDom(editor, event);
  return event;
}

function dispatchOwnedGridKey(
  target: HTMLElement,
  key: "Delete" | "Backspace",
  throughScope = true,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  if (throughScope) dispatchScopeCaptureThenDom(target, event);
  else target.dispatchEvent(event);
  return event;
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
  it.each([false, true])("preserves raw source selection across external focus (range=%s)", async (range) => {
    const source = "Before\n\n| Region | Sales | < |\n| --- | --- | --- |\n| North | 10 | < |\n| ^ | 8 | 11 |\n\nEnd";
    const anchor = source.indexOf("North");
    const head = range ? anchor + 5 : anchor;
    const { parent, view } = mountEditor(source, { anchor, head });
    try {
      view.focus();
      const external = document.body.appendChild(document.createElement("button"));
      external.focus();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
      view.focus();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(view.hasFocus).toBe(true);
      expect(view.state.selection.main.anchor).toBe(anchor);
      expect(view.state.selection.main.head).toBe(head);
      expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });
  it("syncs visual cells to source and hands ownership to raw Markdown only on request", async () => {
    const source = [
      "Before",
      "",
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      expect(cell).not.toBeNull();
      dispatchPointerDown(cell, "mouse");
      const sourceOffset = source.indexOf("10");
      expect(view.state.selection.main.anchor).toBe(sourceOffset);
      expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
      expect(view.state.doc.toString()).toBe(source);
      expect(parent.textContent).not.toContain("| --- | --- | --- |");

      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const editSource = lastMenu?.items.find((item) => item.title === "Edit table source");
      expect(editSource).toBeDefined();
      editSource?.callback?.();

      await vi.waitFor(() => {
        expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
        expect(view.hasFocus).toBe(true);
        expect(view.state.selection.main.anchor).toBe(sourceOffset);
      });
      expect(view.state.doc.toString()).toBe(source);
      expect(parent.textContent).toContain("| --- | --- | --- |");
    } finally { view.destroy(); }
  });

  it("preserves a visual cell's logical source cursor when native focus returns from an external control", async () => {
    const source = [
      "Before",
      "",
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      dispatchPointerDown(cell, "mouse");
      const sourceOffset = source.indexOf("10");
      expect(view.state.selection.main.anchor).toBe(sourceOffset);
      expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();

      const external = document.body.appendChild(document.createElement("button"));
      external.focus();
      view.focus();

      await vi.waitFor(() => {
        expect(view.hasFocus).toBe(true);
        expect(view.state.selection.main.anchor).toBe(sourceOffset);
        expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
      });
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("syncs the logical source cursor when keyboard focus enters a visual cell", () => {
    const source = [
      "Before",
      "",
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.focus();
      expect(document.activeElement).toBe(cell);
      expect(view.state.selection.main.anchor).toBe(source.indexOf("10"));
      expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("hands a padded ragged GFM cell to a source position inside the table", async () => {
    const source = [
      "Before",
      "",
      "| A | B | C |",
      "| --- | --- | --- |",
      "| 1 | 2 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='2']",
      )!;
      expect(cell).not.toBeNull();
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const editSource = lastMenu?.items.find((item) => item.title === "Edit table source");
      expect(editSource).toBeDefined();
      editSource?.callback?.();

      const table = parseEditableTables(source).tables[0]!;
      await vi.waitFor(() => {
        expect(view.hasFocus).toBe(true);
        expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
        expect(view.state.selection.main.anchor).toBeGreaterThanOrEqual(table.range.from);
        expect(view.state.selection.main.anchor).toBeLessThan(table.range.to);
      });
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("accepts a valid external source edit and rebuilds semantic presentation", async () => {
    const source = [
      "Before",
      "",
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: source.indexOf("North") });
    try {
      view.focus();
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).toBeNull());

      const value = source.indexOf("10");
      view.dispatch({ changes: { from: value, to: value + 2, insert: "20" } });
      const changed = view.state.doc.toString();
      const parsed = parseEditableTables(changed).tables[0]!;
      expect(parsed.valid).toBe(true);
      expect(parsed.rows[1]?.cells[1]?.content).toBe("20");

      view.dispatch({ selection: { anchor: view.state.doc.length } });
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull());
      expect(view.state.doc.toString()).toBe(changed);
      expect(parent.textContent).not.toContain("| --- | --- | --- |");
    } finally { view.destroy(); }
  });

  it("fails closed when an external source edit breaks merge topology", async () => {
    const source = [
      "Before",
      "",
      "| A | B |",
      "| --- | --- |",
      "| X | 1 |",
      "| ^ | 2 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: source.indexOf("X") });
    try {
      view.focus();
      const from = source.indexOf("| X | 1 |");
      const to = source.indexOf("\n\nEnd");
      const replacement = "| ^ | 2 |\n| X | 1 |";
      view.dispatch({ changes: { from, to, insert: replacement } });
      const changed = view.state.doc.toString();
      const parsed = parseEditableTables(changed).tables[0]!;
      expect(parsed.valid).toBe(false);
      expect(parsed.diagnostics.some((diagnostic) => diagnostic.code === "merge-boundary")).toBe(true);

      view.dispatch({ selection: { anchor: view.state.doc.length } });
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-invalid")).not.toBeNull());
      expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
      expect(parent.textContent).toContain("| --- | --- |");
      expect(view.state.doc.toString()).toBe([
        "Before",
        "",
        "| A | B |",
        "| --- | --- |",
        "| ^ | 2 |",
        "| X | 1 |",
        "",
        "End",
      ].join("\n"));
    } finally { view.destroy(); }
  });

  it.each([
    { axis: "column", pointerType: "mouse" },
    { axis: "column", pointerType: "touch" },
    { axis: "row", pointerType: "mouse" },
    { axis: "row", pointerType: "touch" },
  ] as const)("drags the full merge-expanded $axis selection with $pointerType", async ({ axis, pointerType }) => {
    const rows = axis === "column" ? [
      "| R | A | B | C | D | E |", "| --- || --- | --- | --- | --- | --- |",
      "| a | x | left | < | y | z |", "| b | u | v | right | < | w |",
    ] : [
      "| R | A | B |", "| --- || --- | --- |", "| a | upper | x |",
      "| b | ^ | lower |", "| c | y | ^ |", "| d | z | w |",
    ];
    const source = `Before\n\n${rows.join("\n")}\n\nEnd`;
    const original = parseEditableTables(source).tables[0]!;
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = original.columnCount * 80;
      const height = original.rows.length * 40;
      if (this.classList.contains("structural-tables-live-preview")) return rect(0, 0, width + 80, height + 60);
      if (this.tagName === "TABLE") return rect(40, 20, width, height);
      if (this.tagName === "TR") {
        return rect(40, 20 + [...this.closest("table")!.rows].indexOf(this as HTMLTableRowElement) * 40, width, 40);
      }
      if (this.dataset.structuralColumn !== undefined) return rect(
        40 + Number(this.dataset.structuralColumn) * 80, 20 + Number(this.dataset.structuralRow) * 40,
        Number(this.getAttribute("colspan") ?? 1) * 80, Number(this.getAttribute("rowspan") ?? 1) * 40,
      );
      return rect(0, 0, 0, 0);
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const clicked = axis === "column" ? 3 : 2;
    const expandedStart = axis === "column" ? 2 : 1;
    const selectedIndexes = () => [...parent.querySelectorAll<HTMLElement>(`.structural-tables-${axis}-handle.is-selected`)]
      .map((handle) => Number(handle.getAttribute(`data-structural-${axis}-handle`)));
    const handle = (index: number) => parent.querySelector<HTMLElement>(`[data-structural-${axis}-handle='${index}']`)!;
    const pointer = (type: string, boundary: number) => new PointerEvent(type, {
      pointerId: 1, isPrimary: true, button: 0, pointerType, bubbles: true, cancelable: true,
      clientX: axis === "column" ? 40 + boundary * 80 : 25,
      clientY: axis === "row" ? 20 + boundary * 40 : 10,
    });
    try {
      // One handle expands through two overlapping merges on different rows/columns.
      handle(clicked).dispatchEvent(pointer("pointerdown", clicked + 0.5));
      window.dispatchEvent(pointer("pointerup", clicked + 0.5));
      handle(clicked).click();
      expect(selectedIndexes()).toEqual([expandedStart, expandedStart + 1, expandedStart + 2]);
      expect(view.state.doc.toString()).toBe(source);
      if (pointerType === "mouse") {
        handle(expandedStart).dispatchEvent(new PointerEvent("pointerdown", {
          pointerId: 1, isPrimary: true, button: 0, pointerType, shiftKey: true, bubbles: true, cancelable: true,
        }));
        window.dispatchEvent(pointer("pointerup", expandedStart + 0.5));
        handle(expandedStart).click();
        expect(selectedIndexes()).toEqual([expandedStart, expandedStart + 1, expandedStart + 2]);
      }
      // Expanded handles must already be draggable; header boundaries must still be refused.
      handle(expandedStart).dispatchEvent(pointer("pointerdown", expandedStart + 0.5));
      window.dispatchEvent(pointer("pointermove", 0));
      expect(parent.querySelector<HTMLElement>(".structural-tables-drop-hint")!.textContent).toContain("header boundary");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(view.state.doc.toString()).toBe(source);
      handle(clicked).dispatchEvent(pointer("pointerdown", clicked + 0.5));
      const destination = axis === "column" ? 1 : original.rows.length;
      window.dispatchEvent(pointer("pointermove", destination));
      expect(parent.querySelector<HTMLElement>(".structural-tables-live-preview")!.dataset.reorderState).toBe("allowed");
      window.dispatchEvent(pointer("pointerup", destination));
      const movedStart = axis === "column" ? 1 : 2;
      await vi.waitFor(() => expect(selectedIndexes()).toEqual([movedStart, movedStart + 1, movedStart + 2]));
      const moved = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(moved.valid).toBe(true);
      if (axis === "column") {
        expect(moved.rows[0]!.cells.map((cell) => cell.content)).toEqual(["R", "B", "C", "D", "A", "E"]);
        expect(moved.rows[1]!.cells[1]).toMatchObject({ content: "left", columnSpan: 2 });
        expect(moved.rows[2]!.cells[2]).toMatchObject({ content: "right", columnSpan: 2 });
      } else {
        expect(moved.rows.map((row) => row.cells[0]!.content)).toEqual(["R", "d", "a", "b", "c"]);
        expect(moved.rows[2]!.cells[1]).toMatchObject({ content: "upper", rowSpan: 2 });
        expect(moved.rows[3]!.cells[2]).toMatchObject({ content: "lower", rowSpan: 2 });
      }
      const movedSource = view.state.doc.toString();
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(movedSource);
    } finally { view.destroy(); }
  });

  it.each(["row", "column"] as const)("keeps a selected %s handle range through right-click pointerdown", (axis) => {
    const source = "Before\n\n| H | V | W |\n| --- || --- | --- |\n| A | B | C |\n| D | E | F |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    const selector = (index: number) => parent.querySelector<HTMLElement>(
      `[data-structural-${axis}-handle='${index}']`,
    )!;
    const selected = () => parent.querySelectorAll(`.structural-tables-${axis}-handle.is-selected`).length;
    try {
      selector(1).click();
      selector(2).dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        pointerType: "mouse",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
      expect(selected()).toBe(2);

      selector(1).dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 2,
        isPrimary: true,
        button: 2,
        pointerType: "mouse",
        bubbles: true,
        cancelable: true,
      }));
      expect(selected()).toBe(2);

      selector(1).dispatchEvent(new MouseEvent("contextmenu", {
        button: 2,
        bubbles: true,
        cancelable: true,
      }));
      expect(selected()).toBe(2);
    } finally {
      view.destroy();
    }
  });

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
      Object.assign(view.state.field(editorInfoField).editor!, { undo: () => undo(view), redo: () => redo(view) });
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
      expect(view.state.doc.toString()).toBe(source);
      await Promise.resolve();
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[0]!.content).toBe("E");
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

  it("edits and extends a headerless table without inventing column headers", async () => {
    const source = "Before\n\n| - | --: |\n| A | 1 |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const host = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      expect(host).not.toBeNull();
      expect(host.querySelector("thead")).toBeNull();

      const first = host.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = first.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Changed";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables[0]?.rows[0]?.cells[0]?.content).toBe("Changed"));

      parent.querySelector<HTMLButtonElement>(".structural-tables-add-row")!.click();
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='1'][data-structural-column='0'] textarea")).not.toBeNull());
      let parsed = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(parsed.headerRowCount).toBe(0);
      expect(parsed.rows).toHaveLength(2);
      parent.querySelector<HTMLTextAreaElement>("textarea")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );

      parent.querySelector<HTMLButtonElement>(".structural-tables-add-column")!.click();
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='0'][data-structural-column='2'] textarea")).not.toBeNull());
      parsed = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(parsed.headerRowCount).toBe(0);
      expect(parsed.columnCount).toBe(3);
      expect(parent.querySelector("thead")).toBeNull();

      parent.querySelector<HTMLTextAreaElement>("textarea")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      expect(undo(view)).toBe(true);
      expect(parseEditableTables(view.state.doc.toString()).tables[0]?.headerRowCount).toBe(0);
    } finally {
      view.destroy();
    }
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

  it.each([
    ["single", "Delete"],
    ["partial", "Backspace"],
    ["row", "Delete"],
    ["column", "Backspace"],
    ["all", "Delete"],
  ] as const)("clears %s owned-grid selection with unmodified %s while preserving structure", async (mode, key) => {
    const source = [
      "| H1 | H2 | < |",
      "| --- || :---: | ---: |",
      "| R1 | A | B |",
      "| R2 | C | D |",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const cell = (row: number, column: number) => parent.querySelector<HTMLElement>(
        `[data-structural-row='${row}'][data-structural-column='${column}']`,
      )!;
      if (mode === "single") {
        dispatchPointerDown(cell(1, 1), "mouse");
      } else if (mode === "partial") {
        dispatchPointerDown(cell(1, 1), "mouse");
        cell(1, 2).dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      } else if (mode === "row") {
        const handle = parent.querySelector<HTMLButtonElement>("[data-structural-row-handle='1']")!;
        handle.focus();
        handle.click();
      } else if (mode === "column") {
        const handle = parent.querySelector<HTMLButtonElement>("[data-structural-column-handle='0']")!;
        handle.focus();
        handle.click();
      } else {
        dispatchPointerDown(cell(0, 0), "mouse");
        cell(2, 2).dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      }
      const active = document.activeElement as HTMLElement;
      const event = dispatchOwnedGridKey(active, key);
      expect(event.defaultPrevented).toBe(true);

      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table).toMatchObject({
        valid: true,
        columnCount: 3,
        headerRowCount: 1,
        rowHeaderColumnCount: 1,
      });
      expect(table.alignments).toEqual(["default", "center", "right"]);
      expect(table.rows[0]!.cells[2]!.marker).toBe("left");

      if (mode === "single") {
        expect(table.rows[1]!.cells.map((item) => item.content)).toEqual(["R1", "", "B"]);
      } else if (mode === "partial") {
        expect(table.rows[1]!.cells.map((item) => item.content)).toEqual(["R1", "", ""]);
      } else if (mode === "row") {
        expect(table.rows[1]!.cells.filter((item) => !item.covered).every((item) => item.content === "")).toBe(true);
      } else if (mode === "column") {
        expect(table.rows.map((row) => row.cells[0]!.content)).toEqual(["", "", ""]);
      } else {
        expect(table.rows.every((row) => row.cells.filter((item) => !item.covered).every((item) => item.content === ""))).toBe(true);
      }
      expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("runs Scope capture and DOM fallback through one clear handler without duplicate writes", () => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => {
      if (update.docChanged) writes += 1;
    });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    try {
      const select = () => {
        const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
        dispatchPointerDown(cell, "mouse");
        return cell;
      };
      const first = select();
      const captured = dispatchOwnedGridKey(first, "Delete", true);
      expect(captured.defaultPrevented).toBe(true);
      expect(writes).toBe(1);

      expect(undo(view)).toBe(true);
      const second = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(second, "mouse");
      const bubbled = dispatchOwnedGridKey(second, "Backspace", false);
      expect(bubbled.defaultPrevented).toBe(true);
      expect(writes).toBe(3);
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[1]!.content).toBe("");
    } finally {
      view.destroy();
    }
  });

  it("does not turn textarea Delete or Backspace into a grid operation", () => {
    const source = "| H | V |\n| --- || --- |\n| A | West |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(1, 3);
      for (const key of ["Delete", "Backspace"] as const) {
        const keyEvent = dispatchOwnedGridKey(editor, key);
        expect(keyEvent.defaultPrevented).toBe(false);
      }
      const before = draftInputEvent("beforeinput", "deleteContentBackward", null);
      expect(editor.dispatchEvent(before)).toBe(true);
      editor.setRangeText("", editor.selectionStart, editor.selectionEnd, "end");
      editor.dispatchEvent(draftInputEvent("input", "deleteContentBackward", null));
      expect(editor.value).toBe("Wt");
      expect(view.state.doc.toString()).toBe(source);
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("keeps an empty clear byte-stable and adds no extra history entry", () => {
    const source = "| H | V |\n| --- || --- |\n| A |  |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(cell, "mouse");
      const event = dispatchOwnedGridKey(cell, "Delete");
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
    } finally {
      view.destroy();
    }
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

  it.each([
    ["ctrl", "b", "**"],
    ["meta", "b", "**"],
    ["ctrl", "i", "*"],
    ["meta", "i", "*"],
  ] as const)("owns %s Mod+%s in Scope capture before textarea bubbling",
    (platform, key, marker) => {
      const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
      const { app, parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
      const saved = source.indexOf("West");
      const inherited = vi.fn((event: KeyboardEvent) => {
        event.preventDefault();
        view.dispatch({ changes: { from: saved, to: saved + 4, insert: "**West**" } });
        return false;
      });
      app.scope.register(["Mod"], key, inherited);
      try {
        const cell = parent.querySelector<HTMLElement>(
          "[data-structural-row='1'][data-structural-column='1']",
        )!;
        cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
        replaceDraftText(editor, "West draft");
        editor.select();
        const bubbled = vi.fn();
        editor.addEventListener("keydown", bubbled);

        const event = dispatchDraftShortcut(editor, key, platform);

        expect(inherited).not.toHaveBeenCalled();
        expect(bubbled).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
        expect(editor.isConnected).toBe(true);
        expect(document.activeElement).toBe(editor);
        expect(editor.value).toBe(`${marker}West draft${marker}`);
        expect(editor.selectionStart).toBe(marker.length);
        expect(editor.selectionEnd).toBe(marker.length + "West draft".length);
        expect(view.state.doc.toString()).toBe(source);
      } finally {
        view.destroy();
      }
    });

  it("matches Mod to one configured platform modifier instead of either modifier", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();
      setMockModKey("meta");
      const ctrl = new KeyboardEvent("keydown", {
        key: "b", ctrlKey: true, bubbles: true, cancelable: true,
      });
      expect(dispatchScopeCaptureThenDom(editor, ctrl)).toBe(false);
      expect(ctrl.defaultPrevented).toBe(false);
      expect(editor.value).toBe("West");

      const meta = dispatchDraftShortcut(editor, "b", "meta");
      expect(meta.defaultPrevented).toBe(true);
      expect(editor.value).toBe("**West**");
    } finally {
      view.destroy();
    }
  });

  it.each([
    {
      name: "italic inside bold",
      value: "**West**", start: 2, end: 6, key: "i", expected: "***West***", selection: [3, 7],
    },
    {
      name: "italic over whole bold value",
      value: "**West**", start: 0, end: 8, key: "i", expected: "***West***", selection: [3, 7],
    },
    {
      name: "bold off inside bold+italic",
      value: "***West***", start: 3, end: 7, key: "b", expected: "*West*", selection: [1, 5],
    },
    {
      name: "italic off inside bold+italic",
      value: "***West***", start: 3, end: 7, key: "i", expected: "**West**", selection: [2, 6],
    },
    {
      name: "partial selection",
      value: "West coast", start: 0, end: 4, key: "i", expected: "*West* coast", selection: [1, 5],
    },
    {
      name: "literal star inside selection",
      value: "4 * 5 = 20", start: 0, end: 10, key: "b", expected: "**4 * 5 = 20**", selection: [2, 12],
    },
    {
      name: "inner bold wrapper selected inside bold+italic",
      value: "***West***", start: 1, end: 9, key: "b", expected: "*West*", selection: [1, 5],
    },
  ] as const)("preserves other Markdown emphasis while toggling $name", ({ value, start, end, key, expected, selection }) => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = value;
      editor.setSelectionRange(start, end);

      dispatchDraftShortcut(editor, key);

      expect(editor.value).toBe(expected);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual(selection);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it.each([
    {
      name: "intraword italic marker selection",
      value: "a*!*b", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword italic content-only selection",
      value: "a*!*b", start: 2, end: 3, key: "i",
    },
    {
      name: "intraword bold marker selection",
      value: "a**!**b", start: 1, end: 6, key: "b",
    },
    {
      name: "intraword bold content-only selection",
      value: "a**!**b", start: 3, end: 4, key: "b",
    },
    {
      name: "intraword Unicode punctuation marker selection",
      value: "中*！*文", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword Unicode punctuation content-only selection",
      value: "中*！*文", start: 2, end: 3, key: "i",
    },
    {
      name: "intraword plus symbol marker selection",
      value: "a*+*b", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword plus symbol content-only selection",
      value: "a*+*b", start: 2, end: 3, key: "i",
    },
    {
      name: "intraword dollar symbol marker selection",
      value: "a*$*b", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword dollar symbol content-only selection",
      value: "a*$*b", start: 2, end: 3, key: "i",
    },
    {
      name: "intraword Unicode symbol marker selection",
      value: "a*©*b", start: 1, end: 4, key: "i",
    },
    {
      name: "intraword Unicode symbol content-only selection",
      value: "a*©*b", start: 2, end: 3, key: "i",
    },
  ] as const)("keeps non-flanking literal stars for $name", ({ value, start, end, key }) => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = value;
      editor.setSelectionRange(start, end);

      dispatchDraftShortcut(editor, key);

      expect(editor.value).toBe(value);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([start, end]);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it.each([
    {
      name: "standalone italic punctuation wrapper",
      value: "*!*", start: 0, end: 3, key: "i", expected: "!",
    },
    {
      name: "standalone italic punctuation content",
      value: "*!*", start: 1, end: 2, key: "i", expected: "!",
    },
    {
      name: "standalone bold punctuation wrapper",
      value: "**!**", start: 0, end: 5, key: "b", expected: "!",
    },
    {
      name: "standalone bold punctuation content",
      value: "**!**", start: 2, end: 3, key: "b", expected: "!",
    },
    {
      name: "standalone Unicode punctuation wrapper",
      value: "*！*", start: 0, end: 3, key: "i", expected: "！",
    },
    {
      name: "standalone Unicode punctuation content",
      value: "*！*", start: 1, end: 2, key: "i", expected: "！",
    },
    {
      name: "standalone plus symbol wrapper",
      value: "*+*", start: 0, end: 3, key: "i", expected: "+",
    },
    {
      name: "standalone plus symbol content",
      value: "*+*", start: 1, end: 2, key: "i", expected: "+",
    },
    {
      name: "standalone dollar symbol wrapper",
      value: "*$*", start: 0, end: 3, key: "i", expected: "$",
    },
    {
      name: "standalone dollar symbol content",
      value: "*$*", start: 1, end: 2, key: "i", expected: "$",
    },
    {
      name: "standalone Unicode symbol wrapper",
      value: "*©*", start: 0, end: 3, key: "i", expected: "©",
    },
    {
      name: "standalone Unicode symbol content",
      value: "*©*", start: 1, end: 2, key: "i", expected: "©",
    },
  ] as const)("recognizes flanking punctuation emphasis for $name", ({ value, start, end, key, expected }) => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = value;
      editor.setSelectionRange(start, end);

      dispatchDraftShortcut(editor, key);

      expect(editor.value).toBe(expected);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, expected.length]);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("toggles the same format repeatedly without removing the other format", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();

      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("**West**");
      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("West");
      dispatchDraftShortcut(editor, "i");
      expect(editor.value).toBe("*West*");
      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("***West***");
      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("*West*");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it.each([
    {
      name: "whitespace-delimited whole selection",
      value: "* West *", start: 0, end: 8, key: "i",
    },
    {
      name: "whitespace-delimited embedded selection",
      value: "literal * West * end", start: 8, end: 16, key: "i",
    },
    {
      name: "partial combined run",
      value: "***West***", start: 0, end: 9, key: "b",
    },
    {
      name: "escaped complete wrapper",
      value: String.raw`\*West\*`, start: 1, end: 8, key: "i",
    },
  ] as const)("keeps ambiguous or invalid star delimiters literal for $name", ({ value, start, end, key }) => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = value;
      editor.setSelectionRange(start, end);

      dispatchDraftShortcut(editor, key);

      expect(editor.value).toBe(value);
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([start, end]);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("does not interpret escaped stars as an existing emphasis wrapper", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = String.raw`\*West\*`;
      editor.setSelectionRange(2, 6);

      dispatchDraftShortcut(editor, "b");

      expect(editor.value.slice(0, 2)).toBe(String.raw`\*`);
      expect(editor.value.slice(-2)).toBe(String.raw`\*`);
      expect(editor.value.slice(2, -2)).toBe("**West**");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("inserts an empty marker pair at a collapsed draft selection", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(4, 4);

      dispatchDraftShortcut(editor, "i");

      expect(editor.value).toBe("West**");
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([5, 5]);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("undoes typing then draft formatting in reverse order without touching main-editor history", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inheritedUndo = vi.fn(() => false);
    app.scope.register(["Mod"], "z", inheritedUndo);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("**West draft**");

      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West draft");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");

      expect(inheritedUndo).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("redoes draft typing with Ctrl+Y and formatting with Mod+Shift+Z", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inheritedRedoY = vi.fn(() => false);
    const inheritedRedoZ = vi.fn(() => false);
    app.scope.register(["Ctrl"], "y", inheritedRedoY);
    app.scope.register(["Mod", "Shift"], "z", inheritedRedoZ);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");

      dispatchDraftShortcut(editor, "z");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");

      const redoTyping = new KeyboardEvent("keydown", {
        key: "y", ctrlKey: true, bubbles: true, cancelable: true,
      });
      setMockModKey("ctrl");
      dispatchScopeCaptureThenDom(editor, redoTyping);
      expect(redoTyping.defaultPrevented).toBe(true);
      expect(editor.value).toBe("West draft");

      const redoFormat = dispatchDraftShortcut(editor, "z", "ctrl", true);
      expect(redoFormat.defaultPrevented).toBe(true);
      expect(editor.value).toBe("**West draft**");
      expect(inheritedRedoY).not.toHaveBeenCalled();
      expect(inheritedRedoZ).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("clears draft redo after new typing following undo", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inheritedRedo = vi.fn(() => false);
    app.scope.register(["Mod", "Shift"], "z", inheritedRedo);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West draft");

      editor.setSelectionRange(editor.value.length, editor.value.length);
      typeDraftText(editor, " X");
      expect(editor.value).toBe("West draft X");

      const redo = dispatchDraftShortcut(editor, "z", "ctrl", true);
      expect(redo.defaultPrevented).toBe(true);
      expect(editor.value).toBe("West draft X");
      expect(inheritedRedo).not.toHaveBeenCalled();

      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West draft");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("undoes typing -> format -> continued typing as three draft transactions", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inheritedUndo = vi.fn(() => false);
    app.scope.register(["Mod"], "z", inheritedUndo);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");
      editor.setSelectionRange(editor.value.length, editor.value.length);
      typeDraftText(editor, "!");
      expect(editor.value).toBe("**West draft**!");

      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("**West draft**");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West draft");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");

      expect(inheritedUndo).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("keeps paste and Shift+Enter in the same explicit draft history", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(editor.value.length, editor.value.length);
      editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", shiftKey: true, bubbles: true, cancelable: true,
      }));
      expect(editor.value).toBe("West\n");

      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", {
        value: { getData: (type: string) => type === "text/plain" ? "next" : "" },
      });
      editor.dispatchEvent(paste);
      expect(editor.value).toBe("West\nnext");

      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West\n");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("records one composition input transaction and keeps formatting commands out of it", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inherited = vi.fn(() => false);
    app.scope.register(["Mod"], "b", inherited);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
      const before = draftInputEvent("beforeinput", "insertCompositionText", "中", true);
      expect(editor.dispatchEvent(before)).toBe(true);
      editor.setRangeText("中", editor.selectionStart, editor.selectionEnd, "end");
      editor.dispatchEvent(draftInputEvent("input", "insertCompositionText", "中", true));

      const format = modEvent("b");
      Object.defineProperty(format, "isComposing", { value: true });
      dispatchScopeCaptureThenDom(editor, format);
      expect(format.defaultPrevented).toBe(true);
      expect(inherited).not.toHaveBeenCalled();
      expect(editor.value).toBe("中");

      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" }));
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("commits a draft-local format as one main-document history change", async () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");
      expect(view.state.doc.toString()).toBe(source);

      editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      expect(view.state.doc.toString()).toContain("**West draft**");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("retains a formatted draft when a real external source change invalidates its widget", async () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");

      const saved = source.indexOf("West");
      view.dispatch({ changes: { from: saved, to: saved + 4, insert: "External" } });
      await Promise.resolve();
      await Promise.resolve();

      expect(view.state.doc.toString()).toContain("External");
      expect(view.state.doc.toString()).not.toContain("West draft");
      expect(recoveredCellDrafts(app).map((draft) => draft.text)).toContain("**West draft**");
    } finally {
      view.destroy();
    }
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

  it("does not reclaim focus after IME composition hands a rejected draft to external UI", async () => {
    const source = "| A | B |\n| --- | --- |\n| First | | < |";
    const noticeStart = notices.length;
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    const external = document.body.appendChild(document.createElement("button"));
    external.textContent = "Outside";
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "IME draft";
      editor.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "IME",
      }));
      expect(document.activeElement).toBe(editor);
      expect(activeScopes).toHaveLength(1);

      external.focus();
      expect(document.activeElement).toBe(external);
      expect(activeScopes).toHaveLength(0);

      editor.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "IME draft",
      }));
      await Promise.resolve();
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true);
      expect(editor.value).toBe("IME draft");
      expect(document.activeElement).toBe(external);
      expect(activeScopes).toHaveLength(0);
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells")))
        .toHaveLength(1);

      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      expect(document.activeElement).toBe(external);
    } finally {
      view.destroy();
    }
    await Promise.resolve();
    expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value)
      .toBe("IME draft");
  });

  it("keeps rejected-draft focus ownership during a temporary cell context-menu blur", async () => {
    const source = "| A | B |\n| --- | --- |\n| First | | < |";
    const noticeStart = notices.length;
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    const external = document.body.appendChild(document.createElement("button"));
    external.textContent = "Menu surface";
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Menu draft";
      editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells")))
        .toHaveLength(1);

      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu).not.toBeNull();
      external.focus();
      expect(document.activeElement).toBe(external);
      expect(activeScopes).toHaveLength(0);

      lastMenu?.hide();
      await vi.waitFor(() => expect(document.activeElement).toBe(editor));

      expect(editor.value).toBe("Menu draft");
      expect(view.state.doc.toString()).toBe(source);
      expect(activeScopes).toHaveLength(1);
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells")))
        .toHaveLength(1);
    } finally {
      view.destroy();
    }
  });

  it("moves focus between rejected drafts in separate table widgets without a refocus loop", async () => {
    const source = [
      "| A | B |",
      "| --- | --- |",
      "| First | | < |",
      "",
      "| C | D |",
      "| --- | --- |",
      "| First | | ^ |",
    ].join("\n");
    const noticeStart = notices.length;
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      expect(hosts).toHaveLength(2);
      const firstCell = hosts[0]!.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      firstCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const firstEditor = hosts[0]!.querySelector<HTMLTextAreaElement>("textarea")!;
      firstEditor.value = "B";
      firstEditor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(source);
      expect(firstEditor.value).toBe("B");
      expect(document.activeElement).toBe(firstEditor);
      expect(activeScopes).toHaveLength(1);
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells"))).toHaveLength(1);

      const secondCell = hosts[1]!.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      secondCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const secondEditor = hosts[1]!.querySelector<HTMLTextAreaElement>("textarea")!;
      await Promise.resolve();
      await Promise.resolve();

      expect(parent.querySelectorAll(".structural-tables-cell-editor")).toHaveLength(2);
      expect(document.activeElement).toBe(secondEditor);
      expect(firstEditor.value).toBe("B");
      expect(activeScopes).toHaveLength(1);
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells"))).toHaveLength(1);

      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      expect(document.activeElement).toBe(secondEditor);

      secondEditor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      }));
      expect(hosts[1]!.querySelector("textarea")).toBeNull();
      expect(firstEditor.isConnected).toBe(true);
      expect(firstEditor.value).toBe("B");

      firstEditor.focus();
      await Promise.resolve();
      expect(document.activeElement).toBe(firstEditor);
      expect(activeScopes).toHaveLength(1);
    } finally {
      view.destroy();
    }
    await Promise.resolve();
    expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value).toBe("B");
  });

  it("keeps rejected-draft focus ownership stable across separate editor views", async () => {
    const leftSource = "| A | B |\n| --- | --- |\n| First | | < |";
    const rightSource = "| C | D |\n| --- | --- |\n| First | | ^ |";
    const left = mountEditor(
      leftSource,
      { anchor: leftSource.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    const right = mountEditor(
      rightSource,
      { anchor: rightSource.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const leftCell = left.parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      leftCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const leftEditor = left.parent.querySelector<HTMLTextAreaElement>("textarea")!;
      leftEditor.value = "Left draft";
      leftEditor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      const rightCell = right.parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      rightCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const rightEditor = right.parent.querySelector<HTMLTextAreaElement>("textarea")!;
      await Promise.resolve();
      await Promise.resolve();

      expect(leftEditor.isConnected).toBe(true);
      expect(leftEditor.value).toBe("Left draft");
      expect(document.activeElement).toBe(rightEditor);
      expect(activeScopes).toHaveLength(1);
      expect(left.view.state.doc.toString()).toBe(leftSource);
      expect(right.view.state.doc.toString()).toBe(rightSource);

      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      expect(document.activeElement).toBe(rightEditor);
    } finally {
      right.view.destroy();
      left.view.destroy();
    }
  });

  it("lets another widget commit successfully while a rejected draft remains recoverable", async () => {
    const source = [
      "| A | B |",
      "| --- | --- |",
      "| First | | < |",
      "",
      "| Safe | Value |",
      "| --- | --- |",
      "| First | 1 |",
    ].join("\n");
    const noticeStart = notices.length;
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      expect(hosts).toHaveLength(2);
      hosts[0]!.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const rejected = hosts[0]!.querySelector<HTMLTextAreaElement>("textarea")!;
      rejected.value = "Rejected draft";
      rejected.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      hosts[1]!.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const successful = hosts[1]!.querySelector<HTMLTextAreaElement>("textarea")!;
      successful.value = "Saved elsewhere";
      successful.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      const parsed = parseEditableTables(view.state.doc.toString()).tables;
      expect(parsed[1]?.rows[1]?.cells[0]?.content).toBe("Saved elsewhere");
      expect(parsed[0]?.source).toBe("| A | B |\n| --- | --- |\n| First | | < |");
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells"))).toHaveLength(1);
    } finally {
      view.destroy();
    }
    await Promise.resolve();
    expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value)
      .toBe("Rejected draft");
  });

  it("keeps an in-place draft when hidden GFM overflow makes the table read-only", async () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 | KEEP |";
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Draft stays";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(source);
      expect(parent.querySelector<HTMLTextAreaElement>("textarea")).toBe(editor);
      expect(editor.value).toBe("Draft stays");
      expect(document.activeElement).toBe(editor);
    } finally {
      view.destroy();
    }
  });

  it.each(["<", "^"])("keeps hidden %s markers native by default and refuses lossy editing after opt-in", async (marker) => {
    const source = `| Name | Status |\n| --- | --- |\n| Alice | Doing | ${marker} |`;
    const mounted = mountEditor(source, { anchor: source.length });
    try {
      expect(mounted.parent.querySelector(".structural-tables-live-preview")).toBeNull();
      mounted.updateSettings({ takeOverOrdinaryTables: true });
      const host = mounted.parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      expect(host.dataset.tableKind).toBe("ordinary");
      const cell = host.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Keep this draft";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      await Promise.resolve();
      expect(mounted.view.state.doc.toString()).toBe(source);
      expect(mounted.parent.querySelector("textarea")).toBe(editor);
      expect(editor.value).toBe("Keep this draft");
      mounted.updateSettings({ takeOverOrdinaryTables: false });
      expect(mounted.parent.querySelector(".structural-tables-live-preview")).toBeNull();
      expect(mounted.view.state.doc.toString()).toBe(source);
    } finally {
      mounted.view.destroy();
    }
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
    expect(editor.value).toBe("[[Target|Alias]]");
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
    expect(editor.value).toBe('"First"\nSecond');
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(view.state.doc.toString()).toContain('"First"<br>Second');
    view.destroy();
  });

  it("keeps an unsafe math draft and applies a user-confirmed safe rewrite from its context menu", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor")!;
      editor.value = "$|x|$";

      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true);

      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const item = lastMenu?.items.find((candidate) => candidate.title === "Use \\lvert … \\rvert and save");
      expect(item).toBeDefined();
      item?.callback?.();
      await Promise.resolve();

      const parsed = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(parsed.columnCount).toBe(2);
      expect(parsed.rows[1]!.cells[1]!.content).toBe(String.raw`$\lvert x\rvert$`);
      expect(parent.querySelector(".structural-tables-cell-editor")).toBeNull();
    } finally { view.destroy(); }
  });
  it.each(["Enter", "Tab"])("keeps unsafe drafts without navigation or growth on %s", (key) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = String.raw`$P(\text{A|B})$`;
      editor.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true);
      expect(editor.value).toBe(String.raw`$P(\text{A|B})$`);
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu?.items.some((item) => item.title.startsWith("Use \\"))).toBe(false);
      lastMenu?.hide();
      const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      expect(activeScopes[0]!.handlers.find((handler) => handler.key === "Escape")!.callback(escape)).toBeUndefined();
      editor.dispatchEvent(escape);
      expect(editor.isConnected).toBe(true);
      expect(editor.value).toBe(String.raw`$P(\text{A|B})$`);
    } finally { view.destroy(); }
  });

  it.each(["cancel", "changed", "composing"])("does not apply a suggestion after %s", async (action) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "$|x|$";
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const item = lastMenu?.items.find((candidate) => candidate.title === "Use \\lvert … \\rvert and save");
      expect(item).toBeDefined();
      if (action === "changed") editor.value = "$|y|$";
      if (action === "composing") editor.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      if (action !== "cancel") item?.callback?.();
      lastMenu?.hide();
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true);
      expect(editor.value).toBe(action === "changed" ? "$|y|$" : "$|x|$");
    } finally { view.destroy(); }
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

  it("expands the editing row for a long draft and restores its height on cancel", () => {
    const source = "| Name | Value |\n| --- || --- |\n| A | Short |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 120, height: 32, right: 120, bottom: 32, x: 0, y: 0, toJSON: () => ({}),
    });
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
    const row = cell.closest<HTMLTableRowElement>("tr")!;
    Object.defineProperty(editor, "scrollHeight", { configurable: true, get: () => 144 });

    editor.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.style.getPropertyValue("--structural-table-edit-row-height")).toBe("144px");

    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(row.style.getPropertyValue("--structural-table-edit-row-height")).toBe("0px");
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
    expect(editor.value).toBe("First\n");

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: () => "Second\r\nThird" } });
    editor.dispatchEvent(paste);
    expect(editor.value).toBe("First\nSecond\r\nThird");

    editor.setSelectionRange(5, 5);
    editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    const item = lastMenu?.items.find((candidate) => candidate.title === "Insert line break in cell");
    expect(item).toBeDefined();
    item?.callback?.();
    expect(editor.value).toBe("First\n\nSecond\r\nThird");
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

  it("preserves selected text through Gboard's empty replacement before Enter while allowing deliberate deletion", () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Software | Applications |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const open = () => {
      parent.querySelector("[data-structural-row='1'][data-structural-column='1']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return parent.querySelector("textarea")!;
    };
    try {
      const editor = open();
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Unidentified", bubbles: true }));
      const empty = new InputEvent("beforeinput", { inputType: "insertText", data: "", bubbles: true, cancelable: true });
      // Simulate the browser's default replacement only when it was not cancelled.
      if (editor.dispatchEvent(empty)) editor.setRangeText("", editor.selectionStart, editor.selectionEnd, "end");
      editor.dispatchEvent(new KeyboardEvent("keyup", { key: "Unidentified", bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(empty.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);

      const deleting = open();
      const deletion = new InputEvent("beforeinput", { inputType: "deleteContentBackward", data: null, bubbles: true, cancelable: true });
      expect(deleting.dispatchEvent(deletion)).toBe(true);
      deleting.setRangeText("", deleting.selectionStart, deleting.selectionEnd, "end");
      deleting.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(view.state.doc.toString()).not.toContain("Applications");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);

      const composing = open();
      composing.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const compositionInput = new InputEvent("beforeinput", { inputType: "insertText", data: "", bubbles: true, cancelable: true });
      expect(composing.dispatchEvent(compositionInput)).toBe(true);
      composing.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
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

describe("interrupted drafts and contextual paste", () => {
  it.each(["<!--", "%%"].flatMap(draft => ["Enter", "Tab", "blur", "row", "column"].map(action => ({ draft, action })) ))("retains protected draft $draft on $action without truncating the table", async ({ draft, action }) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP-1 |\n| B | KEEP-2 |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.value = draft;
    if (action === "blur") editor.dispatchEvent(new FocusEvent("blur"));
    else if (action === "row" || action === "column") parent.querySelector<HTMLButtonElement>(`.structural-tables-add-${action}`)!.click();
    else editor.dispatchEvent(new KeyboardEvent("keydown", { key: action, bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe(source);
    expect(parent.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe(draft);
    view.destroy();
    await Promise.resolve();
    expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value).toBe(draft);
  });

  it.each(["Enter", "Tab", "blur"])("retains a pasted math fragment and refuses %s without changing source or adding a row", async (action) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | $P(A B)$ |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.setSelectionRange(4, 5);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? "|" : "" } });
    editor.dispatchEvent(paste);
    expect(editor.value).toBe("$P(A|B)$");
    if (action === "blur") editor.dispatchEvent(new FocusEvent("blur"));
    else editor.dispatchEvent(new KeyboardEvent("keydown", { key: action, bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(view.state.doc.toString()).toBe(source);
    expect(parent.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("$P(A|B)$");
    view.destroy();
    await Promise.resolve();
    expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value).toBe("$P(A|B)$");
  });

  it("retains complete multiline math across failed commit and presentation refresh", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const draft = "$$\n\\begin{aligned}\na&=b\\\\\nc&=d\n\\end{aligned}\n$$";
    const { parent, view, updateSettings } = mountEditor(source, { anchor: 0 });
    parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.select();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? draft : "" } });
    editor.dispatchEvent(paste);
    expect(editor.value).toBe(draft);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(view.state.doc.toString()).toBe(source);
    updateSettings({ density: "compact" });
    await Promise.resolve();
    expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value).toBe(draft);
    view.destroy();
  });

  it("keeps Shift+Enter inside a formula as a real draft newline", () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | $ab$ |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!
      .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.setSelectionRange(2, 2);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    expect(editor.value).toBe("$a\nb$");
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(view.state.doc.toString()).toBe(source);
    view.destroy();
  });
  it("keeps an accessible draft when another cell is changed externally", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "UNSAVED USER DRAFT";
      const position = source.indexOf("| A | B") + 6;
      view.dispatch({ changes: { from: position, to: position + 1, insert: "External" } });
      await Promise.resolve();
      expect(view.state.doc.toString()).toContain("External");
      expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value).toBe("UNSAVED USER DRAFT");
      expect(view.state.doc.toString()).not.toContain("UNSAVED USER DRAFT");
    } finally { view.destroy(); }
  });

  it("keeps an accessible draft across a presentation refresh", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view, updateSettings } = mountEditor(source, { anchor: 0 });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      parent.querySelector<HTMLTextAreaElement>("textarea")!.value = "UNSAVED USER DRAFT";
      updateSettings({ density: "compact" });
      await Promise.resolve();
      expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value).toBe("UNSAVED USER DRAFT");
      expect(view.state.doc.toString()).not.toContain("UNSAVED USER DRAFT");
    } finally { view.destroy(); }
  });

  it("pastes a pipe into an existing code span without adding a literal backslash", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | `ab` |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(2, 2);
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? "|" : "" } });
      editor.dispatchEvent(paste);
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
      const content = parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[1]!.content;
      expect(content).toBe("`a|b`");
    } finally { view.destroy(); }
  });
});
describe("wide-table keyboard entry", () => {
  it("keeps a visible column handle in the Tab sequence after horizontal scrolling", () => {
    let horizontalOffset = 0;
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("structural-tables-live-preview")) return rect(0, 0, 180, 140);
      if (this.classList.contains("structural-tables-container")) return rect(40, 20, 100, 80);
      if (this.tagName === "TABLE") return rect(40 - horizontalOffset, 20, 300, 80);
      if (this.tagName === "TR") return rect(40 - horizontalOffset, 20, 300, 40);
      if (this.dataset.structuralColumn !== undefined) return rect(40 - horizontalOffset + Number(this.dataset.structuralColumn) * 100, 20, 100, 40);
      return rect(0, 0, 0, 0);
    });
    const source = "Before\n\n| H | V | W |\n| --- || --- | --- |\n| A | B | C |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      horizontalOffset = 100;
      parent.querySelector(".structural-tables-container")!.dispatchEvent(new Event("scroll"));
      const handles = [...parent.querySelectorAll<HTMLButtonElement>(".structural-tables-column-handle")];
      expect(handles.some((handle) => !handle.hidden)).toBe(true);
      expect(handles.some((handle) => !handle.hidden && handle.tabIndex === 0)).toBe(true);
    } finally { view.destroy(); }
  });
});

it("third-party DOM mutation keeps a detached ordinary-table widget stable", async () => {
  const source = "Before\n\n| Name | Value |\n| --- | --- |\n| Target | 10 |\n\nEnd";
  const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, markdown, target) => {
    const link = target.ownerDocument.createElement("a");
    link.className = "review-virtual-link";
    link.textContent = markdown;
    target.replaceChildren(link);
  });
  const { parent, view } = mountEditor(source, { anchor: 0 }, [], undefined, { takeOverOrdinaryTables: true });
  try {
    parent.remove();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const host = parent.querySelector(".structural-tables-live-preview");
    expect(host).not.toBeNull();
    expect(parent.querySelectorAll(".review-virtual-link")).toHaveLength(4);
    expect(render).toHaveBeenCalledTimes(4);
    document.body.appendChild(parent);
    for (let index = 0; index < 5; index += 1) {
      const link = parent.querySelector(".review-virtual-link")!;
      link.appendChild(document.createTextNode(" "));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
    }
    parent.remove();
    await new Promise((resolve) => setTimeout(resolve, 10));
    document.body.appendChild(parent);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
    expect(render).toHaveBeenCalledTimes(4);
    expect(view.state.doc.toString()).toBe(source);
  } finally { view.destroy(); }
});
