// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as host from "obsidian";
import { type App, type Command, type Editor, type MarkdownFileInfo, Component, MarkdownRenderer } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StructuralTablesPlugin } from "../src/app/plugin";
import { startTableCopySession } from "../src/app/table-html-copy";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { notices, TFile } from "./mocks/obsidian";

const path = "Whole table boundaries.md";
const token = "ST_COPY_GATE_A_ONLY";
const sourceFixture = readFileSync(`acceptance/fixtures/${path}`, "utf8");
const script = readFileSync("acceptance/fixtures/.obsidian/plugins/structural-tables-acceptance-provider/main.js", "utf8");
const gateNotices: GateNotice[] = [];
class GateNotice {
  hidden = false;
  constructor(public message: string) { gateNotices.push(this); }
  setMessage(message: string): this { this.message = message; return this; }
  hide(): void { this.hidden = true; }
}
interface Provider extends Component {
  app: App;
  onload(): void;
  addCommand(command: Command): void;
  copyGateArm(): void;
  copyGateClose?: (reason: string) => void;
  copyGateWrites?: Promise<void>;
  copyGateEvents?: Array<{ stage: string; reason?: string; run: number }>;
}
const providers: Provider[] = [];

function fixture() {
  let source = sourceFixture;
  let caret = source.indexOf(`| ${token} |`);
  const file = new TFile(path);
  const editor = {
    getValue: () => source,
    getCursor: () => ({ line: source.slice(0, caret).split("\n").length - 1, ch: 2 }),
    getLine: (line: number) => source.split("\n")[line] ?? "",
    posToOffset: (position: { line: number; ch: number }) => source.split("\n").slice(0, position.line)
      .reduce((length, line) => length + line.length + 1, 0) + position.ch,
  } as unknown as Editor;
  const view = { file, editor, getMode: () => "source", getState: () => ({ source: true }) };
  const write = vi.fn(async (_path: string, _value: string) => {});
  const vault = { getFileByPath: (requested: string) => requested === path ? file : null, adapter: { write } };
  const app = { vault, workspace: { getActiveViewOfType: () => view, iterateAllLeaves: () => {} } } as unknown as App;
  const commands: Command[] = [];
  const module = { exports: {} };
  runInNewContext(script, { require: () => ({ ...host, Notice: GateNotice }), module, window, setTimeout, clearTimeout });
  const provider = Object.assign(new (module.exports as new () => Provider)(), {
    app, addCommand: (command: Command) => { commands.push(command); },
  });
  provider.onload(); providers.push(provider);
  const render = (text = token, sourcePath = path, target = document.createElement("div"), owner = new Component()) =>
    MarkdownRenderer.render(app, text, target, sourcePath, owner);
  return { provider, app, file, view, editor, write, commands, render,
    source: () => source, setSource: (next: string) => { source = next; },
    selectB: () => { caret = source.indexOf("| B | Value |"); } };
}

function copyCommands(f: ReturnType<typeof fixture>) {
  const commands: Command[] = [];
  const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
    app: f.app, settings: { ...DEFAULT_SETTINGS, language: "en" }, localizedCommands: [],
    transposeRequestsActive: true, runtimeEpoch: {}, clipboardCopySession: startTableCopySession(f.app),
    addCommand: (command: Command) => { commands.push(command); return command; },
  }) as unknown as StructuralTablesPlugin;
  (plugin as unknown as { registerCommands: () => void }).registerCommands();
  const copy = () => commands.find(command => command.id === "copy-current-table-as-html")!
    .editorCallback!(f.editor, { file: f.file } as MarkdownFileInfo);
  return { plugin, copy };
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
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, target) => { target.textContent = text; });
  writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } }); vi.stubGlobal("ClipboardItem", undefined);
  notices.length = 0; gateNotices.length = 0;
});
afterEach(async () => {
  for (const provider of providers.splice(0)) { provider.unload(); await provider.copyGateWrites; }
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); notices.length = 0;
});
const stages = (f: ReturnType<typeof fixture>) => f.provider.copyGateEvents?.map(event => event.stage) ?? [];
const holding = async (f: ReturnType<typeof fixture>) => { await vi.waitFor(() => expect(stages(f)).toContain("caught-holding")); };

describe("public fixture HTML renderer gate", () => {
  it("is inert until explicitly armed and exposes arm/release/disarm commands", async () => {
    const original = MarkdownRenderer.render; const f = fixture();
    expect(MarkdownRenderer.render).toBe(original);
    expect(f.commands.map(command => command.id)).toEqual(expect.arrayContaining([
      "arm-html-copy-gate", "release-html-copy-gate", "disarm-html-copy-gate",
    ]));
    await f.render(); expect(stages(f)).toEqual([]); expect(f.write).not.toHaveBeenCalled();
    expect(sourceFixture.split(token)).toHaveLength(2);
  });

  it.each(["path", "view", "marker", "duplicate", "live-preview", "file-identity"])("refuses an invalid arming condition: %s", mode => {
    const f = fixture(); const original = MarkdownRenderer.render; const getValue = vi.spyOn(f.editor, "getValue");
    if (mode === "path") f.file.path = "Other.md";
    if (mode === "view") vi.spyOn(f.app.workspace, "getActiveViewOfType").mockReturnValue(null);
    if (mode === "marker") f.setSource(sourceFixture.replace("<!-- structural-tables-copy-gate-fixture -->", ""));
    if (mode === "duplicate") f.setSource(`${sourceFixture}\n${token}`);
    if (mode === "live-preview") f.view.getState = () => ({ source: false });
    if (mode === "file-identity") vi.spyOn(f.app.vault, "getFileByPath").mockReturnValue(new TFile(path) as unknown as host.TFile);
    f.provider.copyGateArm(); expect(MarkdownRenderer.render).toBe(original); expect(stages(f)).toEqual([]);
    if (!["marker", "duplicate"].includes(mode)) expect(getValue).not.toHaveBeenCalled();
    expect(gateNotices[gateNotices.length - 1]?.message).toContain("Source mode");
  });

  it("calls the original once with this/args intact, then holds only its successful result", async () => {
    const f = fixture(); const receiver = {}; const value = { result: "original" };
    const original = vi.mocked(MarkdownRenderer.render).mockImplementation(function(this: unknown, ...args) {
      expect(this).toBe(receiver); expect(args).toEqual([f.app, token, target, path, owner]);
      return Promise.resolve(value) as unknown as Promise<void>;
    });
    const target = document.createElement("div"); const owner = new Component();
    f.provider.copyGateArm();
    const pending = MarkdownRenderer.render.call(receiver, f.app, token, target, path, owner);
    expect(MarkdownRenderer.render).toBe(original);
    let settled = false; void pending.then(() => { settled = true; });
    await holding(f); expect(settled).toBe(false); expect(original).toHaveBeenCalledOnce();
    expect(gateNotices[gateNotices.length - 1]?.message).toContain("caught/holding");
    f.provider.copyGateClose!("release-command"); expect(await pending).toBe(value);
    await f.provider.copyGateWrites;
    expect(JSON.parse(f.write.mock.calls[f.write.mock.calls.length - 1]![1])).toMatchObject({ diagnosticOnly: true, fixturePath: path });
    expect(stages(f)).toEqual(["armed", "caught-rendering", "render-completed", "caught-holding", "released"]);
  });

  it.each(["app", "source-path", "contains-token", "connected", "nonempty", "nested-detached", "attributes", "foreign-document", "component", "source-change", "file-replaced"])("passes unmatched rendering through without wrapping its Promise: %s", async mode => {
    const f = fixture(); const originalResult = Promise.resolve();
    vi.mocked(MarkdownRenderer.render).mockReturnValue(originalResult);
    const target = document.createElement("div"); let app = f.app; let text = token; let sourcePath = path;
    let owner = new Component();
    f.provider.copyGateArm();
    if (mode === "app") app = {} as App;
    if (mode === "source-path") sourcePath = "Other.md";
    if (mode === "contains-token") text = `**${token}**`;
    if (mode === "connected") document.body.append(target);
    if (mode === "nonempty") target.append("existing");
    if (mode === "nested-detached") {
      const table = document.createElement("table"); const row = table.insertRow(); row.insertCell().append(target);
    }
    if (mode === "attributes") target.className = "structural-tables-cell-content";
    if (mode === "foreign-document") document.implementation.createHTMLDocument().adoptNode(target);
    if (mode === "component") owner = {} as Component;
    if (mode === "source-change") f.setSource(`${sourceFixture}\nChanged before capture`);
    if (mode === "file-replaced") vi.spyOn(f.app.vault, "getFileByPath").mockReturnValue(new TFile(path) as unknown as host.TFile);
    expect(MarkdownRenderer.render(app, text, target, sourcePath, owner)).toBe(originalResult);
    await originalResult; expect(stages(f)).toEqual(["armed"]);
  });

  it.each(["throw", "reject"])("propagates the original %s and releases the gate without a holding observation", async mode => {
    const f = fixture(); const error = new Error("Original renderer failed");
    const original = vi.mocked(MarkdownRenderer.render).mockImplementation(() => {
      if (mode === "throw") throw error;
      return Promise.reject(error);
    });
    f.provider.copyGateArm();
    if (mode === "throw") expect(() => f.render()).toThrow(error);
    else await expect(f.render()).rejects.toBe(error);
    expect(MarkdownRenderer.render).toBe(original); expect(stages(f)).not.toContain("caught-holding");
    expect(stages(f)).toContain("cancelled");
  });

  it.each(["disarm-command", "rearmed", "provider-unload", "hold-timeout"])("releases held work on %s", async reason => {
    vi.useFakeTimers(); const f = fixture(); const original = MarkdownRenderer.render;
    f.provider.copyGateArm(); const pending = f.render(); await vi.advanceTimersByTimeAsync(0);
    expect(stages(f)).toContain("caught-holding");
    if (reason === "provider-unload") f.provider.unload();
    else if (reason === "rearmed") f.provider.copyGateArm();
    else if (reason === "hold-timeout") await vi.advanceTimersByTimeAsync(300000);
    else f.provider.copyGateClose!(reason);
    await pending;
    expect(f.provider.copyGateEvents).toContainEqual(expect.objectContaining({ stage: "cancelled", reason }));
    if (reason === "rearmed") f.provider.copyGateClose!("disarm-command");
    expect(MarkdownRenderer.render).toBe(original);
  });

  it("expires an untriggered arm and preserves a later foreign wrapper during cleanup", async () => {
    vi.useFakeTimers(); const f = fixture(); const original = MarkdownRenderer.render;
    f.provider.copyGateArm(); const ours = MarkdownRenderer.render;
    const foreign: typeof MarkdownRenderer.render = function(this: typeof MarkdownRenderer, ...args) { return ours.apply(this, args); };
    MarkdownRenderer.render = foreign;
    await vi.advanceTimersByTimeAsync(120000);
    expect(MarkdownRenderer.render).toBe(foreign); await f.render();
    expect(stages(f)).toEqual(["armed", "cancelled"]); expect(original).toHaveBeenCalledOnce();
    MarkdownRenderer.render = original;
  });

  it("releases before original completion without fabricating completion or holding", async () => {
    const f = fixture(); let complete!: () => void;
    vi.mocked(MarkdownRenderer.render).mockReturnValue(new Promise(resolve => { complete = resolve; }));
    f.provider.copyGateArm(); const pending = f.render(); f.provider.copyGateClose!("release-command");
    let settled = false; void pending.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false); expect(stages(f)).not.toContain("caught-holding");
    complete(); await pending; expect(stages(f)).not.toContain("released");
  });
});

describe("real product copy commands through the public provider gate", () => {
  it("lets B supersede held A and never dispatches A after release", async () => {
    const f = fixture(); const product = copyCommands(f); const source = f.source();
    const unload = vi.spyOn(Component.prototype, "unload");
    f.provider.copyGateArm(); product.copy(); await holding(f); expect(writeText).not.toHaveBeenCalled();
    f.selectB(); product.copy(); await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("B\tValue\nB-LATEST\tKEEP"));
    f.provider.copyGateClose!("release-command");
    await vi.waitFor(() => expect(unload).toHaveBeenCalledTimes(2));
    expect(writeText).toHaveBeenCalledOnce(); expect(notices).toHaveLength(1); expect(f.source()).toBe(source);
    product.plugin.onunload();
  });

  it("keeps unload ownership while the provider holds A, then permits a new instance's B", async () => {
    const f = fixture(); const product = copyCommands(f); const unload = vi.spyOn(Component.prototype, "unload");
    f.provider.copyGateArm(); product.copy(); await holding(f); product.plugin.onunload();
    f.provider.copyGateClose!("release-command"); await vi.waitFor(() => expect(unload).toHaveBeenCalledOnce());
    expect(writeText).not.toHaveBeenCalled(); expect(notices).toEqual([]);
    const replacement = copyCommands(f); f.selectB(); replacement.copy();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("B\tValue\nB-LATEST\tKEEP"));
    replacement.plugin.onunload();
  });

  it("retains A's captured snapshot after ordinary editing without a newer copy", async () => {
    const f = fixture(); const product = copyCommands(f);
    f.provider.copyGateArm(); product.copy(); await holding(f);
    const edited = f.source().replace("A-LAST", "A-EDITED-AFTER-CAPTURE"); f.setSource(edited);
    f.provider.copyGateClose!("release-command"); await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0]![0]).toContain("A-LAST"); expect(writeText.mock.calls[0]![0]).not.toContain("A-EDITED-AFTER-CAPTURE");
    expect(f.source()).toBe(edited); expect(notices).toHaveLength(1); product.plugin.onunload();
  });
});
