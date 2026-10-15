// @vitest-environment happy-dom

import { EditorState, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { MarkdownRenderer, MarkdownView, editorInfoField, type App, type Command, type Editor, type EditorPosition, type TFile as HostFile } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { StructuralTablesPlugin } from "../src/app/plugin";
import { createTranslator } from "../src/config/i18n";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import * as clipboard from "../src/rendering/table-clipboard";
import { Menu, TFile } from "./mocks/obsidian";

const SOURCE = "| Region | A | B | C |\n| --- || --- | --- | --- |\n| North | One | Two | Three |";
const editors: EditorView[] = [];

class DirectionTableWidget extends WidgetType {
  constructor(private readonly direction: "ltr" | "rtl") { super(); }
  override toDOM(view: EditorView): HTMLElement {
    const host = view.dom.ownerDocument.createElement("div");
    host.className = "structural-tables-live-preview"; host.dataset.structuralSourceTableIndex = "0";
    host.appendChild(view.dom.ownerDocument.createElement("table")).style.direction = this.direction;
    return host;
  }
}

function fixture(outer: "ltr" | "rtl", inner: "ltr" | "rtl", language: "en" | "ar") {
  const containerEl = document.body.appendChild(document.createElement("div"));
  containerEl.style.direction = outer;
  const sourceRoot = containerEl.appendChild(document.createElement("div"));
  sourceRoot.className = "markdown-source-view"; sourceRoot.style.direction = inner;
  const file = new TFile("A.md");
  let cm: EditorView;
  const posToOffset = (position: EditorPosition): number => cm.state.doc.line(position.line + 1).from + position.ch;
  const offsetToPos = (offset: number): EditorPosition => {
    const line = cm.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from };
  };
  const editor = {
    getValue: () => cm.state.doc.toString(), getLine: (line: number) => cm.state.doc.line(line + 1).text,
    getCursor: () => offsetToPos(cm.state.selection.main.head), posToOffset, offsetToPos,
    listSelections: () => [{ anchor: offsetToPos(cm.state.selection.main.anchor), head: offsetToPos(cm.state.selection.main.head) }],
    replaceRange: (insert: string, from: EditorPosition, to: EditorPosition) => cm.dispatch({ changes: { from: posToOffset(from), to: posToOffset(to), insert } }),
    setCursor: (position: EditorPosition) => cm.dispatch({ selection: { anchor: posToOffset(position) } }),
  } as unknown as Editor;
  // Same text and file, first in DOM, opposite direction: it is not this editor.
  const decoy = new EditorView({ parent: sourceRoot, state: EditorState.create({ doc: SOURCE, extensions: [
    editorInfoField.init(() => ({ editor: {} as Editor, file: file as unknown as HostFile, app: {} as App, hoverPopover: null })),
  ] }) });
  decoy.contentDOM.style.direction = outer;
  cm = new EditorView({ parent: sourceRoot, state: EditorState.create({ doc: SOURCE, selection: { anchor: SOURCE.indexOf("Two") }, extensions: [
    editorInfoField.init(() => ({ editor, file: file as unknown as HostFile, app: {} as App, hoverPopover: null })),
  ] }) });
  cm.contentDOM.style.direction = inner;
  editors.push(decoy, cm);
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { containerEl, editor, file });
  let editorMenu: ((menu: Menu, editor: Editor, info: MarkdownView) => void) | undefined;
  const app = {
    vault: { getFileByPath: (path: string) => path === file.path ? file : null },
    workspace: {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => callback({ view }),
      on: (_event: string, callback: typeof editorMenu) => { editorMenu = callback; return {}; },
    },
  } as unknown as App;
  const commands: Command[] = [];
  const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
    app, settings: { ...DEFAULT_SETTINGS, language }, localizedCommands: [], transposeRequestsActive: true,
    addCommand: (command: Command) => { commands.push(command); return command; },
  }) as unknown as { registerCommands: () => void; registerEditorMenu: () => void };
  return { cm, decoy, view, editor, commands, plugin, menu: () => {
    plugin.registerEditorMenu(); const menu = new Menu(); editorMenu!(menu, editor, view); return menu;
  } };
}

beforeAll(() => {
  HTMLElement.prototype.setCssStyles = function setCssStyles(styles: Partial<CSSStyleDeclaration>): void { Object.assign(this.style, styles); };
});

afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("registered table entries use their exact editor direction", () => {
  it.each(["en", "ar"] as const)("copies HTML and maps source menus independently of outer direction and %s UI", async (language) => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => { target.textContent = source; });
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
    const render = vi.spyOn(clipboard, "renderTableClipboard");
    for (const inner of ["rtl", "ltr"] as const) {
      const f = fixture(inner === "rtl" ? "ltr" : "rtl", inner, language);
      f.plugin.registerCommands();
      f.commands.find((command) => command.id === "copy-current-table-as-html")!.editorCallback!(f.editor, f.view);
      await vi.waitFor(() => expect(render).toHaveBeenCalled());
      const result = await render.mock.results[render.mock.results.length - 1]!.value as { html: string };
      expect(new DOMParser().parseFromString(result.html, "text/html").querySelector("table")!.dir).toBe(inner);
      const menu = f.menu();
      menu.items.find((item) => item.title === createTranslator(language)("menu.insertColumnLeft"))!.callback!();
      const values = parseEditableTables(f.editor.getValue()).tables[0]!.rows[1]!.cells.map((cell) => cell.content);
      expect(values).toEqual(inner === "rtl" ? ["North", "One", "Two", "", "Three"] : ["North", "One", "", "Two", "Three"]);
      expect(f.decoy.state.doc.toString()).toBe(SOURCE);
      render.mockClear();
    }
  });

  it.each(["rtl", "ltr"] as const)("prefers the source-bound rendered %s table over its source editor and decoy", async (direction) => {
    const opposite = direction === "rtl" ? "ltr" : "rtl";
    const f = fixture(direction, opposite, "ar");
    for (const [view, tableDirection] of [[f.decoy, opposite], [f.cm, direction]] as const) {
      view.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set([
        Decoration.replace({ widget: new DirectionTableWidget(tableDirection), block: true }).range(0, SOURCE.length),
      ]))) });
      expect(EditorView.findFromDOM(view.dom.querySelector<HTMLElement>(".structural-tables-live-preview")!) === view).toBe(true);
    }
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => { target.textContent = source; });
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
    const render = vi.spyOn(clipboard, "renderTableClipboard");
    f.plugin.registerCommands();
    f.commands.find((command) => command.id === "copy-current-table-as-html")!.editorCallback!(f.editor, f.view);
    await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
    const result = await render.mock.results[0]!.value as { html: string };
    expect(new DOMParser().parseFromString(result.html, "text/html").querySelector("table")!.dir).toBe(direction);
    const menu = f.menu();
    menu.items.find((item) => item.title === createTranslator("ar")("menu.insertColumnLeft"))!.callback!();
    expect(parseEditableTables(f.editor.getValue()).tables[0]!.rows[1]!.cells.map((cell) => cell.content))
      .toEqual(direction === "rtl" ? ["North", "One", "Two", "", "Three"] : ["North", "One", "", "Two", "Three"]);
    expect(f.decoy.state.doc.toString()).toBe(SOURCE);
  });
});
