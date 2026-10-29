// @vitest-environment happy-dom
import { Component, MarkdownRenderer, type App, type Command, type Editor, type MarkdownFileInfo } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StructuralTablesPlugin } from "../src/app/plugin";
import { copyTableForWord, startTableCopySession } from "../src/app/table-html-copy";
import { createTranslator } from "../src/config/i18n";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { notices } from "./mocks/obsidian";
import { StructuralTableWidget } from "../src/editor/table-widget";
import { tableCommandEditor } from "./helpers/table-command-editor";

const table = (name: string) => `| ${name} | Value |\n| --- | --- |\n| data | item |`;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => { resolve = finish; });
  return { promise, resolve };
}

function fixture(app = { workspace: { iterateAllLeaves: () => {} } } as unknown as App) {
  let source = table("A");
  const editor = {
    getValue: () => source, getCursor: () => ({ line: 0, ch: 2 }),
    getLine: (line: number) => source.split("\n")[line] ?? "", posToOffset: () => 2,
  } as unknown as Editor;
  const commands: Command[] = [];
  const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
    app, settings: { ...DEFAULT_SETTINGS, language: "en" }, localizedCommands: [],
    transposeRequestsActive: true, runtimeEpoch: {}, clipboardCopySession: startTableCopySession(app),
    addCommand: (command: Command) => { commands.push(command); return command; },
  }) as unknown as StructuralTablesPlugin;
  (plugin as unknown as { registerCommands: () => void }).registerCommands();
  const invoke = (format = "html") => commands.find(({ id }) => id === `copy-current-table-as-${format}`)!
    .editorCallback!(editor, { file: { path: "Note.md" } } as MarkdownFileInfo);
  return { app, plugin, invoke, setSource: (value: string) => { source = value; } };
}

let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  HTMLElement.prototype.setCssStyles = function(styles: Partial<CSSStyleDeclaration>): void { Object.assign(this.style, styles); };
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { cls?: string }): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    this.appendChild(element); return element;
  };
  HTMLElement.prototype.createDiv = function(options?: { cls?: string }): HTMLDivElement { return this.createEl("div", options); };
  HTMLElement.prototype.setCssProps = function(props: Record<string, string>): void {
    for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
  };
  HTMLElement.prototype.empty = function(): void { this.replaceChildren(); };
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => { element.textContent = text; });
  writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("ClipboardItem", undefined);
  notices.length = 0;
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); notices.length = 0; });

describe("whole-table copy invocation ownership", () => {
  it("does not reuse an old widget interaction across plugin copy sessions", () => {
    const f = tableCommandEditor(table("A"));
    const model = parseEditableTables(f.source()).tables[0]!;
    const old = new StructuralTableWidget(f.app, model, f.file.path, DEFAULT_SETTINGS, () => DEFAULT_SETTINGS);
    const host = old.toDOM(f.cm);
    try {
      expect(old.updateDOM(host)).toBe(true);
      startTableCopySession(f.app);
      const replacement = new StructuralTableWidget(f.app, model, f.file.path, DEFAULT_SETTINGS, () => DEFAULT_SETTINGS);
      expect(replacement.eq(old)).toBe(false);
      expect(replacement.updateDOM(host)).toBe(false);
    } finally { old.destroy(host); f.destroy(); }
  });

  it.each(["html", "tsv"])("a newer %s command supersedes an earlier HTML render", async (format) => {
    const unload = vi.spyOn(Component.prototype, "unload");
    const gate = deferred();
    const entered = deferred();
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, text, element) => {
      if (text === "A") { entered.resolve(); await gate.promise; }
      element.textContent = text;
    });
    const f = fixture();
    f.invoke(); await entered.promise;
    f.setSource(table("B")); f.invoke(format);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("B\tValue\ndata\titem"));
    gate.resolve();
    await vi.waitFor(() => expect(unload).toHaveBeenCalledTimes(format === "html" ? 2 : 1));
    expect(writeText).toHaveBeenCalledOnce();
    expect(vi.mocked(MarkdownRenderer.render).mock.calls.filter((call) => call[1] === "data")).toHaveLength(format === "html" ? 1 : 0);
    expect(notices).toHaveLength(1);
    f.plugin.onunload();
  });

  it("shares the latest intent with menu HTML copying", async () => {
    const unload = vi.spyOn(Component.prototype, "unload");
    const gate = deferred(); const entered = deferred();
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, text, element) => {
      if (text === "A") { entered.resolve(); await gate.promise; }
      element.textContent = text;
    });
    const f = fixture(); f.invoke(); await entered.promise;
    await copyTableForWord(f.app, parseEditableTables(table("B")).tables[0]!, "theme", {
      sourcePath: "Other.md", direction: "ltr", isCurrent: () => true,
    }, createTranslator("en"));
    gate.resolve(); await vi.waitFor(() => expect(unload).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("B\tValue\ndata\titem");
    expect(notices).toHaveLength(1);
    f.plugin.onunload();
  });

  it("keeps the command's captured snapshot after later source changes", async () => {
    const gate = deferred(); const entered = deferred();
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, text, element) => {
      if (text === "A") { entered.resolve(); await gate.promise; }
      element.textContent = text;
    });
    const f = fixture(); f.invoke(); await entered.promise;
    f.setSource(table("B")); gate.resolve();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("A\tValue\ndata\titem"));
    expect(notices).toHaveLength(1);
    f.plugin.onunload();
  });

  it.each([false, true])("prevents completion after unload and cannot borrow a replacement instance (reload=%s)", async (reload) => {
    const unload = vi.spyOn(Component.prototype, "unload");
    const gate = deferred(); const entered = deferred();
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, text, element) => {
      if (text === "A") { entered.resolve(); await gate.promise; }
      element.textContent = text;
    });
    const f = fixture(); f.invoke(); await entered.promise;
    f.plugin.onunload();
    const replacement = reload ? fixture(f.app) : null;
    if (replacement !== null) { replacement.setSource(table("B")); replacement.invoke(); }
    gate.resolve();
    if (replacement !== null) await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("B\tValue\ndata\titem"));
    await vi.waitFor(() => expect(unload).toHaveBeenCalledTimes(reload ? 2 : 1));
    expect(writeText).toHaveBeenCalledTimes(reload ? 1 : 0);
    expect(notices).toHaveLength(reload ? 1 : 0);
    replacement?.plugin.onunload();
  });

  it("does not claim to retract an already dispatched system write or report its late success", async () => {
    const gate = deferred();
    writeText.mockImplementationOnce(async () => { await gate.promise; });
    const f = fixture(); f.invoke();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    f.plugin.onunload(); gate.resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(writeText).toHaveBeenCalledOnce();
    expect(notices).toEqual([]);
  });
});
