// @vitest-environment happy-dom
import MarkdownIt from "markdown-it";
import { history, undo, redo, undoDepth } from "@codemirror/commands";
import { Decoration, EditorView } from "@codemirror/view";
import { Compartment, StateEffect } from "@codemirror/state";
import { App, Component, MarkdownRenderer } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlainGfmConversionService, PlainGfmModal, type PlainGfmTarget } from "../src/app/plain-gfm-modal";
import { StructuralTablesPlugin } from "../src/app/plugin";
import { createTranslator } from "../src/config/i18n";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { planPlainGfmConversion } from "../src/core/plain-gfm-conversion";
import { parseEditableTables } from "../src/core/parser";
import { captureEditorPlainGfmTarget } from "../src/editor/plain-gfm-target";
import { NativeTableMenuBridge } from "../src/editor/native-table-menu";
import { StructuralTableEditorController } from "../src/editor/table-live-preview";
import { structuralTableSourceFocus } from "../src/editor/table-source-focus";
import { installReadingOutputMenu } from "../src/reading/table-image-menu";
import { tableCommandEditor } from "./helpers/table-command-editor";
import { NativeTableWidget } from "./helpers/native-table-widget";
import { installSelectionChangeTasks } from "./mocks/selection-events";
import { lastMenu, notices, TFile } from "./mocks/obsidian";

const SOURCE = "| --- || --- | --- |\n| 姓名 | 张三 | 李四 |\n| 年龄 | 28 | 31 |\n| 城市 | 杭州 | 上海 |";
const t = createTranslator("en");
const cleanup: (() => void)[] = [];
const sourceTable = (source = SOURCE, index = 0) => parseEditableTables(source).tables[index]!;
function editor(source = SOURCE) { const f = tableCommandEditor(source); cleanup.push(f.destroy); return f; }
function button(root: ParentNode, text: string) { const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === text); expect(found).toBeDefined(); return found!; }
async function previewReady(modal: PlainGfmModal): Promise<void> {
  modal.open();
  cleanup.push(() => modal.close());
  await vi.waitFor(() => expect(button(modal.contentEl, "Copy preview Markdown").disabled).toBe(false));
}
function makeModal(f = editor(), index = 0) {
  const table = sourceTable(f.source(), index);
  const target = captureEditorPlainGfmTarget(f.app, f.editor, table, f.view)!;
  expect(target).not.toBeNull();
  return { f, target, modal: new PlainGfmModal(f.app, t, planPlainGfmConversion(table)!, target) };
}

beforeEach(() => {
  cleanup.push(installSelectionChangeTasks(document));
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    if (options?.text !== undefined) element.textContent = options.text;
    if (options?.value !== undefined) element.setAttribute("value", options.value);
    for (const [key, value] of Object.entries(options?.attr ?? {})) element.setAttribute(key, value);
    this.append(element); return element;
  };
  HTMLElement.prototype.createDiv = function(options?: { cls?: string }): HTMLDivElement { return this.createEl("div", options); };
  HTMLElement.prototype.empty = function(): void { this.replaceChildren(); };
  HTMLElement.prototype.setCssStyles = function(styles: Partial<CSSStyleDeclaration>): void { Object.assign(this.style, styles); };
  // Independent Markdown parser exercises the exact requested preview bytes.
  // It is an adapter for the host rendering boundary, not an Obsidian runtime.
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, element) => {
    element.innerHTML = new MarkdownIt({ html: true }).render(source);
  });
  vi.spyOn(window.navigator.clipboard, "writeText").mockResolvedValue();
  notices.length = 0;
});
afterEach(() => { for (const finish of cleanup.splice(0).reverse()) finish(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("GFM preview and editor entry points", () => {
  it("renders the recommended final GFM, switches source/orientation, and copies exactly the visible result without writing", async () => {
    const { f, modal } = makeModal();
    await previewReady(modal);
    expect(modal.contentEl.querySelector<HTMLSelectElement>("select")!.value).toBe("transpose");
    expect([...modal.contentEl.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["姓名", "年龄", "城市"]);
    button(modal.contentEl, "Markdown source").click();
    expect(modal.contentEl.querySelector("pre")!.hidden).toBe(false);
    expect(button(modal.contentEl, "Markdown source").getAttribute("aria-pressed")).toBe("true");
    const select = modal.contentEl.querySelector<HTMLSelectElement>("select")!;
    select.value = "keep"; select.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(button(modal.contentEl, "Copy preview Markdown").disabled).toBe(false));
    expect(modal.contentEl.textContent).toContain("An empty top header row is added");
    const source = modal.contentEl.querySelector("pre")!.textContent;
    button(modal.contentEl, "Copy preview Markdown").click();
    await vi.waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(source));
    expect([...modal.contentEl.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["", "", ""]);
    expect(f.writes()).toBe(0);
    expect(f.source()).toBe(SOURCE);
  });

  it("replaces once, returns focus, and keeps typing, conversion, Undo and Redo as separate operations", async () => {
    const f = editor("before\n\n" + SOURCE + "\n\nafter");
    f.cm.dispatch({ changes: { from: f.cm.state.doc.length, insert: " typed" } });
    const before = f.source();
    const { modal } = makeModal(f);
    await previewReady(modal);
    const candidate = modal.contentEl.querySelector("pre")!.textContent!;
    button(modal.contentEl, "Replace table").click();
    await vi.waitFor(() => expect(f.writes()).toBe(2));
    expect(f.source()).toBe("before\n\n" + candidate + "\n\nafter typed");
    expect(f.containerEl.ownerDocument.activeElement).toBe(f.cm.contentDOM);
    expect(undoDepth(f.cm.state)).toBe(2);
    expect(undo(f.cm)).toBe(true); expect(f.source()).toBe(before);
    expect(undo(f.cm)).toBe(true); expect(f.source()).toBe("before\n\n" + SOURCE + "\n\nafter");
    expect(redo(f.cm)).toBe(true); expect(f.source()).toBe(before);
    expect(redo(f.cm)).toBe(true); expect(f.source()).toContain(candidate);
  });

  it.each(["source", "file", "path", "vault", "leaf", "editor", "detach"])("refuses stale %s identity before replacement", async (kind) => {
    const { f, modal } = makeModal();
    await previewReady(modal);
    if (kind === "source") f.cm.dispatch({ changes: { from: 0, to: f.cm.state.doc.length, insert: SOURCE.replace("张三", "王五") } });
    if (kind === "file") f.view.file = new TFile("other.md") as never;
    if (kind === "path") f.file.path = "renamed.md";
    if (kind === "vault") f.files.set(f.file.path, new TFile(f.file.path));
    if (kind === "leaf") f.leaves.length = 0;
    if (kind === "editor") f.view.editor = {} as never;
    if (kind === "detach") f.containerEl.remove();
    const before = f.source(); const writes = f.writes();
    button(modal.contentEl, "Replace table").click();
    await vi.waitFor(() => expect(notices).toContain(t("notice.staleTable")));
    expect(f.source()).toBe(before); expect(f.writes()).toBe(writes);
  });

  it("does not redirect a confirmed conversion to a byte-identical other table when the cursor moves", async () => {
    const f = editor(SOURCE + "\n\n" + SOURCE);
    const { modal } = makeModal(f, 1);
    await previewReady(modal);
    f.cm.dispatch({ selection: { anchor: 2 } });
    const candidate = modal.contentEl.querySelector("pre")!.textContent;
    button(modal.contentEl, "Replace table").click();
    await vi.waitFor(() => expect(f.writes()).toBe(1));
    expect(f.source()).toBe(SOURCE + "\n\n" + candidate);
  });

  it("keeps note direction separate from Arabic interface direction and preserves source order", async () => {
    const { f, target } = makeModal();
    const modal = new PlainGfmModal(f.app, createTranslator("ar"), planPlainGfmConversion(sourceTable())!, target);
    modal.open(); cleanup.push(() => modal.close());
    await vi.waitFor(() => expect(modal.contentEl.querySelector("table")).not.toBeNull());
    expect(modal.contentEl.dir).toBe("rtl");
    expect(modal.contentEl.querySelector<HTMLElement>(".structural-tables-gfm-rendered")!.dir).toBe("ltr");
    expect(modal.contentEl.querySelector("pre")!.dir).toBe("ltr");
    expect(modal.contentEl.querySelector("pre")!.textContent).toBe(planPlainGfmConversion(sourceTable())!.transpose!.source);
    expect(f.writes()).toBe(0);
  });

  it("uses a popout's clipboard and restores focus to its captured editor after replacement", async () => {
    const frame = document.body.appendChild(document.createElement("iframe"));
    const owner = frame.contentDocument!;
    const f = tableCommandEditor(SOURCE, [], owner); cleanup.push(f.destroy);
    const { modal } = makeModal(f);
    const copy = vi.spyOn(owner.defaultView!.navigator.clipboard, "writeText").mockResolvedValue();
    await previewReady(modal);
    button(modal.contentEl, "Copy preview Markdown").click();
    await vi.waitFor(() => expect(copy).toHaveBeenCalledOnce());
    button(modal.contentEl, "Replace table").click();
    await vi.waitFor(() => expect(f.writes()).toBe(1));
    expect(owner.activeElement).toBe(f.cm.contentDOM);
  });

  it("keeps copy available after a denied clipboard write and blocks replacement with an active draft", async () => {
    const { f, modal } = makeModal();
    await previewReady(modal);
    vi.mocked(window.navigator.clipboard.writeText).mockRejectedValue(new Error("denied"));
    button(modal.contentEl, "Copy preview Markdown").click();
    await vi.waitFor(() => expect(notices).toContain(t("notice.clipboardFailed")));
    expect(button(modal.contentEl, "Copy preview Markdown").disabled).toBe(false);
    f.containerEl.createEl("textarea", { cls: "structural-tables-cell-editor" });
    button(modal.contentEl, "Replace table").click();
    await vi.waitFor(() => expect(notices).toContain(t("gfm.unsavedDraft")));
    expect(f.writes()).toBe(0);
  });

  it("cancels the preview without writing and ignores late render completions", async () => {
    let finish!: () => void;
    vi.mocked(MarkdownRenderer.render).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { f, modal } = makeModal(); modal.open();
    expect(button(modal.contentEl, "Replace table").disabled).toBe(true);
    button(modal.contentEl, "Close").click(); finish(); await Promise.resolve();
    expect(modal.contentEl.childElementCount).toBe(0); expect(f.writes()).toBe(0);
  });

  it.each(["$5", String.raw`$\lvert x\rvert$`, String.raw`$P(A\mid B)$`])("previews accepted source containing %s without changing it", async (content) => {
    const source = `| Label | Amount |\n| --- | --- |\n| A | ${content} |`;
    const { f, modal } = makeModal(editor(source));
    await previewReady(modal);
    expect(modal.contentEl.querySelector("pre")!.textContent).toContain(content);
    expect(vi.mocked(MarkdownRenderer.render).mock.calls.some((call) => call[1].includes(content))).toBe(true);
    expect(f.source()).toBe(source); expect(f.writes()).toBe(0);
  });

  it("previews hidden overflow for copying but disables replacement and preserves every source byte", async () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 | KEEP |";
    const { f, modal } = makeModal(editor(source));
    await previewReady(modal);
    expect(modal.contentEl.textContent).toContain("Extra source cells hidden by Obsidian are omitted");
    expect(button(modal.contentEl, "Replace table").disabled).toBe(true);
    expect(modal.contentEl.querySelectorAll("select option")).toHaveLength(1);
    button(modal.contentEl, "Copy preview Markdown").click();
    await vi.waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledOnce());
    expect(vi.mocked(window.navigator.clipboard.writeText).mock.calls[0]![0]).not.toContain("KEEP");
    expect(f.source()).toBe(source); expect(f.writes()).toBe(0);
  });

  it("reports a synchronous host dispatch failure without changing the original source", async () => {
    const { f, modal } = makeModal();
    await previewReady(modal);
    vi.spyOn(f.cm, "dispatch").mockImplementation(() => { throw new Error("write failed"); });
    button(modal.contentEl, "Replace table").click();
    await vi.waitFor(() => expect(notices).toContain(t("gfm.replaceFailed")));
    expect(f.source()).toBe(SOURCE); expect(f.writes()).toBe(0);
  });

  it("does not let an earlier render overwrite a newer orientation", async () => {
    const finish: (() => void)[] = [];
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, source, element) => {
      await new Promise<void>((resolve) => finish.push(resolve));
      element.innerHTML = new MarkdownIt().render(source);
    });
    const { modal } = makeModal(); modal.open(); cleanup.push(() => modal.close());
    const select = modal.contentEl.querySelector<HTMLSelectElement>("select")!;
    select.value = "keep"; select.dispatchEvent(new Event("change"));
    finish[1]!(); await Promise.resolve(); await Promise.resolve();
    finish[0]!(); await Promise.resolve(); await Promise.resolve();
    expect([...modal.contentEl.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["", "", ""]);
    expect(modal.contentEl.querySelectorAll("table")).toHaveLength(1);
  });

  it("falls back to the exact source pane after a rendering failure", async () => {
    vi.mocked(MarkdownRenderer.render).mockRejectedValue(new Error("renderer failed"));
    const { modal } = makeModal(); await previewReady(modal);
    expect(modal.contentEl.textContent).toContain(t("gfm.renderFailed"));
    expect(modal.contentEl.querySelector("pre")!.hidden).toBe(false);
    button(modal.contentEl, "Copy preview Markdown").click();
    await vi.waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledWith(modal.contentEl.querySelector("pre")!.textContent));
  });

  it("opens the complete product preview through the registered conversion command", async () => {
    const f = editor();
    const commands: { id: string; editorCallback?: (editor: unknown, view: unknown) => void }[] = [];
    const service = new PlainGfmConversionService(f.app, () => t); cleanup.push(() => service.close());
    const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
      app: f.app, settings: { ...DEFAULT_SETTINGS, language: "en" }, plainGfm: service,
      localizedCommands: [], transposeRequestsActive: true,
      addCommand: (command: typeof commands[number]) => { commands.push(command); return command; },
    });
    (plugin as unknown as { registerCommands: () => void }).registerCommands();
    commands.find((command) => command.id === "convert-current-table-to-plain-gfm")!.editorCallback!(f.editor, f.view);
    await vi.waitFor(() => expect(document.querySelector(".structural-tables-gfm-preview table th")?.textContent).toBe("姓名"));
    expect(f.writes()).toBe(0);
  });

  it("uses the native right-clicked table even while the cursor belongs to the first identical table", async () => {
    const ordinary = "| Name | Value |\n| --- | --- |\n| A | 1 |";
    const source = ordinary + "\n\n" + ordinary;
    const tables = parseEditableTables(source).tables;
    const f = editor(source);
    f.cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set(tables.map((table) => Decoration.replace({ widget: new NativeTableWidget(table), block: true }).range(table.range.from, table.range.to))))) });
    const component = new Component(); cleanup.push(() => component.unload());
    const requests: { table: ReturnType<typeof sourceTable>; target: PlainGfmTarget }[] = [];
    new NativeTableMenuBridge(f.app, () => DEFAULT_SETTINGS, () => undefined, undefined,
      (table, target) => requests.push({ table, target })).register(component);
    const cells = f.containerEl.querySelectorAll<HTMLTableCellElement>("tbody td");
    cells[2]!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
    lastMenu!.items.find((item) => item.title === t("menu.previewGfm"))!.callback!();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.table.range).toEqual(tables[1]!.range);
    const result = requests[0]!.target.replace!("transpose");
    expect(result!.changed).toBe(true);
    expect(f.source().slice(0, ordinary.length)).toBe(ordinary);
    expect(f.writes()).toBe(1);
  });

  it("offers the same captured-target GFM action on an owned Live Preview table", async () => {
    const f = editor("before\n\n" + SOURCE);
    const requests: { table: ReturnType<typeof sourceTable>; target: PlainGfmTarget }[] = [];
    const controller = new StructuralTableEditorController(f.app, () => DEFAULT_SETTINGS, undefined, undefined,
      (table, target) => requests.push({ table, target }));
    f.cm.dispatch({ effects: StateEffect.appendConfig.of([history(), controller.createExtension()]) });
    const cell = f.containerEl.querySelector<HTMLElement>(".structural-tables-table td")!;
    expect(cell).not.toBeNull();
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, cancelable: true }));
    lastMenu!.items.find((item) => item.title === t("menu.previewGfm"))!.callback!();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.table.source).toBe(SOURCE);
    expect(requests[0]!.target.isCurrent()).toBe(true);
  });

  it("keeps an owned-table preview usable when the unchanged presentation widget is rebuilt", async () => {
    const f = editor("before\n\n" + SOURCE);
    const service = new PlainGfmConversionService(f.app, () => t); cleanup.push(() => service.close());
    const controller = new StructuralTableEditorController(f.app, () => DEFAULT_SETTINGS, undefined, undefined,
      (table, target) => service.open(table, target));
    const presentation = new Compartment();
    f.cm.dispatch({ effects: StateEffect.appendConfig.of(presentation.of(controller.createExtension())) });
    const cell = f.containerEl.querySelector<HTMLElement>(".structural-tables-table td")!;
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, cancelable: true }));
    lastMenu!.items.find((item) => item.title === t("menu.previewGfm"))!.callback!();
    await vi.waitFor(() => expect(document.querySelector(".structural-tables-gfm-preview table")).not.toBeNull());
    const candidate = document.querySelector(".structural-tables-gfm-preview pre")!.textContent!;
    // Source mode removes the widget while the same attached editor, file and bytes survive.
    f.cm.dispatch({ effects: presentation.reconfigure([]) });
    button(document, "Replace table").click();
    await vi.waitFor(() => expect(f.source()).toBe("before\n\n" + candidate));
    expect(f.writes()).toBe(1);
  });

  it("restores owned-table keyboard focus after undoing a whole-note GFM conversion", async () => {
    const f = editor();
    Object.assign(f.editor, { undo: () => undo(f.cm), redo: () => redo(f.cm) });
    const service = new PlainGfmConversionService(f.app, () => t); cleanup.push(() => service.close());
    const controller = new StructuralTableEditorController(f.app, () => DEFAULT_SETTINGS, undefined, undefined,
      (table, target) => service.open(table, target));
    f.cm.dispatch({ effects: StateEffect.appendConfig.of(controller.createExtension()) });
    f.cm.dispatch({ effects: structuralTableSourceFocus.of(false) });
    const cell = f.containerEl.querySelector<HTMLElement>(".structural-tables-table td")!;
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, cancelable: true }));
    lastMenu!.items.find((item) => item.title === t("menu.previewGfm"))!.callback!();
    await vi.waitFor(() => expect(document.querySelector(".structural-tables-gfm-preview table")).not.toBeNull());
    const candidate = document.querySelector(".structural-tables-gfm-preview pre")!.textContent!;
    button(document, "Replace table").click();
    await vi.waitFor(() => expect(f.source()).toBe(candidate));
    expect(undo(f.cm)).toBe(true);
    await vi.waitFor(() => expect(f.containerEl.querySelector(".structural-tables-table")!.contains(document.activeElement)).toBe(true));
    expect(f.source()).toBe(SOURCE);
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(f.source()).toBe(candidate));
    expect(f.writes()).toBe(3);
  });
});

describe("reading GFM preview lifecycle", () => {
  it("copies only, re-reads saved source before each action, and never exposes a replacement callback", async () => {
    const f = editor();
    const wrapper = document.body.createEl("div");
    wrapper.className = "markdown-preview-view";
    const owner = new Component(); cleanup.push(() => owner.unload());
    const requests: PlainGfmTarget[] = [];
    installReadingOutputMenu(f.app, wrapper, sourceTable(), f.file.path, owner, () => t, undefined,
      (_table, target) => requests.push(target));
    wrapper.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    lastMenu!.items.find((item) => item.title === t("menu.previewGfm"))!.callback!();
    const target = requests[0]!; expect(target.replace).toBeUndefined(); expect(await target.isCurrent()).toBe(true);
    const modal = new PlainGfmModal(f.app, t, planPlainGfmConversion(sourceTable())!, target);
    await previewReady(modal);
    expect([...modal.contentEl.querySelectorAll("button")].some((element) => element.textContent === "Replace table")).toBe(false);
    button(modal.contentEl, "Copy preview Markdown").click();
    await vi.waitFor(() => expect(window.navigator.clipboard.writeText).toHaveBeenCalledOnce());
    expect(f.writes()).toBe(0);
    f.cm.dispatch({ changes: { from: 0, to: f.cm.state.doc.length, insert: SOURCE.replace("张三", "王五") } });
    button(modal.contentEl, "Copy preview Markdown").click();
    await vi.waitFor(() => expect(notices).toContain(t("notice.staleTable")));
    expect(window.navigator.clipboard.writeText).toHaveBeenCalledOnce();
    owner.unload(); expect(await target.isCurrent()).toBe(false);
  });

  it("closes open previews and prevents pending opens after plugin unload", async () => {
    const f = editor(); const service = new PlainGfmConversionService(f.app, () => t);
    const target = captureEditorPlainGfmTarget(f.app, f.editor, sourceTable(), f.view)!;
    service.open(sourceTable(), target);
    await vi.waitFor(() => expect(document.querySelector(".structural-tables-gfm-preview")).not.toBeNull());
    service.close(); expect(document.querySelector(".structural-tables-gfm-preview")).toBeNull();
    const pending = new PlainGfmConversionService(new App(), () => t);
    let finish!: (value: boolean) => void;
    pending.open(sourceTable(), { ...target, isCurrent: () => new Promise<boolean>((resolve) => { finish = resolve; }) });
    pending.close(); finish(true); await Promise.resolve();
    expect(document.querySelector(".structural-tables-gfm-preview")).toBeNull();
  });
});
