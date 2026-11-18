// @vitest-environment happy-dom
import { EditorState, StateField, Transaction } from "@codemirror/state";
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { Decoration, EditorView } from "@codemirror/view";
import { MarkdownRenderer, editorInfoField, editorLivePreviewField } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { StructuralTableEditorController } from "../src/editor/table-live-preview";
import { dispatchScopeCaptureThenDom, lastMenu } from "./mocks/obsidian";
import {
  NativeCalloutWidget,
  screenshotTable,
  mountEditor,
  clickCurrentMenuItem,
  dispatchOwnedGridKey,
  dispatchPointerDown,
} from "./helpers/live-preview-editor";

describe("Editor focus and navigation", () => {
  it.each([false, true])("preserves raw source selection across external focus (range=%s)", async (range) => {
    const source = "Before\n\n| Region | Sales | < |\n| --- | --- | --- |\n| North | 10 | < |\n| ^ | 8 | 11 |\n\nEnd";
    const anchor = source.indexOf("North");
    const head = range ? anchor + 5 : anchor;
    const { parent, view } = mountEditor(source, { anchor, head });
    try {
      view.focus();
      const external = document.body.appendChild(document.createElement("button"));
      external.focus();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
      view.focus();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(view.hasFocus).toBe(true);
      expect(view.state.selection.main.anchor).toBe(anchor);
      expect(view.state.selection.main.head).toBe(head);
      expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("preserves a visual cell's logical source cursor when native focus returns from an external control", async () => {
    const source = [
      "Before",
      "",
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      dispatchPointerDown(cell, "mouse");
      const sourceOffset = source.indexOf("10");
      expect(view.state.selection.main.anchor).toBe(sourceOffset);
      expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();

      const external = document.body.appendChild(document.createElement("button"));
      external.focus();
      view.focus();

      await vi.waitFor(() => {
        expect(view.hasFocus).toBe(true);
        expect(view.state.selection.main.anchor).toBe(sourceOffset);
        expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
      });
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["focused", "draft", "canceled", "after"] as const)("keeps a tall merged table mounted while a source pointer resolves below its logical cell cursor (%s)", async (mode) => {
    const source = [
      "Before", "", "| Region | Sales | < | Q3 | Q4 |", "| --- | --- | --- | --- | --- |",
      ...Array.from({ length: 22 }, (_, row) => `| ${row % 2 === 0 ? `Region ${row / 2}` : "^"} | ${row} | value | more | last |`),
      "", mode === "after" ? "After the table." : "",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='22'][data-structural-column='4']")!;
      dispatchPointerDown(cell, "mouse");
      cell.focus();
      if (mode !== "focused") {
        cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        const draft = parent.querySelector<HTMLTextAreaElement>("textarea.structural-tables-cell-editor")!;
        expect(draft).not.toBeNull();
        if (mode === "canceled") draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      }
      const host = parent.querySelector(".structural-tables-live-preview");
      expect(view.state.selection.main.anchor).toBeLessThan(source.length - 2);
      const lines = view.contentDOM.querySelectorAll<HTMLElement>(".cm-line");
      const line = lines[lines.length - 1]!;
      // Native pointer focus precedes CodeMirror's resolved pointer selection.
      dispatchPointerDown(line, "mouse");
      view.contentDOM.focus();
      expect(parent.querySelector(".structural-tables-live-preview") === host).toBe(true);
      view.dispatch({ selection: { anchor: source.length } });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(parent.querySelector(".structural-tables-live-preview") === host).toBe(true);
      expect(view.state.selection.main.anchor).toBe(source.length);
      expect(parent.querySelectorAll("[rowspan='2']")).toHaveLength(11);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["ltr", "rtl"] as const)("keeps the same %s table and local horizontal scroll through touch release, delayed focus and native selection", async (direction) => {
    const source = "Before\n\n| Region | Sales | < | Q3 | Q4 |\n| --- | --- | --- | --- | --- |\n| North | 10 | 12 | 13 | final-cell |\n\nAfter the table.";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]); parent.dir = direction;
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='4']")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const host = parent.querySelector(".structural-tables-live-preview");
      const scroller = parent.querySelector<HTMLElement>(".structural-tables-container")!;
      scroller.scrollLeft = direction === "rtl" ? -120 : 120;
      const horizontal = scroller.scrollLeft;
      const lines = view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"); const line = lines[lines.length - 1]!;
      dispatchPointerDown(line, "touch"); line.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      view.contentDOM.focus();
      expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
      view.dispatch({ selection: { anchor: source.length } });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
      expect(parent.querySelector(".structural-tables-container")).toBe(scroller); expect(scroller.scrollLeft).toBe(horizontal);
      expect(view.state.doc.toString()).toBe(source); expect(undoDepth(view.state)).toBe(0); expect(view.state.selection.main.empty).toBe(true);
    } finally { view.destroy(); }
  });

  it.each(["table-pointer", "outside-pointer", "external-focus", "body-then-external-focus", "keydown", "beforeinput", "disable-preview"] as const)("releases an unresolved touch source intent on %s without trapping later keyboard source focus", async (exit) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | final-cell |\n\nAfter";
    const { parent, view, updateSettings } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const host = parent.querySelector(".structural-tables-live-preview");
      const lines = view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"); const line = lines[lines.length - 1]!;
      dispatchPointerDown(line, "touch"); line.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      view.contentDOM.focus(); await new Promise((resolve) => setTimeout(resolve, 20));
      expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
      const outside = document.body.appendChild(document.createElement("button"));
      if (exit === "table-pointer") dispatchPointerDown(cell, "touch");
      else if (exit === "outside-pointer") dispatchPointerDown(outside, "touch");
      else if (exit === "external-focus") outside.focus();
      else if (exit === "body-then-external-focus") { view.contentDOM.blur(); outside.focus(); }
      else if (exit === "keydown") view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
      else if (exit === "beforeinput") view.contentDOM.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: "x", bubbles: true }));
      else { updateSettings({ enableLivePreview: false }); updateSettings({ enableLivePreview: true }); }
      if (exit !== "keydown" && exit !== "beforeinput") { outside.focus(); view.contentDOM.focus(); }
      expect(parent.querySelector(".structural-tables-live-preview")).toBeNull(); expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["mouse", "touch"] as const)("keeps a fresh %s source gesture after an external control takes focus", async (pointer) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | final-cell |\n\nAfter";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const host = parent.querySelector(".structural-tables-live-preview");
      const outside = document.body.appendChild(document.createElement("button")); outside.focus();
      const line = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")].slice(-1)[0]!;
      dispatchPointerDown(line, pointer);
      if (pointer === "touch") { line.dispatchEvent(new Event("pointerup", { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 20)); }
      view.contentDOM.focus();
      expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
      view.dispatch({ selection: { anchor: source.length } });
      if (pointer === "mouse") line.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(parent.querySelector(".structural-tables-live-preview")).toBe(host); expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("syncs the logical source cursor when keyboard focus enters a visual cell", () => {
    const source = [
      "Before",
      "",
      "| Region | Sales | < |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.focus();
      expect(document.activeElement).toBe(cell);
      expect(view.state.selection.main.anchor).toBe(source.indexOf("10"));
      expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("hands a padded ragged GFM cell to a source position inside the table", async () => {
    const source = [
      "Before",
      "",
      "| A | B | C |",
      "| --- | --- | --- |",
      "| 1 | 2 |",
      "",
      "End",
    ].join("\n");
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='2']",
      )!;
      expect(cell).not.toBeNull();
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const editSource = lastMenu?.items.find((item) => item.title === "Edit table source");
      expect(editSource).toBeDefined();
      editSource?.callback?.();

      const table = parseEditableTables(source).tables[0]!;
      await vi.waitFor(() => {
        expect(view.hasFocus).toBe(true);
        expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
        expect(view.state.selection.main.anchor).toBeGreaterThanOrEqual(table.range.from);
        expect(view.state.selection.main.anchor).toBeLessThan(table.range.to);
      });
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("terminal Tab appends one row, opens its first cell and undoes the edit with the row", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Saved";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='2'][data-structural-column='0'] textarea")).not.toBeNull());
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows).toHaveLength(3);
      expect(view.state.doc.toString()).toContain("Saved");
      parent.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("adds a bottom data row to a header-only table and preserves backward Tab at the start", async () => {
    const source = "Before\n\n| H | < |\n| --- | --- |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      parent.querySelector<HTMLButtonElement>(".structural-tables-add-row")!.click();
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='1'][data-structural-column='0'] textarea")).not.toBeNull());
      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table.headerRowCount).toBe(1);
      expect(table.rows).toHaveLength(2);
      const editor = parent.querySelector("textarea")!;
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='0'][data-structural-column='0'] textarea")).not.toBeNull());
      const before = view.state.doc.toString();
      parent.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
      expect(view.state.doc.toString()).toBe(before);
    } finally { view.destroy(); }
  });

  it("returns native focus to the table source when splitting a Callout's last merged cell", async () => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div"); element.className = options.cls; return element;
    });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const container = args[2] as HTMLElement;
      if (container.className === "structural-tables-container") {
        container.innerHTML = new NativeCalloutWidget().toDOM().querySelector(".callout-content")!.innerHTML;
      }
    });
    const source = "Before\n\n> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n\nEnd";
    const native = StateField.define({
      create: () => Decoration.set([Decoration.replace({ widget: new NativeCalloutWidget(), block: true })
        .range(source.indexOf("> [!note]"), source.indexOf("\n\nEnd"))]),
      update: (value, transaction) => value.map(transaction.changes),
      provide: (field) => EditorView.decorations.from(field),
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native, history()]);
    try {
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      const cell = parent.querySelector<HTMLElement>(".callout [data-structural-row='0'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Split merged cell")?.callback?.();
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).toBeNull());
      expect(view.hasFocus).toBe(true);
      // A host block widget can move the caret to its boundary; it must never
      // remain at the old paragraph before the Callout.
      expect(view.state.selection.main.anchor).toBeGreaterThanOrEqual(source.indexOf("> | A"));
      expect(view.state.selection.main.anchor).toBeLessThanOrEqual(view.state.doc.toString().indexOf("\n\nEnd") + 1);
      expect(view.state.doc.toString()).not.toContain("| < |");
      expect(undo(view)).toBe(true);
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      expect(redo(view)).toBe(true);
      await vi.waitFor(() => {
        expect(view.hasFocus).toBe(true);
        expect(view.state.selection.main.anchor).toBeGreaterThanOrEqual(source.indexOf("> | A"));
      });
    } finally { view.destroy(); }
  });

  it("falls back to native source focus when ordinary takeover is disabled before Undo", async () => {
    const source = "Before\n\n| H | V |\n| --- | --- |\n| A | 1 |\n\nEnd";
    const { parent, view, updateSettings } = mountEditor(
      source,
      { anchor: source.length },
      [history()],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Delete table")?.callback?.();
      await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables).toHaveLength(0));

      updateSettings({ takeOverOrdinaryTables: false });
      expect(undo(view)).toBe(true);
      await Promise.resolve();

      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
      expect(view.hasFocus).toBe(true);
      expect(view.state.selection.main.anchor).toBeGreaterThanOrEqual(table.range.from);
      expect(view.state.selection.main.anchor).toBeLessThan(table.range.to);
    } finally {
      view.destroy();
    }
  });

  it.each(["replace", "remove"] as const)("cancels history focus after an external target %s even if its source returns", async (change) => {
    const tableText = "| H | V |\n| --- || --- |\n| A | 1 |";
    const source = `Before\n\n${tableText}\n\nAfter`;
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    const callbacks: (() => void)[] = [];
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => callbacks.push(callback));
    const flush = () => { while (callbacks.length > 0) callbacks.shift()!(); };
    try {
      const table = parseEditableTables(source).tables[0]!;
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Delete table")?.callback?.();
      flush();
      await Promise.resolve();
      flush();
      expect(undo(view)).toBe(true);
      // Allow the restore request to run, but hold its mounted-cell callback.
      expect(callbacks.length).toBeGreaterThan(0);
      callbacks.shift()!();
      const replacement = change === "remove" ? "" : tableText.replace("| A | 1 |", "| Other | 2 |");
      view.dispatch({
        changes: { from: table.range.from, to: table.range.to, insert: replacement },
        selection: { anchor: source.length - tableText.length + replacement.length },
      });
      view.dispatch({
        changes: { from: table.range.from, to: table.range.from + replacement.length, insert: tableText },
        selection: { anchor: source.length },
      });
      const outside = document.body.appendChild(document.createElement("button"));
      outside.focus();
      const selection = view.state.selection;
      flush();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(view.state.doc.toString()).toBe(source);
      expect(view.state.selection.eq(selection)).toBe(true);
      expect(document.activeElement).toBe(outside);
      expect(parent.querySelector(".is-selected")).toBeNull();
    } finally {
      view.destroy();
      flush();
    }
  });

  it.each(["document", "table"] as const)("maps pending restored-cell focus through a %s prefix outside the target", async (boundary) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | 1 |\n\nAfter";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    const callbacks: (() => void)[] = [];
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => callbacks.push(callback));
    const flush = () => { while (callbacks.length > 0) callbacks.shift()!(); };
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Delete table")?.callback?.();
      flush();
      await Promise.resolve();
      flush();
      expect(undo(view)).toBe(true);
      callbacks.shift()!();
      const from = boundary === "document" ? 0 : parseEditableTables(source).tables[0]!.range.from;
      const prefix = "Inserted prose\n\n";
      view.dispatch({
        changes: { from, insert: prefix },
        selection: { anchor: source.length + prefix.length },
        annotations: Transaction.addToHistory.of(false),
      });
      flush();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const restored = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      expect(view.state.doc.toString()).toBe(source.slice(0, from) + prefix + source.slice(from));
      expect(restored.isConnected).toBe(true);
      expect(document.activeElement).toBe(restored);
      const f2 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
      dispatchScopeCaptureThenDom(restored, f2);
      expect(restored.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("A");
    } finally {
      view.destroy();
      flush();
    }
  });

  it("does not restore old history focus into another note in the same connected view", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | 1 |\n\nAfter";
    const { app, parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    const callbacks: (() => void)[] = [];
    vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => callbacks.push(callback));
    const flush = () => { while (callbacks.length > 0) callbacks.shift()!(); };
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Delete table")?.callback?.();
      flush();
      await Promise.resolve();
      flush();
      expect(undo(view)).toBe(true);
      callbacks.shift()!();
      const controller = new StructuralTableEditorController(app, () => DEFAULT_SETTINGS);
      const otherSource = source.replace("Before", "Another note");
      const info = view.state.field(editorInfoField);
      view.setState(EditorState.create({
        doc: otherSource,
        selection: { anchor: otherSource.length },
        extensions: [
          editorLivePreviewField,
          editorInfoField.init(() => ({ ...info, file: { ...info.file!, path: "Other.md" } })),
          controller.createExtension(),
          history(),
        ],
      }));
      const outside = document.body.appendChild(document.createElement("button"));
      outside.focus();
      const selection = view.state.selection;
      flush();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(view.dom.isConnected).toBe(true);
      expect(view.state.field(editorInfoField).file?.path).toBe("Other.md");
      expect(view.state.doc.toString()).toBe(otherSource);
      expect(view.state.selection.eq(selection)).toBe(true);
      expect(document.activeElement).toBe(outside);
      expect(parent.querySelector("textarea")).toBeNull();
    } finally {
      view.destroy();
      flush();
    }
  });

  it("does not clear from a detached owned grid or a keyboard event from another window", () => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(cell, "mouse");

      parent.remove();
      const detached = dispatchOwnedGridKey(cell, "Delete", false);
      expect(detached.defaultPrevented).toBe(false);
      expect(view.state.doc.toString()).toBe(source);

      document.body.appendChild(parent);
      cell.focus();
      const foreign = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      Object.defineProperty(foreign, "view", { value: {} as Window });
      dispatchScopeCaptureThenDom(cell, foreign);
      expect(foreign.defaultPrevented).toBe(false);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("keeps a shifted identical table's identity for editing and subsequent Tab navigation", async () => {
    const prefix = "Introduction\n\n";
    const source = `${prefix}${screenshotTable}\n\n${screenshotTable}\n\nEnd`;
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      view.dispatch({ changes: { from: 0, insert: "| New | Table |\n| --- | --- |\n| A | B |\n\n" } });
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      expect(Array.from(hosts, (host) => host.dataset.structuralSourceTableIndex)).toEqual(["1", "2"]);
      hosts[1]!.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = hosts[1]!.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Second table only";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      await Promise.resolve();
      expect(view.state.doc.toString()).toContain(`${screenshotTable}\n\n| Second table only`);
      expect(parent.querySelector("textarea")?.closest<HTMLElement>(".structural-tables-live-preview")
        ?.dataset.structuralSourceTableIndex).toBe("2");
    } finally { view.destroy(); }
  });

  it.each(["row", "column"] as const)("keeps the frozen %s axis and focus through a real menu activation gesture", async (axis) => {
    const source = "| H | V | W |\n| --- || --- | --- |\n| A | B | C |\n| D | E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const handle = parent.querySelector<HTMLElement>(`[data-structural-${axis}-handle='1']`)!;
      handle.click();
      handle.focus();
      handle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem("Clear selected cells", true);
      await vi.waitFor(() => {
        const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
        expect(axis === "row" ? table.rows[1]!.cells.map((cell) => cell.content)
          : table.rows.map((row) => row.cells[1]!.content)).toEqual(["", "", ""]);
      });
      const restored = parent.querySelector<HTMLElement>(`[data-structural-${axis}-handle='1']`)!;
      await vi.waitFor(() => expect(document.activeElement).toBe(restored));
      const result = view.state.doc.toString();
      const table = parseEditableTables(result).tables[0]!;
      expect(table.rows[0]!.cells[0]!.content).toBe("H");
      expect(table.rows[2]!.cells[2]!.content).toBe("F");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("renders a merged table when the cursor is at its exclusive end boundary", () => {
    const { parent, view } = mountEditor(`${screenshotTable}\n`, { anchor: screenshotTable.length });

    const merged = parent.querySelector<HTMLTableCellElement>(
      "[data-structural-row='3'][data-structural-column='3']",
    );
    expect(merged).not.toBeNull();
    expect(merged?.rowSpan).toBe(2);
    expect(merged?.colSpan).toBe(2);
    expect(parent.textContent).not.toContain("<");
    expect(parent.textContent).not.toContain("^");

    view.destroy();
  });

  it("keeps source visible while the cursor is genuinely inside the table", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: 1 });

    expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();

    view.destroy();
  });

  it.each([
    ["multi-row column headers", "| A | B |\n| C | D |\n| --- | --- |\n| E | F |"],
    ["row-header columns", "| A | B |\n| --- || --- |\n| C | D |"],
  ])("renders %s after an operation leaves the cursor at the table end", (_name, source) => {
    const { parent, view } = mountEditor(source, { anchor: source.length });

    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();

    view.destroy();
  });

  it("updates the add-row hit region when only the scroll viewport resizes and releases its observer", () => {
    const observers: Array<{
      callback: ResizeObserverCallback;
      elements: Set<Element>;
      disconnect: ReturnType<typeof vi.fn>;
      observer: ResizeObserver;
    }> = [];
    vi.stubGlobal("ResizeObserver", class {
      private readonly record;
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, elements: new Set<Element>(), disconnect: vi.fn(), observer: this as unknown as ResizeObserver };
        observers.push(this.record);
      }
      observe(element: Element): void { this.record.elements.add(element); }
      unobserve(element: Element): void { this.record.elements.delete(element); }
      disconnect(): void { this.record.disconnect(); }
    });
    let scrollbarHeight = 0;
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("structural-tables-live-preview")) return new DOMRect(20, 10, 500, 300);
      if (this.classList.contains("structural-tables-table")) return new DOMRect(70, 50, 900, 200);
      if (this.classList.contains("structural-tables-container")) return new DOMRect(70, 50, 250, 200 + scrollbarHeight);
      return originalRect.call(this);
    });
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const scroller = parent.querySelector<HTMLElement>(".structural-tables-container")!;
    const addRow = parent.querySelector<HTMLElement>(".structural-tables-add-row")!;
    expect(addRow.style.top).toBe("240px");
    const observer = observers.find((record) => record.elements.has(scroller));
    expect(observer).toBeDefined();
    scrollbarHeight = 16;
    observer!.callback([{
      target: scroller,
      contentRect: scroller.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    }], observer!.observer);
    expect(addRow.style.top).toBe("256px");
    expect(view.state.doc.toString()).toBe(screenshotTable);
    view.destroy();
    expect(observer!.disconnect).toHaveBeenCalledOnce();
  });

  it("uses one tab stop per cell and handle group with arrow-key navigation", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cells = Array.from(parent.querySelectorAll<HTMLElement>(
      "[data-structural-row][data-structural-column]",
    ));
    const rows = Array.from(parent.querySelectorAll<HTMLButtonElement>("[data-structural-row-handle]"));
    const columns = Array.from(parent.querySelectorAll<HTMLButtonElement>("[data-structural-column-handle]"));
    expect(cells.filter((cell) => cell.tabIndex === 0)).toEqual([cells[0]]);
    expect(rows.filter((handle) => handle.tabIndex === 0)).toEqual([rows[0]]);
    expect(columns.filter((handle) => handle.tabIndex === 0)).toEqual([columns[0]]);

    cells[0]?.focus();
    cells[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(cells[1]);
    expect(cells.filter((cell) => cell.tabIndex === 0)).toEqual([cells[1]]);
    expect(cells[1]?.getAttribute("aria-selected")).toBe("true");

    rows[0]?.focus();
    rows[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    expect(rows.filter((handle) => handle.tabIndex === 0)).toEqual([rows[1]]);

    columns[0]?.focus();
    columns[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(columns[1]);
    expect(columns.filter((handle) => handle.tabIndex === 0)).toEqual([columns[1]]);

    const table = parent.querySelector<HTMLTableElement>(".structural-tables-table")!;
    table.style.direction = "rtl";
    cells[0]?.focus();
    cells[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement).toBe(cells[1]);
    columns[0]?.focus();
    columns[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement).toBe(columns[1]);
    view.destroy();
  });

  it.each([false, true])("restores focus after a structural menu changes table ownership (takeover=%s)", async (takeOverOrdinaryTables) => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length }, [], undefined, { takeOverOrdinaryTables });
    try {
      const selector = "[data-structural-row='3'][data-structural-column='3']";
      const cell = parent.querySelector<HTMLElement>(selector)!;
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const split = lastMenu?.items.find((item) => item.title === "Split merged cell");
      expect(split).toBeDefined();
      split?.callback?.();
      await Promise.resolve();
      const restored = parent.querySelector<HTMLTableCellElement>(selector)!;
      if (takeOverOrdinaryTables) {
        expect(restored.rowSpan).toBe(1);
        expect(restored.colSpan).toBe(1);
        expect(document.activeElement).toBe(restored);
      } else {
        expect(restored).toBeNull();
        expect(view.hasFocus).toBe(true);
      }
    } finally { view.destroy(); }
  });

  it("clears owned cell selection when the editor cursor moves elsewhere", () => {
    const source = `${screenshotTable}\n\nOutside`;
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
    dispatchPointerDown(cell, "mouse");
    expect(cell.getAttribute("aria-selected")).toBe("true");

    view.dispatch({ selection: { anchor: source.length - "Outside".length } });

    expect(parent.querySelector("[aria-selected='true']")).toBeNull();
    expect(parent.querySelector(".structural-tables-row-handle.is-selected")).toBeNull();
    expect(parent.querySelector(".structural-tables-column-handle.is-selected")).toBeNull();
    view.destroy();
  });
});

describe("wide-table keyboard entry", () => {
  it("keeps a visible column handle in the Tab sequence after horizontal scrolling", () => {
    let horizontalOffset = 0;
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("structural-tables-live-preview")) return rect(0, 0, 180, 140);
      if (this.classList.contains("structural-tables-container")) return rect(40, 20, 100, 80);
      if (this.tagName === "TABLE") return rect(40 - horizontalOffset, 20, 300, 80);
      if (this.tagName === "TR") return rect(40 - horizontalOffset, 20, 300, 40);
      if (this.dataset.structuralColumn !== undefined) return rect(40 - horizontalOffset + Number(this.dataset.structuralColumn) * 100, 20, 100, 40);
      return rect(0, 0, 0, 0);
    });
    const source = "Before\n\n| H | V | W |\n| --- || --- | --- |\n| A | B | C |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      horizontalOffset = 100;
      parent.querySelector(".structural-tables-container")!.dispatchEvent(new Event("scroll"));
      const handles = [...parent.querySelectorAll<HTMLButtonElement>(".structural-tables-column-handle")];
      expect(handles.some((handle) => !handle.hidden)).toBe(true);
      expect(handles.some((handle) => !handle.hidden && handle.tabIndex === 0)).toBe(true);
    } finally { view.destroy(); }
  });
});
