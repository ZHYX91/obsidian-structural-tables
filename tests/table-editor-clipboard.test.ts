// @vitest-environment happy-dom
import { history, redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { MarkdownRenderer, Platform } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { createTranslator } from "../src/config/i18n";
import type { StructuralTable } from "../src/core/model";
import { parseEditableTables } from "../src/core/parser";
import { TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME, TABLE_RANGE_HTML_ATTRIBUTE } from "../src/core/table-range-clipboard";
import { StructuralTableWidget } from "../src/editor/table-widget";
import { lastMenu, notices } from "./mocks/obsidian";
import {
  screenshotTable,
  mountEditor,
  dispatchDraftShortcut,
  gridClipboardEvent,
  clickCurrentMenuItem,
  dispatchPointerDown,
} from "./helpers/live-preview-editor";

describe("Cell and range clipboard", () => {
  it("publishes distinct exact source snapshots and rebinds offsets without recopying table source", () => {
    const fragment = "| --- || --- |\n| Label | value |";
    const source = `Intro\n\n${fragment}\n\n^table-id\n\n${fragment}\n\nAfter`;
    const { parent, view } = mountEditor(source, { anchor: 0 });
    const observer = new MutationObserver(() => {});
    const hosts = [...parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview")];
    try {
      expect(hosts).toHaveLength(2);
      const verify = (): void => {
        const tables = parseEditableTables(view.state.doc.toString()).tables;
        for (const [index, host] of hosts.entries()) {
          const table = tables[index]!;
          expect(host.dataset.structuralSourceVersion).toBe("1");
          expect(host.dataset.structuralSourcePath).toBe("Test.md");
          expect(host.dataset.structuralSourceFrom).toBe(String(table.range.from));
          expect(host.dataset.structuralSourceTo).toBe(String(table.range.to));
          expect(host.dataset.structuralSource).toBe(view.state.doc.sliceString(table.range.from, table.range.to));
          expect(host.dataset.structuralSource).toBe(fragment);
          expect(host.querySelector("[data-structural-source]")).toBeNull();
        }
        expect(hosts[0]!.dataset.structuralSourceFrom).not.toBe(hosts[1]!.dataset.structuralSourceFrom);
      };
      verify();
      observer.observe(parent, { subtree: true, attributes: true });
      view.dispatch({ changes: { from: 0, to: 5, insert: "Longer introduction" } });
      expect([...parent.querySelectorAll(".structural-tables-live-preview")]).toEqual(hosts);
      verify();
      expect(observer.takeRecords().filter((record) => record.attributeName === "data-structural-source")).toHaveLength(0);
    } finally { observer.disconnect(); view.destroy(); }
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

  it("copies an owned rectangle without writing source and exports portable GFM plus structured range data", () => {
    const source = "| H1 | H2 |\n| --- || --- |\n| A | **B** |\n| C | [[N\\|A]] |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const first = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      const last = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
      dispatchPointerDown(first, "mouse");
      last.dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      const transfer = new DataTransfer();
      const event = gridClipboardEvent("copy", transfer);
      first.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(transfer.getData(TABLE_RANGE_CLIPBOARD_MIME)).not.toBe("");
      expect(transfer.getData("text/plain")).toContain("| A | **B** |");
      expect(transfer.getData("text/plain")).toContain(String.raw`[[N\|A]]`);
      expect(transfer.getData("text/html")).toContain(`<table ${TABLE_RANGE_HTML_ATTRIBUTE}=`);
    } finally { view.destroy(); }
  });

  it("cuts only after synchronous clipboard payload success and restores in one Undo", () => {
    const source = "| H1 | H2 |\n| --- || --- |\n| A | B |\n| C | D |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const first = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      const last = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(first, "mouse");
      last.dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      const transfer = new DataTransfer();
      const event = gridClipboardEvent("cut", transfer);
      first.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(transfer.getData(TABLE_RANGE_CLIPBOARD_MIME)).not.toBe("");
      const cleared = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(cleared.rows[1]!.cells.map((cell) => cell.content)).toEqual(["", ""]);
      expect(cleared.rows[2]!.cells.map((cell) => cell.content)).toEqual(["C", "D"]);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("keeps source when Cut cannot synchronously write its clipboard payload", () => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      dispatchPointerDown(cell, "mouse");
      const transfer = {
        setData: () => { throw new Error("clipboard denied"); },
        getData: () => "",
      } as unknown as DataTransfer;
      const event = gridClipboardEvent("cut", transfer);
      cell.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(notices[notices.length - 1]).toContain("Could not copy");
    } finally { view.destroy(); }
  });

  it("preserves the grid, undo history and selection until a conflicting range paste is corrected", () => {
    const source = "| H1 | H2 |\n| --- || --- |\n| A | B |\n| C | D |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    const cell = (row: number, col: number) => parent.querySelector<HTMLElement>(`[data-structural-row='${row}'][data-structural-column='${col}']`)!;
    const select = (row: number) => {
      dispatchPointerDown(cell(row, 0), "mouse");
      cell(row, 1).dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
    };
    try {
      select(1);
      const transfer = new DataTransfer();
      cell(1, 0).dispatchEvent(gridClipboardEvent("copy", transfer));
      const raw = transfer.getData(TABLE_RANGE_CLIPBOARD_MIME);
      transfer.setData(TABLE_RANGE_CLIPBOARD_WEB_MIME, raw.replace('"A"', '"X"'));
      select(2);
      cell(2, 0).dispatchEvent(gridClipboardEvent("paste", transfer));
      expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
      transfer.setData(TABLE_RANGE_CLIPBOARD_WEB_MIME, raw);
      cell(2, 0).dispatchEvent(gridClipboardEvent("paste", transfer));
      const pasted = view.state.doc.toString();
      expect(pasted).not.toBe(source);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(pasted);
    } finally { view.destroy(); }
  });

  it.each(["custom", "owned-html"])("pastes an exact-topology owned range using %s into only selected target owners", async (format) => {
    const source = "| H1 | H2 |\n| --- || --- |\n| **A** | [[N\\|A]] |\n| C | D |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const sourceFirst = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      const sourceLast = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(sourceFirst, "mouse");
      sourceLast.dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      let transfer = new DataTransfer();
      sourceFirst.dispatchEvent(gridClipboardEvent("copy", transfer));
      if (format === "owned-html") {
        const html = transfer.getData("text/html");
        transfer = new DataTransfer();
        transfer.setData("text/html", html);
      }

      const targetFirst = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='0']")!;
      const targetLast = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
      dispatchPointerDown(targetFirst, "mouse");
      targetLast.dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      const paste = gridClipboardEvent("paste", transfer);
      targetFirst.dispatchEvent(paste);
      expect(paste.defaultPrevented).toBe(true);

      await vi.waitFor(() => {
        const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
        expect(table.rows[1]!.cells[0]!.raw.trim()).toBe("**A**");
        expect(table.rows[2]!.cells[0]!.raw.trim()).toBe("**A**");
        expect(table.rows[2]!.cells[1]!.raw.trim()).toBe(String.raw`[[N\|A]]`);
      });
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["keyboard", "menu"])("recovers merged raw owners from owned HTML for %s paste in one transaction", async (route) => {
    const tableSource = "| H1 | H2 |\n| --- || --- |\n| **A** | [[N\\|A]] |\n| ^ | `a\\|b` |\n| Old | Q |\n| ^ | R |";
    const source = `Before\n\n${tableSource}\n\nAfter`;
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    try {
      const cell = (row: number, column: number) => parent.querySelector<HTMLElement>(
        `[data-structural-row='${row}'][data-structural-column='${column}']`,
      )!;
      dispatchPointerDown(cell(1, 0), "mouse");
      cell(2, 1).dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      const copied = new DataTransfer();
      cell(1, 0).dispatchEvent(gridClipboardEvent("copy", copied));
      const transfer = new DataTransfer();
      transfer.setData("text/html", copied.getData("text/html"));
      expect(transfer.getData("text/html")).toContain(TABLE_RANGE_HTML_ATTRIBUTE);
      dispatchPointerDown(cell(3, 0), "mouse");
      cell(4, 1).dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      if (route === "keyboard") {
        cell(3, 0).dispatchEvent(gridClipboardEvent("paste", transfer));
      } else {
        Object.defineProperty(window.navigator, "clipboard", {
          configurable: true,
          value: {
            read: vi.fn(async () => [{
              types: ["text/html"],
              getType: async () => new Blob([transfer.getData("text/html")], { type: "text/html" }),
            }]),
          },
        });
        cell(3, 0).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        clickCurrentMenuItem("Paste into selected cells", true);
      }
      await vi.waitFor(() => expect(writes).toBe(1));
      const pastedSource = view.state.doc.toString();
      const original = parseEditableTables(source).tables[0]!;
      const pasted = parseEditableTables(pastedSource).tables[0]!;
      expect(pasted.rows[3]!.cells[0]!.raw.trim()).toBe("**A**");
      expect(pasted.rows[3]!.cells[1]!.raw.trim()).toBe(String.raw`[[N\|A]]`);
      expect(pasted.rows[4]!.cells[1]!.raw.trim()).toBe("`a\\|b`");
      expect(pasted.rows[4]!.cells[0]!.marker).toBe("up");
      expect(pasted.headerRowCount).toBe(original.headerRowCount);
      expect(pasted.rowHeaderColumnCount).toBe(original.rowHeaderColumnCount);
      expect(pasted.alignments).toEqual(original.alignments);
      const unselectedRows = (table: StructuralTable) => table.rows.slice(0, 3).map((row) => ({
        ...row, cells: row.cells.map((cell) => ({ ...cell, raw: cell.raw.trim() })),
      }));
      expect(unselectedRows(pasted)).toEqual(unselectedRows(original));
      expect(pastedSource.startsWith("Before\n\n")).toBe(true);
      expect(pastedSource.endsWith("\n\nAfter")).toBe(true);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(pastedSource);
    } finally {
      Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
      view.destroy();
    }
  });

  it("consumes unsupported grid paste without falling through to hidden source", () => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      dispatchPointerDown(cell, "mouse");
      const transfer = new DataTransfer();
      transfer.setData("text/plain", "ordinary text");
      const event = gridClipboardEvent("paste", transfer);
      cell.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(notices[notices.length - 1]).toContain("compatible");
    } finally { view.destroy(); }
  });

  it("keeps textarea clipboard events outside owned range interception", () => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      for (const type of ["copy", "cut"] as const) {
        const event = gridClipboardEvent(type, new DataTransfer());
        editor.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
    } finally { view.destroy(); }
  });

  it.each(["outside-pointer", "destroy-connected"] as const)("keeps source when a pending menu Cut is invalidated by %s", async (action) => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    let destroyed = false;
    let resolveWrite: (() => void) | undefined;
    class MockClipboardItem { constructor(readonly data: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { write: vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve; })) },
    });
    try {
      const host = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      dispatchPointerDown(cell, "mouse");
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem("Cut selected cells", true);
      await vi.waitFor(() => expect(resolveWrite).toBeDefined());
      if (action === "outside-pointer") {
        const outside = document.body.appendChild(document.createElement("button"));
        dispatchPointerDown(outside, "mouse");
        outside.focus();
      } else {
        view.destroy();
        destroyed = true;
        document.body.appendChild(host);
        expect(host.isConnected).toBe(true);
      }
      resolveWrite!();
      await vi.waitFor(() => expect(notices[notices.length - 1]).toContain("changed"));
      expect(writes).toBe(0);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
      if (!destroyed) view.destroy();
    }
  });

  it.each(["same-table-repaint", "same-looking-neighbor"] as const)("revalidates a pending menu Cut after %s rebind", async (rebind) => {
    const table = "| H | V |\n| --- || --- |\n| A | B |";
    const source = `Before\n\n${table}\n\nBetween\n\n${table}\n\nAfter`;
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; });
    const { app, parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    let resolveWrite: (() => void) | undefined;
    class MockClipboardItem { constructor(readonly data: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { write: vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve; })) },
    });
    try {
      const host = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      const cell = host.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      dispatchPointerDown(cell, "mouse");
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem("Cut selected cells", true);
      await vi.waitFor(() => expect(resolveWrite).toBeDefined());

      const parsed = parseEditableTables(source).tables;
      const rebound = parsed[rebind === "same-table-repaint" ? 0 : 1]!;
      const settings = { ...DEFAULT_SETTINGS, enableLivePreview: true };
      expect(new StructuralTableWidget(app, rebound, "Test.md", settings, () => settings).updateDOM(host)).toBe(true);
      expect(host.isConnected).toBe(true);
      expect(host.dataset.structuralSourceTableIndex).toBe(String(rebound.sourceTableIndex));
      resolveWrite!();
      if (rebind === "same-table-repaint") {
        await vi.waitFor(() => expect(writes).toBe(1));
        const result = parseEditableTables(view.state.doc.toString()).tables;
        expect(result[0]!.rows[1]!.cells.map((owner) => owner.content)).toEqual(["", "B"]);
        expect(result[1]!.source).toBe(parsed[1]!.source);
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(source);
      } else {
        await vi.waitFor(() => expect(notices[notices.length - 1]).toContain("changed"));
        expect(writes).toBe(0);
        expect(view.state.doc.toString()).toBe(source);
        expect(undo(view)).toBe(false);
      }
    } finally {
      Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
      view.destroy();
    }
  });

  it("does not clear after an asynchronous menu Cut if source changes before clipboard success", async () => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    let resolveWrite: (() => void) | undefined;
    class MockClipboardItem {
      constructor(readonly data: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        write: vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve; })),
      },
    });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const cut = lastMenu?.items.find((item) => item.title === "Cut selected cells");
      expect(cut).toBeDefined();
      cut?.callback?.();
      await vi.waitFor(() => expect(resolveWrite).toBeDefined());

      const at = view.state.doc.toString().indexOf("A | B");
      view.dispatch({ changes: { from: at, to: at + 1, insert: "External" } });
      const changed = view.state.doc.toString();
      resolveWrite!();
      await Promise.resolve();
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(changed);
      expect(view.state.doc.toString()).toContain("External");
    } finally {
      Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
      view.destroy();
    }
  });

  it.each(["ignored-write", "read-rejected"] as const)("preserves mobile Cut source and history after %s", async (failure) => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    Platform.isMobileApp = true;
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    const richWrite = vi.fn(async () => {});
    const readText = vi.fn(async () => {
      if (failure === "read-rejected") throw new Error("Denied");
      return "previous clipboard";
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true, value: { write: richWrite, writeText: vi.fn(async () => {}), readText },
    });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      dispatchPointerDown(cell, "touch");
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem("Cut selected cells", true);
      await vi.waitFor(() => expect(notices[notices.length - 1]).toContain("not changed"));
      expect(richWrite).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
      expect(writes).toBe(0);
      expect(undo(view)).toBe(false);
    } finally {
      Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
      view.destroy();
    }
  });

  it("copies and pastes mobile row ranges without changing dimensions, header roles or unselected cells", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n| C | D |\n\nAfter";
    Platform.isMobileApp = true;
    let text = "";
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    const richWrite = vi.fn(async () => {});
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { write: richWrite, writeText: vi.fn(async (value: string) => { text = value; }), readText: vi.fn(async () => text) },
    });
    try {
      const sourceHandle = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!;
      sourceHandle.click();
      sourceHandle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem("Copy selected cells", true);
      await vi.waitFor(() => expect(text).toContain("| A | B |"));
      await Promise.resolve();
      expect(writes).toBe(0);
      const targetHandle = parent.querySelector<HTMLElement>("[data-structural-row-handle='2']")!;
      targetHandle.click();
      targetHandle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem("Paste into selected cells", true);
      await vi.waitFor(() => expect(writes).toBe(1));
      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table.rows).toHaveLength(3);
      expect(table.columnCount).toBe(2);
      expect(table.rowHeaderColumnCount).toBe(1);
      expect(table.rows[0]!.cells.map((cell) => cell.content)).toEqual(["H", "V"]);
      expect(table.rows[1]!.cells.map((cell) => cell.content)).toEqual(["A", "B"]);
      expect(table.rows[2]!.cells.map((cell) => cell.content)).toEqual(["A", "B"]);
      expect(view.state.doc.toString()).toMatch(/^Before\n\n/u);
      expect(view.state.doc.toString()).toMatch(/\n\nAfter$/u);
      expect(richWrite).not.toHaveBeenCalled();
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
      view.destroy();
    }
  });

  it.each([false, true])("clears mobile Cut only after verified text and unchanged source (source changed=%s)", async (sourceChanged) => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    Platform.isMobileApp = true;
    let text = "";
    let resolveRead: ((value: string) => void) | undefined;
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async (value: string) => { text = value; }),
        readText: vi.fn(() => new Promise<string>((resolve) => { resolveRead = resolve; })),
      },
    });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      dispatchPointerDown(cell, "touch");
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem("Cut selected cells", true);
      await vi.waitFor(() => expect(resolveRead).toBeDefined());
      expect(view.state.doc.toString()).toBe(source);
      if (sourceChanged) {
        const at = source.indexOf("A | B");
        view.dispatch({ changes: { from: at, to: at + 1, insert: "External" } });
      }
      const beforeResolution = view.state.doc.toString();
      resolveRead!(text);
      if (sourceChanged) {
        await vi.waitFor(() => expect(notices[notices.length - 1]).toContain("changed"));
        expect(view.state.doc.toString()).toBe(beforeResolution);
      } else {
        await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[0]!.content).toBe(""));
        expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[1]!.content).toBe("B");
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(source);
      }
    } finally {
      Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
      view.destroy();
    }
  });

  it.each([
    ["mobile", "en"], ["mobile", "zh-CN"], ["html", "en"], ["plain", "en"], ["failure", "en"],
  ] as const)("reports the actual whole-table menu copy result: %s (%s)", async (mode, language) => {
    const source = "| Region | Value |\n| --- || --- |\n| North | 1 |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [], undefined, { language });
    const start = notices.length;
    const t = createTranslator(language);
    const write = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    class CopyItem { constructor(readonly data: Record<string, Blob>) {} }
    Platform.isMobileApp = mode === "mobile";
    if (mode === "failure") write.mockRejectedValueOnce(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });
    vi.stubGlobal("ClipboardItem", mode === "plain" ? undefined : CopyItem);
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => { element.textContent = text; });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem(t("menu.copyWholeHtml"), true);
      const expected = mode === "failure" ? t("notice.clipboardFailed")
        : mode === "html" ? t("notice.copied").replace("{format}", "HTML") : t("notice.copiedHtmlPlain");
      await vi.waitFor(() => expect(notices.slice(start)).toEqual([expected]));
      expect(writeText).toHaveBeenCalledTimes(mode === "mobile" || mode === "plain" ? 1 : 0);
      if (mode === "mobile" || mode === "plain") expect(writeText).toHaveBeenCalledWith("Region\tValue\nNorth\t1");
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["source-change", "editor-destroy"])("refuses an owned HTML copy after %s during rendering", async (mode) => {
    const source = "| Region | Value |\n| --- || --- |\n| North | 1 |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("ClipboardItem", undefined);
    const start = notices.length;
    let changed = false;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => {
      element.textContent = text;
      if (changed) return;
      changed = true;
      if (mode === "source-change") view.dispatch({ changes: { from: source.indexOf("North"), to: source.indexOf("North") + 5, insert: "South" } });
      else view.destroy();
    });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem(createTranslator("en")("menu.copyWholeHtml"), true);
      await vi.waitFor(() => expect(notices.slice(start)).toEqual([createTranslator("en")("notice.staleTable")]));
      expect(writeText).not.toHaveBeenCalled();
    } finally { if (mode !== "editor-destroy" || !changed) view.destroy(); }
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
      value: { getData: (type: string) => type === "text/plain" ? "[[Target|Alias]]" : "" },
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
    const transfer = new DataTransfer();
    transfer.setData("text/html", '<td>"First"<br />Second</td>');
    transfer.setData("text/plain", '"""First""\nSecond"\r\n');
    const paste = gridClipboardEvent("paste", transfer);
    editor.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(editor.value).toBe('&#34;First&#34;<br>Second');
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(view.state.doc.toString()).toContain('&#34;First&#34;<br>Second');
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
    Object.defineProperty(paste, "clipboardData", { value: { getData: (type: string) => type === "text/plain" ? "Second\r\nThird" : "" } });
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
