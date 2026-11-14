// @vitest-environment happy-dom
import { App, MarkdownRenderer, type Command, type Editor, type MarkdownFileInfo } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlainGfmConversionService, PlainGfmModal, type PlainGfmTarget } from "../src/app/plain-gfm-modal";
import { StructuralTablesPlugin } from "../src/app/plugin";
import { copyTableForWord, startTableCopySession } from "../src/app/table-html-copy";
import { createTranslator } from "../src/config/i18n";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { planPlainGfmConversion } from "../src/core/plain-gfm-conversion";
import { notices } from "./mocks/obsidian";

const t = createTranslator("en");
const source = (name: string) => `| ${name} | Value |\n| --- | --- |\n| data | item |`;
const model = (name: string) => parseEditableTables(source(name)).tables[0]!;
const gfm = (name: string) => planPlainGfmConversion(model(name))!.keep.source;
const tsv = (name: string) => `${name}\tValue\ndata\titem`;
const copiedGfm = t("notice.copied").replace("{format}", "GFM");
const cleanup: (() => void)[] = [];
interface ClipboardContents { text: string; html?: string }
let clipboard: ClipboardContents;
const writes: ClipboardContents[] = [];

class ClipboardEntry {
  constructor(readonly data: Record<string, Blob>) {}
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
}

function recordWrite(value: ClipboardContents): void { clipboard = value; writes.push(value); }

function fixture() {
  const app = new App();
  const commands: Command[] = [];
  const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
    app, settings: { ...DEFAULT_SETTINGS, language: "en" }, localizedCommands: [],
    transposeRequestsActive: true, runtimeEpoch: {}, clipboardCopySession: startTableCopySession(app),
    addCommand: (command: Command) => { commands.push(command); return command; },
  }) as unknown as StructuralTablesPlugin;
  (plugin as unknown as { registerCommands: () => void }).registerCommands();
  cleanup.push(() => plugin.onunload());
  const directGfmCopy = (name: string) => {
    const editor = {
      getValue: () => source(name), getCursor: () => ({ line: 0, ch: 2 }), posToOffset: () => 2,
      getLine: (line: number) => source(name).split("\n")[line] ?? "",
    } as unknown as Editor;
    commands.find(({ id }) => id === "copy-current-table-as-plain-gfm")!.editorCallback!(
      editor, { file: { path: "Note.md" } } as MarkdownFileInfo,
    );
  };
  return { app, plugin, directGfmCopy };
}

async function preview(app: App, name = "NEW", isCurrent: PlainGfmTarget["isCurrent"] = () => true) {
  const modal = new PlainGfmModal(app, t, planPlainGfmConversion(model(name))!, {
    sourcePath: "Note.md", ownerDocument: document, draftRoot: document, direction: "ltr", isCurrent,
  });
  modal.open(); cleanup.push(() => modal.close());
  const button = [...modal.contentEl.querySelectorAll("button")].find((node) => node.textContent === t("gfm.copy"))!;
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  return { modal, button };
}

function htmlCopy(app: App, name: string) {
  return copyTableForWord(app, model(name), "theme", { sourcePath: "Note.md", direction: "ltr", isCurrent: () => true }, t);
}

function delayOldHtml() {
  const gate = deferred<void>(); const entered = deferred<void>();
  vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, text, element) => {
    if (text === "OLD") { entered.resolve(); await gate.promise; }
    element.textContent = text;
  });
  return { gate, entered };
}

beforeEach(() => {
  notices.length = 0; writes.length = 0; clipboard = { text: "INITIAL" };
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(tag: K,
    options?: { cls?: string; text?: string; value?: string; attr?: Record<string, string> }): HTMLElementTagNameMap[K] {
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
  vi.spyOn(window.navigator.clipboard, "writeText").mockImplementation(async (text) => { recordWrite({ text }); });
  vi.spyOn(window.navigator.clipboard, "write").mockImplementation(async (items) => {
    const data = (items[0] as unknown as ClipboardEntry).data;
    recordWrite({ text: await data["text/plain"]!.text(), html: await data["text/html"]!.text() });
  });
  vi.stubGlobal("ClipboardItem", undefined);
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => { element.textContent = text; });
});
afterEach(() => {
  for (const finish of cleanup.splice(0).reverse()) finish();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

describe("GFM preview copy invocation ownership", () => {
  it.each([false, true])("a successful preview Copy suppresses an older HTML render (rich=%s)", async (rich) => {
    if (rich) vi.stubGlobal("ClipboardItem", ClipboardEntry);
    const f = fixture(); const { gate, entered } = delayOldHtml();
    const old = htmlCopy(f.app, "OLD"); await entered.promise;
    const { button } = await preview(f.app);
    button.click();
    await vi.waitFor(() => expect(notices).toEqual([copiedGfm]));
    expect(clipboard).toEqual({ text: gfm("NEW") });
    gate.resolve(); await old;
    expect(writes).toEqual([{ text: gfm("NEW") }]);
    expect(clipboard).toEqual({ text: gfm("NEW") });
    expect(notices).toEqual([copiedGfm]);
  });

  it.each([false, true])("keeps the newer preview when HTML has already finished (rich=%s)", async (rich) => {
    if (rich) vi.stubGlobal("ClipboardItem", ClipboardEntry);
    const f = fixture();
    await htmlCopy(f.app, "OLD");
    expect(clipboard.text).toBe(tsv("OLD"));
    if (rich) expect(clipboard.html).toContain("OLD");
    const { button } = await preview(f.app); button.click();
    await vi.waitFor(() => expect(notices).toHaveLength(2));
    expect(writes.map(({ text }) => text)).toEqual([tsv("OLD"), gfm("NEW")]);
    expect(clipboard).toEqual({ text: gfm("NEW") });
    expect(notices).toEqual([rich ? t("notice.copied").replace("{format}", "HTML") : t("notice.copiedHtmlPlain"), copiedGfm]);
  });

  it("shares the same latest intent as the direct GFM command", async () => {
    const f = fixture(); const { gate, entered } = delayOldHtml();
    const old = htmlCopy(f.app, "OLD"); await entered.promise;
    f.directGfmCopy("NEW");
    await vi.waitFor(() => expect(notices).toEqual([copiedGfm]));
    gate.resolve(); await old;
    expect(writes).toEqual([{ text: gfm("NEW") }]);
    expect(clipboard).toEqual({ text: gfm("NEW") });
  });

  it("claims preview Copy before its asynchronous source validation finishes", async () => {
    const f = fixture(); const { gate, entered } = delayOldHtml();
    const valid = deferred<boolean>();
    const old = htmlCopy(f.app, "OLD"); await entered.promise;
    const { button } = await preview(f.app, "NEW", () => valid.promise); button.click();
    gate.resolve(); await old;
    expect(writes).toEqual([]); expect(notices).toEqual([]);
    valid.resolve(true);
    await vi.waitFor(() => expect(notices).toEqual([copiedGfm]));
    expect(clipboard).toEqual({ text: gfm("NEW") });
  });

  it.each(["rich HTML", "plain HTML", "direct GFM"] as const)("late preview validation cannot supersede newer %s", async (entry) => {
    if (entry === "rich HTML") vi.stubGlobal("ClipboardItem", ClipboardEntry);
    const f = fixture(); const valid = deferred<boolean>();
    const { button } = await preview(f.app, "OLD", () => valid.promise); button.click();
    if (entry === "direct GFM") {
      f.directGfmCopy("NEW");
      await vi.waitFor(() => expect(notices).toEqual([copiedGfm]));
    } else await htmlCopy(f.app, "NEW");
    const newer = { ...clipboard }; const newerNotices = [...notices];
    valid.resolve(true);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(writes).toEqual([newer]);
    expect(clipboard.text).toBe(entry === "direct GFM" ? gfm("NEW") : tsv("NEW"));
    if (entry === "rich HTML") expect(clipboard.html).toContain("NEW");
    expect(notices).toEqual(newerNotices);
  });

  it.each(["close", "unload", "reload"] as const)("stops pending validation after %s", async (reason) => {
    const f = fixture(); const valid = deferred<boolean>();
    const { modal, button } = await preview(f.app, "OLD", () => valid.promise); button.click();
    if (reason === "close") modal.close(); else f.plugin.onunload();
    if (reason === "reload") {
      startTableCopySession(f.app);
      await htmlCopy(f.app, "NEW");
    }
    valid.resolve(true);
    // The same promise continuation runs before this turn resumes.
    await valid.promise; await Promise.resolve();
    expect(writes).toEqual(reason === "reload" ? [{ text: tsv("NEW") }] : []);
    expect(clipboard).toEqual({ text: reason === "reload" ? tsv("NEW") : "INITIAL" });
    expect(notices).toEqual(reason === "reload" ? [t("notice.copiedHtmlPlain")] : []);
  });

  it.each([false, true])("does not report obsolete source validation failure (reject=%s)", async (reject) => {
    const f = fixture(); const valid = deferred<boolean>();
    const { button } = await preview(f.app, "OLD", () => valid.promise); button.click();
    f.directGfmCopy("NEW");
    await vi.waitFor(() => expect(notices).toEqual([copiedGfm]));
    if (reject) valid.reject(new Error("read failed")); else valid.resolve(false);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(writes).toEqual([{ text: gfm("NEW") }]);
    expect(clipboard).toEqual({ text: gfm("NEW") });
    expect(notices).toEqual([copiedGfm]);
  });

  it("keeps an old preview bound to its disposed instance when clicked after reload", async () => {
    const f = fixture(); const { button } = await preview(f.app, "OLD");
    f.plugin.onunload(); startTableCopySession(f.app);
    const { gate, entered } = delayOldHtml();
    // Delay the fresh instance's HTML copy to detect an old modal borrowing it.
    const current = htmlCopy(f.app, "OLD"); await entered.promise;
    button.click(); gate.resolve(); await current;
    expect(writes).toEqual([{ text: tsv("OLD") }]);
    expect(clipboard).toEqual({ text: tsv("OLD") });
    expect(notices).toEqual([t("notice.copiedHtmlPlain")]);
  });

  it("captures the service's session before an asynchronous preview open", async () => {
    const f = fixture(); const valid = deferred<boolean>(); let checks = 0;
    const service = new PlainGfmConversionService(f.app, () => t); cleanup.push(() => service.close());
    service.open(model("OLD"), {
      sourcePath: "Note.md", ownerDocument: document, draftRoot: document, direction: "ltr",
      isCurrent: () => ++checks === 1 ? valid.promise : true,
    });
    startTableCopySession(f.app); valid.resolve(true);
    const copyButton = () => [...document.querySelectorAll<HTMLButtonElement>(".structural-tables-gfm-preview button")]
      .find((button) => button.textContent === t("gfm.copy"));
    await vi.waitFor(() => expect(copyButton()?.disabled).toBe(false));
    const button = copyButton()!;
    const { gate, entered } = delayOldHtml();
    const current = htmlCopy(f.app, "OLD"); await entered.promise;
    button.click(); gate.resolve(); await current;
    expect(writes).toEqual([{ text: tsv("OLD") }]);
    expect(clipboard).toEqual({ text: tsv("OLD") });
    expect(notices).toEqual([t("notice.copiedHtmlPlain")]);
  });

  it.each([false, true])("cannot retract an already dispatched write and suppresses its obsolete notice (reject=%s)", async (reject) => {
    const f = fixture(); const gate = deferred<void>(); const entered = deferred<void>();
    vi.mocked(window.navigator.clipboard.writeText).mockImplementationOnce(async (text) => {
      entered.resolve(); await gate.promise;
      if (reject) throw new Error("denied");
      recordWrite({ text });
    });
    const { button } = await preview(f.app, "OLD"); button.click(); await entered.promise;
    expect(writes).toEqual([]); expect(notices).toEqual([]);
    await htmlCopy(f.app, "NEW");
    expect(clipboard).toEqual({ text: tsv("NEW") });
    gate.resolve();
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    expect(writes.map(({ text }) => text)).toEqual(reject ? [tsv("NEW")] : [tsv("NEW"), gfm("OLD")]);
    expect(clipboard.text).toBe(reject ? tsv("NEW") : gfm("OLD"));
    expect(notices).toEqual([t("notice.copiedHtmlPlain")]);
  });
});
