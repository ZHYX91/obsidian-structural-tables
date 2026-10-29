// @vitest-environment happy-dom
import { Decoration, EditorView } from "@codemirror/view";
import { StateEffect } from "@codemirror/state";
import { Component, MarkdownRenderer, type Menu } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTranslator } from "../src/config/i18n";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { copyTableForWord, startTableCopySession } from "../src/app/table-html-copy";
import { parseEditableTables } from "../src/core/parser";
import { NativeTableMenuBridge } from "../src/editor/native-table-menu";
import { addEditorTableHtmlCopyMenuItem } from "../src/editor/table-html-menu";
import { installReadingOutputMenu } from "../src/reading/table-image-menu";
import { tableCommandEditor } from "./helpers/table-command-editor";
import { NativeTableWidget } from "./helpers/native-table-widget";
import { lastMenu, Menu as MockMenu, notices, TFile } from "./mocks/obsidian";

const TABLE = "| Name | Value |\n| --- | --- |\n| Alice | 00123 |";
const SOURCE = `Before\n\n${TABLE}\n\nBetween\n\n${TABLE}\n\nAfter`;
const t = createTranslator("en");
const cleanup: (() => void)[] = [];
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  HTMLElement.prototype.setCssStyles = function(styles: Partial<CSSStyleDeclaration>): void { Object.assign(this.style, styles); };
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, element) => { element.textContent = source; });
  writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.stubGlobal("ClipboardItem", undefined);
  notices.length = 0;
});
afterEach(() => {
  for (const finish of cleanup.splice(0).reverse()) finish();
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function fixture(mode: "source" | "native" | "reading") {
  const f = tableCommandEditor(SOURCE); cleanup.push(f.destroy);
  const owner = new Component(); cleanup.push(() => owner.unload());
  const tables = parseEditableTables(SOURCE).tables;
  let menu: MockMenu;
  if (mode === "source") {
    menu = new MockMenu();
    addEditorTableHtmlCopyMenuItem(menu as unknown as Menu, f.app, f.editor, tables[1]!, () => DEFAULT_SETTINGS, f.view);
  } else if (mode === "native") {
    f.cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set(tables.map((table) =>
      Decoration.replace({ widget: new NativeTableWidget(table), block: true }).range(table.range.from, table.range.to))))) });
    new NativeTableMenuBridge(f.app, () => DEFAULT_SETTINGS, () => {}).register(owner);
    f.containerEl.querySelectorAll<HTMLElement>(".cm-table-widget td")[2]!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }));
    menu = lastMenu!;
  } else {
    const wrapper = f.containerEl.appendChild(document.createElement("div"));
    const table = wrapper.appendChild(document.createElement("table")); table.className = "structural-tables-table";
    installReadingOutputMenu(f.app, wrapper, tables[1]!, f.file.path, owner, () => t);
    table.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 })); menu = lastMenu!;
  }
  const copy = () => menu.items.find((item) => item.title === t("menu.copyWholeHtml"))!.callback!();
  return { ...f, owner, copy };
}

describe("whole-table HTML menu entry points", () => {
  it.each(["source", "native", "reading"] as const)("keeps an old %s menu bound to its disposed instance", async (mode) => {
    const f = fixture(mode);
    startTableCopySession(f.app);
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, source, element) => {
      if (source === "Fresh") { entered(); await pending; }
      element.textContent = source;
    });
    const current = copyTableForWord(f.app, parseEditableTables("| Fresh | Value |\n| --- | --- |\n| NEW | KEEP |").tables[0]!, "theme",
      { sourcePath: f.file.path, direction: "ltr", isCurrent: () => true }, t);
    await started;
    f.copy();
    release(); await current;
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Fresh\tValue\nNEW\tKEEP");
    expect(vi.mocked(MarkdownRenderer.render).mock.calls.map((call) => call[1])).toEqual(["Fresh", "Value", "NEW", "KEEP"]);
    expect(notices).toEqual([t("notice.copiedHtmlPlain")]);
  });

  it.each(["source", "native", "reading"] as const)("copies the captured %s table without following the cursor or writing source", async (mode) => {
    const f = fixture(mode);
    // Invalidate only the first table; the captured second identical table keeps its exact range and bytes.
    f.cm.dispatch({ changes: { from: SOURCE.indexOf("Alice"), to: SOURCE.indexOf("Alice") + 5, insert: "Carol" } });
    f.editor.setCursor({ line: 0, ch: 0 });
    const before = f.source(); const writes = f.writes();
    f.copy();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("Name\tValue\nAlice\t00123"));
    expect(f.source()).toBe(before); expect(f.writes()).toBe(writes);
    expect(notices).toEqual([t("notice.copiedHtmlPlain")]);
  });

  it.each(["source", "native", "reading"] as const)("refuses a %s file rebind while rendering", async (mode) => {
    const f = fixture(mode);
    vi.mocked(MarkdownRenderer.render).mockImplementation(async (_app, source, element) => {
      element.textContent = source;
      f.view.file = new TFile(f.file.path) as typeof f.view.file;
    });
    f.copy();
    await vi.waitFor(() => expect(notices).toEqual([t("notice.staleTable")]));
    expect(writeText).not.toHaveBeenCalled(); expect(f.source()).toBe(SOURCE); expect(f.writes()).toBe(0);
  });

  it.each(["source", "native", "reading"] as const)("refuses a stale %s menu after its source table changes", async (mode) => {
    const f = fixture(mode);
    f.cm.dispatch({ changes: { from: SOURCE.lastIndexOf("Alice"), to: SOURCE.lastIndexOf("Alice") + 5, insert: "Carol" } });
    const before = f.source(); f.copy();
    await vi.waitFor(() => expect(notices).toEqual([t("notice.staleTable")]));
    expect(writeText).not.toHaveBeenCalled(); expect(f.source()).toBe(before);
  });
});
