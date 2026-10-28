// @vitest-environment happy-dom

import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState, StateEffect, Transaction } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import type { App, Command, Editor, EditorPosition, TFile as HostFile } from "obsidian";
import { Component, MarkdownView, editorInfoField } from "obsidian";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { StructuralTablesPlugin } from "../src/app/plugin";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { NativeTableMenuBridge } from "../src/editor/native-table-menu";
import { clickLikeUser } from "./helpers/host-gestures";
import { NativeTableWidget } from "./helpers/native-table-widget";
import { parseEditableTables } from "../src/core/parser";
import { lastMenu, Menu, TFile } from "./mocks/obsidian";
import { installSelectionChangeTasks } from "./mocks/selection-events";

const ORIGINAL = "Intro stays.\n\n| Name | Value |\n| --- | --- |\n| North | 1 |\n\nOther prose.\n\n| Other | Table |\n| --- | --- |\n| Keep | 2 |\n\nTail stays.";

beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { text?: string }): HTMLElementTagNameMap[K] {
    const node = this.ownerDocument.createElement(tag);
    if (options?.text !== undefined) node.textContent = options.text;
    this.append(node);
    return node;
  };
  HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
});

let restoreSelection: () => void;
beforeEach(() => { restoreSelection = installSelectionChangeTasks(document); });
afterEach(() => { document.body.replaceChildren(); restoreSelection(); });

describe("transpose editor entry history", () => {
  it.each((["command", "source-menu", "native-menu"] as const).flatMap((entry) => [false, true].flatMap((nativeChild) => [false, true].map((unsafeBoundary) => ({ entry, nativeChild, unsafeBoundary })))))("isolates $entry transpose with native child $nativeChild, unsafe boundary $unsafeBoundary", ({ entry, nativeChild, unsafeBoundary }) => {
    const initial = unsafeBoundary ? "| P | Q | R |\n| Name | Value |\n| --- | --- |\n| North | 1 |\n| South | 2 |" : ORIGINAL;
    const containerEl = document.body.appendChild(document.createElement("div"));
    const file = new TFile("A.md");
    let cm: EditorView;
    const posToOffset = (position: EditorPosition): number => cm.state.doc.line(position.line + 1).from + position.ch;
    const offsetToPos = (offset: number): EditorPosition => {
      const line = cm.state.doc.lineAt(offset);
      return { line: line.number - 1, ch: offset - line.from };
    };
    const editor = {
      getValue: () => cm.state.doc.toString(),
      getCursor: () => offsetToPos(cm.state.selection.main.head),
      getLine: (line: number) => cm.state.doc.line(line + 1).text,
      listSelections: () => [{ anchor: offsetToPos(cm.state.selection.main.anchor), head: offsetToPos(cm.state.selection.main.head) }],
      posToOffset, offsetToPos,
      replaceRange: (insert: string, from: EditorPosition, to: EditorPosition) => cm.dispatch({ changes: { from: posToOffset(from), to: posToOffset(to), insert } }),
      setCursor: (position: EditorPosition) => cm.dispatch({ selection: { anchor: posToOffset(position) } }),
    } as unknown as Editor;
    cm = new EditorView({ parent: containerEl, state: EditorState.create({
      doc: initial,
      extensions: [history(), editorInfoField.init(() => ({ editor, file: file as unknown as HostFile, app: {} as App, hoverPopover: null }))],
    }) });
    const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { containerEl, editor, file });
    let editorMenu: ((menu: Menu, editor: Editor, info: MarkdownView) => void) | undefined;
    const app = {
      vault: { getFileByPath: (path: string) => path === file.path ? file : null },
      workspace: {
        iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => callback({ view }),
        on: (event: string, callback: typeof editorMenu) => { if (event === "editor-menu") editorMenu = callback; return {}; },
      },
    } as unknown as App;
    const commands: Command[] = [];
    const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
      app, settings: { ...DEFAULT_SETTINGS, language: "en" }, localizedCommands: [], transposeRequestsActive: true,
      addCommand: (command: Command) => { commands.push(command); return command; },
    }) as unknown as { registerCommands: () => void; registerEditorMenu: () => void };
    const component = new Component();
    try {
      const offset = initial.indexOf("North") + "North".length;
      cm.dispatch({ changes: { from: offset, insert: "X" }, selection: { anchor: offset + 1 }, annotations: Transaction.userEvent.of("input.type") });
      const beforeTranspose = cm.state.doc.toString();
      const childWidget = nativeChild || entry === "native-menu" ? new NativeTableWidget(parseEditableTables(beforeTranspose).tables[0]!, nativeChild) : null;
      if (childWidget !== null) {
        const table = parseEditableTables(beforeTranspose).tables[0]!;
        cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set([
          Decoration.replace({ widget: childWidget, block: true }).range(table.range.from, table.range.to),
        ]))) });
        if (nativeChild) {
          expect(childWidget.child!.state.field(editorInfoField).editor).toBe(editor);
          expect(childWidget.child!.state.field(editorInfoField).file).toBe(file);
          childWidget.child!.focus();
        }
      }
      if (entry === "command") {
        plugin.registerCommands();
        commands.find((command) => command.id === "transpose-current-table")!.editorCallback!(editor, view);
      } else if (entry === "source-menu") {
        plugin.registerEditorMenu();
        const menu = new Menu();
        editorMenu!(menu, editor, view);
        menu.items.find((item) => item.title === "Transpose whole table (swap rows and columns)")!.callback!();
      } else {
        const native = cm.dom.querySelector<HTMLElement>(".cm-table-widget")!;
        new NativeTableMenuBridge(app, () => ({ ...DEFAULT_SETTINGS, language: "en" }), () => {}).register(component);
        native.querySelector("td")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
        lastMenu!.items.find((item) => item.title === "Transpose whole table (swap rows and columns)")!.callback!();
      }
      const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Transpose anyway")!;
      expect(confirm).toBeDefined();
      let extraWrites = 0;
      cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.updateListener.of((update) => { if (update.docChanged) extraWrites += 1; })) });
      const historyBefore = undoDepth(cm.state);
      clickLikeUser(confirm);
      if (unsafeBoundary) {
        expect(cm.state.doc.toString()).toBe(beforeTranspose); expect(extraWrites).toBe(0); expect(undoDepth(cm.state)).toBe(historyBefore);
        return;
      }
      const transposed = cm.state.doc.toString();
      expect(transposed).toContain("NorthX");
      expect(transposed).toContain("||");
      expect(transposed.slice(transposed.indexOf("\n\nOther prose."))).toBe(ORIGINAL.slice(ORIGINAL.indexOf("\n\nOther prose.")));
      expect(undoDepth(cm.state)).toBe(2);
      expect(undo(cm)).toBe(true);
      expect(cm.state.doc.toString()).toBe(beforeTranspose);
      expect(undo(cm)).toBe(true);
      expect(cm.state.doc.toString()).toBe(ORIGINAL);
      expect(redo(cm)).toBe(true);
      expect(cm.state.doc.toString()).toBe(beforeTranspose);
      expect(redo(cm)).toBe(true);
      expect(cm.state.doc.toString()).toBe(transposed);
      if (childWidget?.child !== null && childWidget?.child !== undefined) expect(childWidget.child.state.doc.toString()).toBe("NorthX");
      cm.dispatch({ changes: { from: cm.state.doc.length, insert: "!" }, annotations: Transaction.userEvent.of("input.type") });
      expect(undo(cm)).toBe(true);
      expect(cm.state.doc.toString()).toBe(transposed);
    } finally { component.unload(); cm.destroy(); }
  });
});


describe("source menu captured ownership", () => {
  it.each((["current", "rebind", "replace", "rename", "detach", "unload", "remount", "adopt"] as const).flatMap((change) =>
    (["selection", "image", "promotion"] as const).map((entry) => ({ change, entry }))))("keeps $entry source menu on its captured owner: $change", ({ change, entry }) => {
    const source = ORIGINAL.replace("| --- | --- |", "| --- || --- |");
    const containerEl = document.body.appendChild(document.createElement("div"));
    const file = new TFile("A.md");
    let stored = file;
    let cm: EditorView;
    const posToOffset = (position: EditorPosition): number => cm.state.doc.line(position.line + 1).from + position.ch;
    const offsetToPos = (offset: number): EditorPosition => {
      const line = cm.state.doc.lineAt(offset);
      return { line: line.number - 1, ch: offset - line.from };
    };
    const editor = {
      getValue: () => cm.state.doc.toString(), getCursor: () => offsetToPos(cm.state.selection.main.head),
      getLine: (line: number) => cm.state.doc.line(line + 1).text,
      listSelections: () => [{ anchor: offsetToPos(cm.state.selection.main.anchor), head: offsetToPos(cm.state.selection.main.head) }],
      posToOffset, offsetToPos,
    } as unknown as Editor;
    const info = { editor, file: file as unknown as HostFile, app: {} as App, hoverPopover: null };
    cm = new EditorView({ parent: containerEl, state: EditorState.create({ doc: source,
      selection: { anchor: source.indexOf("North"), head: source.indexOf("North") + "North | 1".length },
      extensions: [history(), editorInfoField.init(() => info)],
    }) });
    const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { containerEl, editor, file });
    let menuCallback!: (menu: Menu, editor: Editor, view: MarkdownView) => void;
    const app = { vault: { getFileByPath: (path: string) => path === stored.path ? stored : null }, workspace: {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => { if (containerEl.isConnected) callback({ view }); },
      on: (_event: string, callback: typeof menuCallback) => { menuCallback = callback; return {}; },
    } } as unknown as App;
    const invoked = vi.fn();
    const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
      app, settings: { ...DEFAULT_SETTINGS, language: "en" }, transposeRequestsActive: true,
      exportImage: invoked, previewBasePromotion: invoked,
    }) as unknown as StructuralTablesPlugin;
    try {
      (plugin as unknown as { registerEditorMenu: () => void }).registerEditorMenu();
      const menu = new Menu(); menuCallback(menu, editor, view);
      const title = entry === "selection" ? "Insert row below" : entry === "image" ? "Export whole table as image…" : "Expand structure and upgrade to Base…";
      const action = menu.items.find((item) => item.title === title)!;
      expect(action?.callback).toBeTypeOf("function");
      if (change === "rebind" || change === "replace") {
        stored = new TFile(change === "rebind" ? "B.md" : "A.md");
        view.file = stored as unknown as HostFile; info.file = stored as unknown as HostFile;
      } else if (change === "rename") file.path = "Renamed.md";
      else if (change === "detach") containerEl.remove();
      else if (change === "unload") plugin.onunload();
      else if (change === "remount") {
        cm.destroy();
        cm = new EditorView({ parent: containerEl, state: EditorState.create({ doc: source, extensions: [history(), editorInfoField.init(() => info)] }) });
      } else if (change === "adopt") {
        const other = document.implementation.createHTMLDocument("Other window"); other.body.append(other.adoptNode(containerEl));
      }
      const before = undoDepth(cm.state);
      action.callback!();
      if (change === "current" && entry === "selection") {
        expect(parseEditableTables(cm.state.doc.toString()).tables[0]!.rows).toHaveLength(3);
        expect(undoDepth(cm.state)).toBe(before + 1);
        expect(undo(cm)).toBe(true); expect(cm.state.doc.toString()).toBe(source);
      } else {
        expect(cm.state.doc.toString()).toBe(source);
        expect(undoDepth(cm.state)).toBe(before);
      }
      expect(invoked).toHaveBeenCalledTimes(change === "current" && entry !== "selection" ? 1 : 0);
    } finally { cm.destroy(); containerEl.remove(); }
  });
});
