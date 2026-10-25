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
import { NativeCellEditorWidget } from "./helpers/native-cell-editor";
import { TableImageExportService, TableImageModal } from "../src/app/table-image-modal";
import * as images from "../src/rendering/table-image";

const raster = vi.hoisted(() => ({ toSvg: vi.fn() }));
vi.mock("html-to-image", () => raster);

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
    app, settings: { ...DEFAULT_SETTINGS, language }, localizedCommands: [], transposeRequestsActive: true, runtimeEpoch: {},
    addCommand: (command: Command) => { commands.push(command); return command; },
  }) as unknown as { registerCommands: () => void; registerEditorMenu: () => void; onunload: () => void };
  return { app, cm, decoy, view, editor, commands, plugin, menu: () => {
    plugin.registerEditorMenu(); const menu = new Menu(); editorMenu!(menu, editor, view); return menu;
  } };
}

beforeAll(() => {
  HTMLElement.prototype.setCssStyles = function setCssStyles(styles: Partial<CSSStyleDeclaration>): void { Object.assign(this.style, styles); };
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { cls?: string; text?: string; attr?: Record<string, string> }): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag); if (options?.cls !== undefined) element.className = options.cls;
    if (options?.text !== undefined) element.textContent = options.text;
    for (const [key, value] of Object.entries(options?.attr ?? {})) element.setAttribute(key, value);
    this.append(element); return element;
  };
  HTMLElement.prototype.createDiv = function createDiv(options?: { cls?: string }): HTMLDivElement { return this.createEl("div", options); };
  HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
});

afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("registered table entries use their exact editor direction", () => {
  function imagePlatform(): void {
    Object.defineProperty(document, "fonts", { configurable: true, value: { ready: Promise.resolve(), [Symbol.iterator]: () => [][Symbol.iterator]() } });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 320, height: 80, x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 80, toJSON: () => ({}) });
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(80);
    vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["PNG"], { type: "image/png" })));
    vi.spyOn(window.URL, "createObjectURL").mockReturnValue("blob:verified-image");
    vi.spyOn(window.URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => { target.textContent = source; });
  }

  it.each((["command", "source-menu"] as const).flatMap((entry) => ["ltr", "rtl"].flatMap((direction) => [false, true].map((rendered) => ({ entry, direction, rendered })))))("rasterizes $entry with inner $direction direction (rendered=$rendered)", async ({ entry, direction, rendered }) => {
    imagePlatform();
    const inner = direction as "ltr" | "rtl"; const outer = inner === "rtl" ? "ltr" : "rtl";
    const f = fixture(outer, inner, inner === "rtl" ? "en" : "ar");
    f.cm.dom.parentElement!.style.direction = outer;
    if (rendered) {
      f.cm.contentDOM.style.direction = outer;
      f.cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set([
        Decoration.replace({ widget: new DirectionTableWidget(inner), block: true }).range(0, SOURCE.length),
      ]))) });
    }
    Object.assign(f.app.vault, { on: () => ({}), offref: () => {} });
    const service = new TableImageExportService(f.app, () => ({ settings: DEFAULT_SETTINGS, t: createTranslator("en") }));
    Object.assign(f.plugin, { imageExport: service });
    const pipeline = vi.spyOn(images, "renderTableImage");
    raster.toSvg.mockReset().mockImplementation(async (root: HTMLElement) => {
      expect(getComputedStyle(root.querySelector("table")!).direction).toBe(inner);
      expect(root.textContent).toContain("North"); expect(root.querySelectorAll("tbody th")).toHaveLength(1);
      return "data:image/svg+xml,%3Csvg%2F%3E";
    });
    try {
      if (entry === "command") { f.plugin.registerCommands(); f.commands.find((command) => command.id === "export-current-table-as-image")!.editorCallback!(f.editor, f.view); }
      else f.menu().items.find((item) => item.title === createTranslator(inner === "rtl" ? "en" : "ar")("menu.exportImage"))!.callback!();
      await vi.waitFor(() => expect(pipeline).toHaveBeenCalledOnce());
      await expect(pipeline.mock.results[0]!.value).resolves.toMatchObject({ width: 640, height: 160, blob: expect.any(Blob) });
      expect(raster.toSvg).toHaveBeenCalledOnce(); expect(f.editor.getValue()).toBe(SOURCE); expect(f.decoy.state.doc.toString()).toBe(SOURCE);
    } finally { service.close(); }
  });

  it.each(["command", "source-menu"] as const)("rejects %s image generation when only the inner editor direction changes asynchronously", async (entry) => {
    imagePlatform(); const f = fixture("ltr", "rtl", "en"); f.cm.dom.parentElement!.style.direction = "ltr";
    Object.assign(f.app.vault, { on: () => ({}), offref: () => {} });
    const service = new TableImageExportService(f.app, () => ({ settings: DEFAULT_SETTINGS, t: createTranslator("en") }));
    Object.assign(f.plugin, { imageExport: service }); const pipeline = vi.spyOn(images, "renderTableImage");
    raster.toSvg.mockReset().mockImplementation(async () => { f.cm.contentDOM.style.direction = "ltr"; return "data:image/svg+xml,%3Csvg%2F%3E"; });
    try {
      if (entry === "command") { f.plugin.registerCommands(); f.commands.find((command) => command.id === "export-current-table-as-image")!.editorCallback!(f.editor, f.view); }
      else f.menu().items.find((item) => item.title === createTranslator("en")("menu.exportImage"))!.callback!();
      await vi.waitFor(() => expect(pipeline).toHaveBeenCalledOnce());
      await expect(pipeline.mock.results[0]!.value).rejects.toMatchObject({ code: "stale" });
      expect(document.querySelector(".structural-tables-image-preview img")).toBeNull(); expect(f.editor.getValue()).toBe(SOURCE);
    } finally { service.close(); }
  });

  it.each(["command", "source-menu"] as const)("rejects an old %s PNG callback after the plugin unloads", async (entry) => {
    const f = fixture("ltr", "rtl", "en");
    const on = vi.fn(() => ({}));
    const offref = vi.fn();
    const createBinary = vi.fn();
    Object.assign(f.app.vault, { on, offref, createBinary });
    const service = new TableImageExportService(f.app, () => ({ settings: DEFAULT_SETTINGS, t: createTranslator("en") }));
    Object.assign(f.plugin, { imageExport: service });
    const pipeline = vi.spyOn(images, "renderTableImage");
    const open = vi.spyOn(TableImageModal.prototype, "open");
    let oldCallback: () => unknown;
    if (entry === "command") {
      f.plugin.registerCommands();
      const command = f.commands.find((candidate) => candidate.id === "export-current-table-as-image")!;
      oldCallback = () => command.editorCallback!(f.editor, f.view);
    } else {
      oldCallback = f.menu().items.find((item) => item.title === createTranslator("en")("menu.exportImage"))!.callback!;
    }
    try {
      f.plugin.onunload();
      oldCallback();
      await Promise.resolve();
      expect(open).not.toHaveBeenCalled();
      expect(pipeline).not.toHaveBeenCalled();
      expect(on).not.toHaveBeenCalled();
      expect(offref).not.toHaveBeenCalled();
      expect(createBinary).not.toHaveBeenCalled();
      expect(document.querySelector(".structural-tables-image-modal")).toBeNull();
      expect(f.editor.getValue()).toBe(SOURCE);
      expect(f.decoy.state.doc.toString()).toBe(SOURCE);
    } finally { service.dispose(); }
  });

  it.each(["command", "source-menu"] as const)("keeps an old %s PNG action bound to its original runtime after reload", (entry) => {
    const f = fixture("ltr", "rtl", "en");
    const on = vi.fn(() => ({}));
    const createBinary = vi.fn();
    Object.assign(f.app.vault, { on, offref: vi.fn(), createBinary });
    const oldService = new TableImageExportService(f.app, () => ({ settings: DEFAULT_SETTINGS, t: createTranslator("en") }));
    Object.assign(f.plugin, { imageExport: oldService });
    let oldCallback: () => unknown;
    if (entry === "command") {
      f.plugin.registerCommands();
      const command = f.commands.find((candidate) => candidate.id === "export-current-table-as-image")!;
      oldCallback = () => command.editorCallback!(f.editor, f.view);
    } else oldCallback = f.menu().items.find((item) => item.title === createTranslator("en")("menu.exportImage"))!.callback!;
    f.plugin.onunload();
    const replacement = new TableImageExportService(f.app, () => ({ settings: DEFAULT_SETTINGS, t: createTranslator("en") }));
    const open = vi.spyOn(replacement, "open").mockImplementation(() => {});
    Object.assign(f.plugin, { runtimeEpoch: {}, transposeRequestsActive: true, imageExport: replacement });
    oldCallback();
    expect(open).not.toHaveBeenCalled();
    expect(on).not.toHaveBeenCalled();
    expect(createBinary).not.toHaveBeenCalled();
    if (entry === "command") {
      f.plugin.registerCommands();
      [...f.commands].reverse().find((command) => command.id === "export-current-table-as-image")!.editorCallback!(f.editor, f.view);
    } else f.menu().items.find((item) => item.title === createTranslator("en")("menu.exportImage"))!.callback!();
    expect(open).toHaveBeenCalledOnce();
    expect(f.editor.getValue()).toBe(SOURCE);
    expect(f.decoy.state.doc.toString()).toBe(SOURCE);
    replacement.dispose();
  });

  it.each(["en", "ar"] as const)("copies HTML and maps source menus independently of outer direction and %s UI", async (language) => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => { target.textContent = source; });
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
    const render = vi.spyOn(clipboard, "renderTableClipboard");
    for (const inner of ["rtl", "ltr"] as const) {
      const f = fixture(inner === "rtl" ? "ltr" : "rtl", inner, language);
      const native = new NativeCellEditorWidget("One", inner === "rtl" ? "ltr" : "rtl");
      f.cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set([
        Decoration.replace({ widget: native, block: true }).range(0, SOURCE.length),
      ]))) });
      // The actual table follows the note; its nested cell CM can differ.
      f.cm.dom.querySelector<HTMLTableElement>(".cm-table-widget table")!.style.direction = inner;
      f.cm.contentDOM.style.direction = inner === "rtl" ? "ltr" : "rtl";
      expect(native.child!.state.field(editorInfoField).editor).toBe(f.editor);
      native.child!.focus();
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
