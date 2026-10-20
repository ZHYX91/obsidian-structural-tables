// @vitest-environment happy-dom

import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { Component, MarkdownView, editorInfoField, type App, type Editor, type EditorPosition, type TFile as HostFile } from "obsidian";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { NativeTableMenuBridge } from "../src/editor/native-table-menu";
import { NativeTableWidget } from "./helpers/native-table-widget";
import { clickLikeUser } from "./helpers/host-gestures";
import { installSelectionChangeTasks } from "./mocks/selection-events";
import { Menu, TFile } from "./mocks/obsidian";

const SOURCE = "| Name | Value |\n| --- | --- |\n| North | 1 |";
const editors: EditorView[] = [];
const components: Component[] = [];
let restoreSelection: () => void;
beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { text?: string }): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag); if (options?.text !== undefined) element.textContent = options.text; this.append(element); return element;
  };
  HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
});
beforeEach(() => { restoreSelection = installSelectionChangeTasks(document); });
afterEach(() => { components.splice(0).forEach((component) => component.unload()); editors.splice(0).forEach((editor) => editor.destroy()); document.body.replaceChildren(); restoreSelection(); vi.restoreAllMocks(); });

function note(parent: HTMLElement, source = SOURCE) {
  const containerEl = parent.appendChild(document.createElement("div"));
  const file = new TFile(`Note${editors.length}.md`);
  let cm: EditorView; let writes = 0;
  const posToOffset = (pos: EditorPosition) => cm.state.doc.line(pos.line + 1).from + pos.ch;
  const editor = { getValue: () => cm.state.doc.toString(), getCursor: () => ({ line: 2, ch: 2 }),
    posToOffset, offsetToPos: (offset: number) => { const line = cm.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from }; },
    replaceRange: (insert: string, from: EditorPosition, to: EditorPosition) => cm.dispatch({ changes: { from: posToOffset(from), to: posToOffset(to), insert } }),
  } as unknown as Editor;
  const tables = parseEditableTables(source).tables;
  const widgets = tables.map((table) => new NativeTableWidget(table, true));
  cm = new EditorView({ parent: containerEl, state: EditorState.create({ doc: source, extensions: [history(),
    editorInfoField.init(() => ({ editor, file: file as unknown as HostFile, app: {} as App, hoverPopover: null })),
    EditorView.decorations.of(Decoration.set(tables.map((table, index) => Decoration.replace({ widget: widgets[index]!, block: true }).range(table.range.from, table.range.to)))),
    EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; }),
  ] }) });
  editors.push(cm);
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { containerEl, editor, file });
  return { view, cm, widgets, writes: () => writes };
}

function bridge(notes: ReturnType<typeof note>[]) {
  const component = new Component(); components.push(component);
  const app = { vault: { getFileByPath: (path: string) => notes.find((note) => note.view.file?.path === path)?.view.file ?? null }, workspace: {
    iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => notes.forEach(({ view }) => callback({ view })), on: () => ({}),
  } } as unknown as App;
  new NativeTableMenuBridge(app, () => ({ ...DEFAULT_SETTINGS, language: "en" }), () => {}).register(component);
}

function transposeCell(cell: HTMLElement): boolean {
  const event = new MouseEvent("contextmenu", { bubbles: true, button: 2 });
  const menu = Menu.forEvent(event);
  cell.dispatchEvent(event);
  const item = menu.items.find((item) => item.title === "Transpose whole table (swap rows and columns)");
  item?.callback?.();
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Transpose anyway");
  if (button !== undefined) clickLikeUser(button);
  return item !== undefined;
}

describe("native table exact target", () => {
  it("transposes only the second of two identical mapped tables while the source cursor stays in the first, with exact undo/redo", () => {
    const source = `Intro stays.\n\n${SOURCE}\n\nBetween stays.\n\n${SOURCE}\n\nAfter stays.`;
    const a = note(document.body, source); bridge([a]);
    const [first, second] = parseEditableTables(source).tables;
    a.cm.dispatch({ selection: { anchor: first!.range.from + 2 } });
    const secondWidget = a.cm.dom.querySelectorAll<HTMLElement>(".cm-table-widget")[1]!;
    expect(transposeCell(secondWidget.querySelector<HTMLElement>("td")!)).toBe(true);
    const transposed = a.cm.state.doc.toString(); const tables = parseEditableTables(transposed).tables;
    expect(a.writes()).toBe(1); expect(undoDepth(a.cm.state)).toBe(1);
    expect(tables[0]!.source).toBe(SOURCE); expect(tables[1]!.rowHeaderColumnCount).toBe(1);
    expect(transposed.slice(0, second!.range.from)).toBe(source.slice(0, second!.range.from));
    expect(transposed.slice(tables[1]!.range.to)).toBe(source.slice(second!.range.to));
    expect(undo(a.cm)).toBe(true); expect(a.cm.state.doc.toString()).toBe(source); expect(undoDepth(a.cm.state)).toBe(0);
    expect(redo(a.cm)).toBe(true); expect(a.cm.state.doc.toString()).toBe(transposed); expect(undoDepth(a.cm.state)).toBe(1);
  });

  it("writes only the clicked nested leaf's full-note CM, even when the outer leaf has identical source and offsets", () => {
    const a = note(document.body); const b = note(a.view.containerEl);
    bridge([a, b]);
    b.widgets[0]!.child!.focus();
    expect(transposeCell(b.cm.dom.querySelector<HTMLElement>("td")!)).toBe(true);
    expect(a.cm.state.doc.toString()).toBe(SOURCE); expect(a.writes()).toBe(0); expect(undoDepth(a.cm.state)).toBe(0);
    expect(b.writes()).toBe(1); expect(parseEditableTables(b.cm.state.doc.toString()).tables[0]!.rowHeaderColumnCount).toBe(1);
  });

  it("refuses an unmapped second table instead of falling back to the first table's cursor", () => {
    const source = `${SOURCE}\n\n${SOURCE}`; const a = note(document.body, source); bridge([a]);
    const second = a.cm.dom.querySelectorAll<HTMLElement>(".cm-table-widget")[1]!;
    vi.spyOn(a.cm, "posAtDOM").mockImplementation(() => { throw new Error("Unmapped widget"); });
    expect(transposeCell(second.querySelector<HTMLElement>("td")!)).toBe(false);
    expect(a.cm.state.doc.toString()).toBe(source); expect(a.writes()).toBe(0); expect(undoDepth(a.cm.state)).toBe(0);
  });
});
