// @vitest-environment happy-dom
import { EditorState, StateField } from "@codemirror/state";
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { Decoration, EditorView } from "@codemirror/view";
import { MarkdownRenderer, editorInfoField } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "../src/config/i18n";
import { parseEditableTables } from "../src/core/parser";
import { recoveredCellDrafts } from "../src/editor/cell-draft-recovery";
import { activeScopes, dispatchScopeCaptureThenDom, lastMenu, notices, setMockModKey } from "./mocks/obsidian";
import {
  NativeCalloutWidget,
  nativeTableForSource,
  SourceCalloutWidget,
  screenshotTable,
  mountEditor,
  draftInputEvent,
  typeDraftText,
  replaceDraftText,
  modEvent,
  dispatchDraftShortcut,
  dispatchPointerDown,
} from "./helpers/live-preview-editor";

describe("Cell draft lifecycle", () => {
  it.each(["complete-ltr", "complete-rtl", "pointer", "wheel", "scroll", "key", "undo", "rename", "other-editor", "direction", "new-source", "destroy"] as const)("restores only the exact cell-commit viewport after delayed rendering (%s)", async (interference) => {
    let finish: (() => void) | undefined;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, markdown, target) => {
      if (markdown === "changed-final") await new Promise<void>((resolve) => { finish = resolve; });
      target.textContent = markdown;
    });
    const table = "| H | V |\n| --- || --- |\n| A | final-cell |";
    const source = `Before\n\n${table}\n\nBetween\n\n${table}\n\nAfter`;
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    parent.dir = interference === "complete-rtl" ? "rtl" : "ltr";
    let other: EditorView | undefined;
    try {
      const original = parent.querySelectorAll<HTMLElement>(".structural-tables-container");
      const first = original[0]!; const second = original[1]!;
      first.scrollLeft = 40; second.scrollLeft = interference === "complete-rtl" ? -120 : 120;
      const expected = second.scrollLeft;
      second.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      parent.querySelector<HTMLTextAreaElement>("textarea")!.value = "changed-final";
      const outside = document.body.appendChild(document.createElement("button")); outside.focus();
      await vi.waitFor(() => expect(finish).toBeDefined());
      const replacement = parent.querySelectorAll<HTMLElement>(".structural-tables-container")[1]!;
      expect(replacement).not.toBe(second); expect(first.scrollLeft).toBe(40);
      if (!interference.startsWith("complete")) {
        replacement.scrollLeft = 20;
        if (interference === "pointer") dispatchPointerDown(replacement, "touch");
        else if (interference === "wheel") replacement.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        else if (interference === "scroll") replacement.dispatchEvent(new Event("scroll"));
        else if (interference === "key") outside.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
        else if (interference === "undo") { expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source); }
        else if (interference === "rename") view.state.field(editorInfoField).file!.path = "Other.md";
        else if (interference === "other-editor") {
          other = new EditorView({ parent: document.body, state: EditorState.create({ doc: source }) });
          other.dom.append(replacement.parentElement!);
          view.dom.remove();
        } else if (interference === "direction") replacement.style.direction = "rtl";
        else if (interference === "new-source") view.dispatch({ changes: { from: view.state.doc.length, insert: "\nExternal" } });
        else view.destroy();
      }
      finish!(); await new Promise((resolve) => setTimeout(resolve, 70));
      expect(replacement.scrollLeft).toBe(interference.startsWith("complete") ? expected : 20);
      expect(first.scrollLeft).toBe(40);
      if (interference.startsWith("complete")) {
        expect(undoDepth(view.state)).toBe(1); expect(parseEditableTables(view.state.doc.toString()).tables[0]!.source).toBe(table);
        expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
      }
    } finally { if (interference !== "destroy") view.destroy(); other?.destroy(); }
  });

  it.each((["row", "column"] as const).flatMap((axis) => [false, true].map((changed) => ({ axis, changed }))))(
    "moves the first held $axis drag with an active draft (changed=$changed) and restores axis selection", async ({ axis, changed }) => {
    const source = ["Before", "", "| H1 | H2 | H3 |", "| --- || --- | --- |", "| A | B | C |", "| D | E | F |", "", "End"].join("\n");
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("structural-tables-live-preview")) return rect(0, 0, 430, 250);
      if (this.tagName === "TABLE") return rect(40, 20, 300, 160);
      if (this.tagName === "TR") {
        const row = [...this.closest("table")!.rows].indexOf(this as HTMLTableRowElement);
        return rect(40, 20 + row * 40, 300, 40);
      }
      if (this.dataset.structuralColumn !== undefined) return rect(
        40 + Number(this.dataset.structuralColumn) * 100, 20 + Number(this.dataset.structuralRow) * 40,
        100 * Number(this.getAttribute("colspan") ?? 1), 40 * Number(this.getAttribute("rowspan") ?? 1),
      );
      return rect(0, 0, 0, 0);
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const pointer = (type: string, x: number, y: number) => new PointerEvent(type, {
      pointerId: 4, isPrimary: true, button: 0, pointerType: "mouse", clientX: x, clientY: y,
      bubbles: true, cancelable: true,
    });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='2']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(editor).not.toBeNull();
      if (changed) editor.value = "DRAFT";
      const expected = changed ? "DRAFT" : "F";
      const handle = parent.querySelector<HTMLElement>(axis === "row"
        ? "[data-structural-row-handle='2']" : "[data-structural-column-handle='2']")!;
      const origin = axis === "row" ? { x: 25, y: 120 } : { x: 290, y: 10 };
      const destination = axis === "row" ? { x: 25, y: 60 } : { x: 140, y: 10 };
      handle.dispatchEvent(pointer("pointerdown", origin.x, origin.y));
      expect(editor.isConnected).toBe(true);
      window.dispatchEvent(pointer("pointermove", destination.x, destination.y));
      window.dispatchEvent(pointer("pointerup", destination.x, destination.y));
      await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows
        .flatMap((row) => row.cells.map((cell) => cell.content))).toContain(expected));
      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table.valid).toBe(true);
      expect(table.rows[axis === "row" ? 1 : 2]!.cells[axis === "row" ? 2 : 1]!.content).toBe(expected);
      await vi.waitFor(() => expect(parent.querySelector(`.structural-tables-${axis}-handle.is-selected`)).not.toBeNull());
      expect(parent.querySelector<HTMLTextAreaElement>("textarea")).toBeNull();
      expect(undoDepth(view.state)).toBe(1);
      const after = view.state.doc.toString();
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(after);
    } finally { view.destroy(); }
  });

  it("adds a column together with an active draft and focuses the new header", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      cell.querySelector<HTMLTextAreaElement>("textarea")!.value = "Draft";
      parent.querySelector<HTMLButtonElement>(".structural-tables-add-column")!.click();
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='0'][data-structural-column='2'] textarea")).not.toBeNull());
      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table.columnCount).toBe(3);
      expect(table.rows[1]!.cells[1]!.content).toBe("Draft");
      parent.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("restores a rebuilt Callout cell after commit and host command undo/redo", async () => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div"); element.className = options.cls; return element;
    });
    let completeRender: (() => void) | undefined;
    let delayUpdated = true;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const source = args[1] as string;
      const container = args[2] as HTMLElement;
      if (container.className !== "structural-tables-container") return;
      if (source.includes("Updated") && delayUpdated) await new Promise<void>((resolve) => { completeRender = resolve; });
      container.innerHTML = nativeTableForSource(source)!.outerHTML;
    });
    const nativeFor = (source: string) => Decoration.set([
      Decoration.replace({ widget: new SourceCalloutWidget(source), block: true })
        .range(source.indexOf("> [!note]"), source.indexOf("\n\nEnd")),
    ]);
    const native = StateField.define({
      create: (state) => nativeFor(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged ? nativeFor(transaction.newDoc.toString()) : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const source = "Before\n\n> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n> | next | target |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native, history()]);
    await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
    const cell = parent.querySelector<HTMLElement>(".callout [data-structural-row='1'][data-structural-column='1']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.value = "Updated";
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(view.state.selection.main.anchor).toBe(0);
    await vi.waitFor(() => expect(completeRender).toBeDefined());
    completeRender!();
    await vi.waitFor(() => expect(document.activeElement).toBe(parent.querySelector(".callout [data-structural-row='2'][data-structural-column='1'] textarea")));
    expect(view.state.doc.toString()).toContain("Updated");
    delayUpdated = false;
    const external = document.body.appendChild(document.createElement("button"));
    external.focus();
    expect(undo(view)).toBe(true);
    await vi.waitFor(() => {
      const restored = parent.querySelector(".callout [data-structural-row='1'][data-structural-column='1']");
      expect(view.state.doc.toString()).toBe(source);
      expect(restored).not.toBeNull();
      expect(document.activeElement).toBe(restored);
    });
    external.focus();
    expect(redo(view)).toBe(true);
    await vi.waitFor(() => {
      const restored = parent.querySelector(".callout [data-structural-row='1'][data-structural-column='1']");
      expect(view.state.doc.toString()).toContain("Updated");
      expect(restored).not.toBeNull();
      expect(document.activeElement).toBe(restored);
    });
    view.destroy();
  });

  it("mounts the shared cell editor inside a native callout and releases ownership on disable", async () => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div");
      element.className = options.cls;
      return element;
    });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const container = args[2] as HTMLElement;
      if (container.className === "structural-tables-container") {
        container.innerHTML = new NativeCalloutWidget().toDOM().querySelector(".callout-content")!.innerHTML;
      }
    });
    const source = "> [!note]\n> | A | < |\n> | --- | --- |\n> | x | y |\n\nEnd";
    const native = EditorView.decorations.of(Decoration.set([
      Decoration.replace({ widget: new NativeCalloutWidget(), block: true }).range(0, source.indexOf("\n\n")),
    ]));
    const { parent, view, updateSettings } = mountEditor(source, { anchor: source.length }, [native]);
    await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview th")?.getAttribute("colspan")).toBe("2"));
    expect(parent.querySelector(".callout-title")?.textContent).toBe("Note");
    updateSettings({ enableLivePreview: false });
    await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).toBeNull());
    expect(parent.querySelectorAll(".callout th")).toHaveLength(2);
    view.destroy();
  });

  it.each([false, true])("keeps the new cell scope when focus transfers directly between cell editors (changed=%s)", async (changed) => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cells = parent.querySelectorAll<HTMLElement>("[data-structural-row='0'][data-structural-column]");
    cells[0]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    if (changed) parent.querySelector<HTMLTextAreaElement>("textarea")!.value = "First draft saved";
    cells[1]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await Promise.resolve();
    expect(parent.querySelectorAll("textarea")).toHaveLength(1);
    expect(activeScopes).toHaveLength(1);
    if (changed) expect(view.state.doc.toString()).toContain("First draft saved");
    activeScopes[0]!.handlers.find((handler) => handler.key === "Escape")!
      .callback(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(parent.querySelector("textarea")).toBeNull();
    view.destroy();
    expect(activeScopes).toHaveLength(0);
  });

  it("inserts an empty marker pair at a collapsed draft selection", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(4, 4);

      dispatchDraftShortcut(editor, "i");

      expect(editor.value).toBe("West**");
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([5, 5]);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("undoes typing then draft formatting in reverse order without touching main-editor history", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inheritedUndo = vi.fn(() => false);
    app.scope.register(["Mod"], "z", inheritedUndo);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");
      expect(editor.value).toBe("**West draft**");

      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West draft");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");

      expect(inheritedUndo).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("redoes draft typing with Ctrl+Y and formatting with Mod+Shift+Z", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inheritedRedoY = vi.fn(() => false);
    const inheritedRedoZ = vi.fn(() => false);
    app.scope.register(["Ctrl"], "y", inheritedRedoY);
    app.scope.register(["Mod", "Shift"], "z", inheritedRedoZ);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");

      dispatchDraftShortcut(editor, "z");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");

      const redoTyping = new KeyboardEvent("keydown", {
        key: "y", ctrlKey: true, bubbles: true, cancelable: true,
      });
      setMockModKey("ctrl");
      dispatchScopeCaptureThenDom(editor, redoTyping);
      expect(redoTyping.defaultPrevented).toBe(true);
      expect(editor.value).toBe("West draft");

      const redoFormat = dispatchDraftShortcut(editor, "z", "ctrl", true);
      expect(redoFormat.defaultPrevented).toBe(true);
      expect(editor.value).toBe("**West draft**");
      expect(inheritedRedoY).not.toHaveBeenCalled();
      expect(inheritedRedoZ).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("clears draft redo after new typing following undo", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inheritedRedo = vi.fn(() => false);
    app.scope.register(["Mod", "Shift"], "z", inheritedRedo);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West draft");

      editor.setSelectionRange(editor.value.length, editor.value.length);
      typeDraftText(editor, " X");
      expect(editor.value).toBe("West draft X");

      const redo = dispatchDraftShortcut(editor, "z", "ctrl", true);
      expect(redo.defaultPrevented).toBe(true);
      expect(editor.value).toBe("West draft X");
      expect(inheritedRedo).not.toHaveBeenCalled();

      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West draft");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("undoes typing -> format -> continued typing as three draft transactions", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inheritedUndo = vi.fn(() => false);
    app.scope.register(["Mod"], "z", inheritedUndo);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");
      editor.setSelectionRange(editor.value.length, editor.value.length);
      typeDraftText(editor, "!");
      expect(editor.value).toBe("**West draft**!");

      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("**West draft**");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West draft");
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");

      expect(inheritedUndo).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("records one composition input transaction and keeps formatting commands out of it", () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    const inherited = vi.fn(() => false);
    app.scope.register(["Mod"], "b", inherited);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "中" }));
      const before = draftInputEvent("beforeinput", "insertCompositionText", "中", true);
      expect(editor.dispatchEvent(before)).toBe(true);
      editor.setRangeText("中", editor.selectionStart, editor.selectionEnd, "end");
      editor.dispatchEvent(draftInputEvent("input", "insertCompositionText", "中", true));

      const format = modEvent("b");
      Object.defineProperty(format, "isComposing", { value: true });
      dispatchScopeCaptureThenDom(editor, format);
      expect(format.defaultPrevented).toBe(true);
      expect(inherited).not.toHaveBeenCalled();
      expect(editor.value).toBe("中");

      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "中" }));
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("commits a draft-local format as one main-document history change", async () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");
      expect(view.state.doc.toString()).toBe(source);

      editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      expect(view.state.doc.toString()).toContain("**West draft**");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("retains a formatted draft when a real external source change invalidates its widget", async () => {
    const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
    const { app, parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='1']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "West draft");
      editor.select();
      dispatchDraftShortcut(editor, "b");

      const saved = source.indexOf("West");
      view.dispatch({ changes: { from: saved, to: saved + 4, insert: "External" } });
      await Promise.resolve();
      await Promise.resolve();

      expect(view.state.doc.toString()).toContain("External");
      expect(view.state.doc.toString()).not.toContain("West draft");
      expect(recoveredCellDrafts(app).map((draft) => draft.text)).toContain("**West draft**");
    } finally {
      view.destroy();
    }
  });

  it.each([false, true])("rebinds a shifted table without losing an open draft (%s)", async (openBeforeShift) => {
    const source = `Introduction\n\n${screenshotTable}\n\nEnd`;
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      if (openBeforeShift) cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const draft = cell.querySelector<HTMLTextAreaElement>("textarea");
      if (draft !== null) draft.value = "Preserved draft";
      view.dispatch({ changes: { from: 0, insert: "Added paragraph\n\n" } });
      if (!openBeforeShift) {
        parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!
          .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      }
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      if (openBeforeShift) {
        expect(editor).toBe(draft);
        expect(editor.value).toBe("Preserved draft");
      } else editor.value = "Preserved draft";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
      expect(view.state.doc.toString()).toContain("Preserved draft");
      expect(view.state.doc.toString()).toMatch(/^Added paragraph\n\nIntroduction/u);
    } finally { view.destroy(); }
  });

  it("places a pointer-entered plain-text draft caret at the proven DOM UTF-16 offset", () => {
    const source = "| H | V |\n| --- || --- |\n| A😀B | Keep |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      const content = cell.querySelector<HTMLElement>(".structural-tables-cell-content")!;
      content.replaceChildren(document.createTextNode("A😀B"));
      const text = content.firstChild!;
      Object.defineProperty(document, "caretPositionFromPoint", {
        configurable: true,
        value: () => ({ offsetNode: text, offset: 3 }),
      });

      dispatchPointerDown(cell, "mouse");
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([3, 3]);
      typeDraftText(editor, "X");
      expect(editor.value).toBe("A😀XB");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      Reflect.deleteProperty(document, "caretPositionFromPoint");
      view.destroy();
    }
  });

  it("commits Enter to the next logical row in the same column and selects that draft", async () => {
    const source = "| H | V |\n| --- || --- |\n| A | one |\n| B | two |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "ONE");
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

      await vi.waitFor(() => expect(
        parent.querySelector("[data-structural-row='2'][data-structural-column='1'] textarea"),
      ).not.toBeNull());
      const next = parent.querySelector<HTMLTextAreaElement>(
        "[data-structural-row='2'][data-structural-column='1'] textarea",
      )!;
      expect(next.value).toBe("two");
      expect([next.selectionStart, next.selectionEnd]).toEqual([0, 3]);
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[1]!.content).toBe("ONE");
    } finally { view.destroy(); }
  });

  it("commits terminal Enter plus append as one host history transaction", async () => {
    const source = "| H | V |\n| --- || --- |\n| A | one |\n| B | two |";
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "TWO");
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

      await vi.waitFor(() => expect(
        parent.querySelector("[data-structural-row='3'][data-structural-column='1'] textarea"),
      ).not.toBeNull());
      expect(writes).toBe(1);
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows).toHaveLength(4);
      parent.querySelector<HTMLTextAreaElement>("textarea")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["insertLineBreak", "insertParagraph"])("commits a terminal soft-keyboard %s and appends in one Undo", async (inputType) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | one |\n| B | two |\n\nAfter";
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      replaceDraftText(editor, "TWO");
      const event = draftInputEvent("beforeinput", inputType, null);
      editor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='3'][data-structural-column='1'] textarea"))
        .not.toBeNull());
      const result = view.state.doc.toString();
      expect(writes).toBe(1);
      expect(parseEditableTables(result).tables[0]!.rows).toHaveLength(4);
      expect(parseEditableTables(result).tables[0]!.rows[2]!.cells[1]!.content).toBe("TWO");
      parent.querySelector<HTMLTextAreaElement>("textarea")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(result);
    } finally { view.destroy(); }
  });

  it.each([
    ["rtl", "ABC"], ["ltr", "مرحبا"], ["ltr", "ABC مرحبا 123"],
  ])("keeps horizontal %s draft navigation native for %s", (direction, content) => {
    const source = `| H1 | H2 |\n| --- || --- |\n| North | ${content} |`;
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      parent.querySelector<HTMLTableElement>("table")!.style.direction = direction!;
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      for (const offset of [0, editor.value.length]) {
        editor.setSelectionRange(offset, offset);
        for (const key of ["ArrowLeft", "ArrowRight"]) {
          const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
          editor.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(false);
          expect(editor.isConnected).toBe(true);
          expect(view.state.doc.toString()).toBe(source);
        }
      }
    } finally { view.destroy(); }
  });

  it("moves across horizontal draft boundaries but preserves internal caret and text selection", async () => {
    const source = "| H1 | H2 |\n| --- || --- |\n| North | South |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const first = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      let editor = first.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(2, 2);
      const internal = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
      editor.dispatchEvent(internal);
      expect(internal.defaultPrevented).toBe(false);
      expect(editor.isConnected).toBe(true);

      editor.setSelectionRange(editor.value.length, editor.value.length);
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(
        parent.querySelector("[data-structural-row='1'][data-structural-column='1'] textarea"),
      ).not.toBeNull());
      editor = parent.querySelector<HTMLTextAreaElement>("[data-structural-row='1'][data-structural-column='1'] textarea")!;
      expect(editor.value).toBe("South");

      editor.setSelectionRange(0, 2);
      const selected = new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
      editor.dispatchEvent(selected);
      expect(selected.defaultPrevented).toBe(false);
      expect(editor.isConnected).toBe(true);

      editor.setSelectionRange(0, 0);
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(
        parent.querySelector("[data-structural-row='1'][data-structural-column='0'] textarea"),
      ).not.toBeNull());
    } finally { view.destroy(); }
  });

  it("takes vertical draft arrows only when one visual line is geometrically provable", async () => {
    const source = "| H | V |\n| --- || --- |\n| A | one |\n| B | two |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const first = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      let editor = first.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(1, 1);
      const unknown = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      editor.dispatchEvent(unknown);
      expect(unknown.defaultPrevented).toBe(false);

      Object.defineProperty(editor, "clientHeight", { configurable: true, value: 20 });
      Object.defineProperty(editor, "scrollHeight", { configurable: true, value: 20 });
      editor.style.lineHeight = "20px";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(
        parent.querySelector("[data-structural-row='2'][data-structural-column='1'] textarea"),
      ).not.toBeNull());
      editor = parent.querySelector<HTMLTextAreaElement>("[data-structural-row='2'][data-structural-column='1'] textarea")!;
      expect(editor.value).toBe("two");
    } finally { view.destroy(); }
  });

  it.each([false, true])("does not steal focus when a cell editor loses focus (changed=%s)", async (changed) => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      if (changed) parent.querySelector<HTMLTextAreaElement>("textarea")!.value = "Saved on blur";
      const outside = document.body.appendChild(document.createElement("button"));
      outside.focus();
      await Promise.resolve();
      expect(document.activeElement).toBe(outside);
      expect(parent.querySelector("textarea")).toBeNull();
    } finally { view.destroy(); }
  });

  it("opens the next-row draft after commit and routes grid history after text editing ends", async () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    try {
      const undo = vi.fn();
      const redo = vi.fn();
      Object.assign(view.state.field(editorInfoField).editor!, { undo, redo });
      const selector = "[data-structural-row='1'][data-structural-column='2']";
      const oldCell = parent.querySelector<HTMLElement>(selector)!;
      oldCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Committed";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
      expect(undo).not.toHaveBeenCalled();
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
      const cell = parent.querySelector<HTMLElement>(selector)!;
      expect(cell).not.toBe(oldCell);
      const nextEditor = parent.querySelector<HTMLTextAreaElement>("[data-structural-row='2'][data-structural-column='2'] textarea")!;
      expect(document.activeElement).toBe(nextEditor);
      nextEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      dispatchPointerDown(cell, "mouse");
      expect(document.activeElement).toBe(cell);
      expect(cell.tabIndex).toBe(0);
      expect(view.state.doc.toString()).toContain("Committed");
      for (const [key, ctrlKey, metaKey, shiftKey] of [
        ["z", true, false, false], ["z", false, true, false],
        ["z", true, false, true], ["y", true, false, false],
      ] as const) {
        const event = new KeyboardEvent("keydown", { key, ctrlKey, metaKey, shiftKey, bubbles: true, cancelable: true });
        cell.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        await Promise.resolve();
      }
      expect(undo).toHaveBeenCalledTimes(2);
      expect(redo).toHaveBeenCalledTimes(2);
      const f2 = new KeyboardEvent("keydown", { key: "F2", cancelable: true });
      expect(activeScopes[0]!.handlers.find((handler) => handler.key === "F2")!.callback(f2)).toBe(false);
      expect(f2.defaultPrevented).toBe(true);
      expect(parent.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Committed");
      expect(activeScopes).toHaveLength(1);
      expect(activeScopes[0]!.handlers.some((handler) => handler.key === "Escape")).toBe(true);
    } finally { view.destroy(); }
  });

  it("does not reclaim focus after IME composition hands a rejected draft to external UI", async () => {
    const source = "| A | B |\n| --- | --- |\n| First | | < |";
    const noticeStart = notices.length;
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    const external = document.body.appendChild(document.createElement("button"));
    external.textContent = "Outside";
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "IME draft";
      editor.dispatchEvent(new CompositionEvent("compositionstart", {
        bubbles: true,
        data: "IME",
      }));
      expect(document.activeElement).toBe(editor);
      expect(activeScopes).toHaveLength(1);

      external.focus();
      expect(document.activeElement).toBe(external);
      expect(activeScopes).toHaveLength(0);

      editor.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "IME draft",
      }));
      await Promise.resolve();
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true);
      expect(editor.value).toBe("IME draft");
      expect(document.activeElement).toBe(external);
      expect(activeScopes).toHaveLength(0);
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells")))
        .toHaveLength(1);

      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      expect(document.activeElement).toBe(external);
    } finally {
      view.destroy();
    }
    await Promise.resolve();
    expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value)
      .toBe("IME draft");
  });

  it("keeps rejected-draft focus ownership during a temporary cell context-menu blur", async () => {
    const source = "| A | B |\n| --- | --- |\n| First | | < |";
    const noticeStart = notices.length;
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    const external = document.body.appendChild(document.createElement("button"));
    external.textContent = "Menu surface";
    try {
      const cell = parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Menu draft";
      editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells")))
        .toHaveLength(1);

      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu).not.toBeNull();
      external.focus();
      expect(document.activeElement).toBe(external);
      expect(activeScopes).toHaveLength(0);

      lastMenu?.hide();
      external.remove(); // A real dismissed menu removes its focused surface.
      await vi.waitFor(() => expect(document.activeElement).toBe(editor));

      expect(editor.value).toBe("Menu draft");
      expect(view.state.doc.toString()).toBe(source);
      expect(activeScopes).toHaveLength(1);
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells")))
        .toHaveLength(1);
    } finally {
      view.destroy();
    }
  });

  it("moves focus between rejected drafts in separate table widgets without a refocus loop", async () => {
    const source = [
      "| A | B |",
      "| --- | --- |",
      "| First | | < |",
      "",
      "| C | D |",
      "| --- | --- |",
      "| First | | ^ |",
    ].join("\n");
    const noticeStart = notices.length;
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      expect(hosts).toHaveLength(2);
      const firstCell = hosts[0]!.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      firstCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const firstEditor = hosts[0]!.querySelector<HTMLTextAreaElement>("textarea")!;
      firstEditor.value = "B";
      firstEditor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(source);
      expect(firstEditor.value).toBe("B");
      expect(document.activeElement).toBe(firstEditor);
      expect(activeScopes).toHaveLength(1);
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells"))).toHaveLength(1);

      const secondCell = hosts[1]!.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      secondCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const secondEditor = hosts[1]!.querySelector<HTMLTextAreaElement>("textarea")!;
      await Promise.resolve();
      await Promise.resolve();

      expect(parent.querySelectorAll(".structural-tables-cell-editor")).toHaveLength(2);
      expect(document.activeElement).toBe(secondEditor);
      expect(firstEditor.value).toBe("B");
      expect(activeScopes).toHaveLength(1);
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells"))).toHaveLength(1);

      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      expect(document.activeElement).toBe(secondEditor);

      secondEditor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      }));
      expect(hosts[1]!.querySelector("textarea")).toBeNull();
      expect(firstEditor.isConnected).toBe(true);
      expect(firstEditor.value).toBe("B");

      firstEditor.focus();
      await Promise.resolve();
      expect(document.activeElement).toBe(firstEditor);
      expect(activeScopes).toHaveLength(1);
    } finally {
      view.destroy();
    }
    await Promise.resolve();
    expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value).toBe("B");
  });

  it("keeps rejected-draft focus ownership stable across separate editor views", async () => {
    const leftSource = "| A | B |\n| --- | --- |\n| First | | < |";
    const rightSource = "| C | D |\n| --- | --- |\n| First | | ^ |";
    const left = mountEditor(
      leftSource,
      { anchor: leftSource.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    const right = mountEditor(
      rightSource,
      { anchor: rightSource.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const leftCell = left.parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      leftCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const leftEditor = left.parent.querySelector<HTMLTextAreaElement>("textarea")!;
      leftEditor.value = "Left draft";
      leftEditor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      const rightCell = right.parent.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      rightCell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const rightEditor = right.parent.querySelector<HTMLTextAreaElement>("textarea")!;
      await Promise.resolve();
      await Promise.resolve();

      expect(leftEditor.isConnected).toBe(true);
      expect(leftEditor.value).toBe("Left draft");
      expect(document.activeElement).toBe(rightEditor);
      expect(activeScopes).toHaveLength(1);
      expect(left.view.state.doc.toString()).toBe(leftSource);
      expect(right.view.state.doc.toString()).toBe(rightSource);

      for (let turn = 0; turn < 4; turn += 1) await Promise.resolve();
      expect(document.activeElement).toBe(rightEditor);
    } finally {
      right.view.destroy();
      left.view.destroy();
    }
  });

  it("lets another widget commit successfully while a rejected draft remains recoverable", async () => {
    const source = [
      "| A | B |",
      "| --- | --- |",
      "| First | | < |",
      "",
      "| Safe | Value |",
      "| --- | --- |",
      "| First | 1 |",
    ].join("\n");
    const noticeStart = notices.length;
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      expect(hosts).toHaveLength(2);
      hosts[0]!.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const rejected = hosts[0]!.querySelector<HTMLTextAreaElement>("textarea")!;
      rejected.value = "Rejected draft";
      rejected.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      hosts[1]!.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const successful = hosts[1]!.querySelector<HTMLTextAreaElement>("textarea")!;
      successful.value = "Saved elsewhere";
      successful.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();

      const parsed = parseEditableTables(view.state.doc.toString()).tables;
      expect(parsed[1]?.rows[1]?.cells[0]?.content).toBe("Saved elsewhere");
      expect(parsed[0]?.source).toBe("| A | B |\n| --- | --- |\n| First | | < |");
      expect(notices.slice(noticeStart).filter((notice) => notice.includes("extra source cells"))).toHaveLength(1);
    } finally {
      view.destroy();
    }
    await Promise.resolve();
    expect(document.querySelector<HTMLTextAreaElement>(".structural-tables-recovered-draft")?.value)
      .toBe("Rejected draft");
  });

  it("keeps an in-place draft when hidden GFM overflow makes the table read-only", async () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 | KEEP |";
    const { parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "Draft stays";
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(source);
      expect(parent.querySelector<HTMLTextAreaElement>("textarea")).toBe(editor);
      expect(editor.value).toBe("Draft stays");
      expect(document.activeElement).toBe(editor);
    } finally {
      view.destroy();
    }
  });

  it("opens the cell editor after two touch taps on the same cell", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;

    const firstTap = dispatchPointerDown(cell, "touch", 1_000);
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(firstTap.defaultPrevented).toBe(false);
    expect(cell.querySelector(".structural-tables-cell-editor")).toBeNull();

    const secondTap = dispatchPointerDown(cell, "touch", 1_500);
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(secondTap.defaultPrevented).toBe(true);
    expect(cell.querySelector(".structural-tables-cell-editor")).not.toBeNull();
    view.destroy();
  });

  it.each([false, true])("preserves Markdown block boundaries through a real cell commit and Undo/Redo (ordinary=%s)", async (ordinary) => {
    const before = "# Before | explanation\n";
    const tableSource = `| A | ${ordinary ? "B" : "<"} |\n| --- | --- |\n| x | y |`;
    const after = "\n- After | explanation\n\nEnd";
    const source = before + tableSource + after;
    const targetRow = parseEditableTables(source).tables[0]!.rows.findIndex((row) => row.cells[1]?.content === "y");
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener], undefined,
      { takeOverOrdinaryTables: ordinary });
    try {
      const cell = parent.querySelector<HTMLElement>(`[data-structural-row='${targetRow}'][data-structural-column='1']`)!;
      expect(cell).not.toBeNull();
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(editor).not.toBeNull();
      replaceDraftText(editor, "CHANGED");
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await vi.waitFor(() => expect(view.state.doc.toString()).toContain("CHANGED"));
      const updated = view.state.doc.toString();
      expect(updated.startsWith(before)).toBe(true);
      expect(updated.endsWith(after)).toBe(true);
      expect(parseEditableTables(updated).tables[0]?.rows[1]?.cells[1]?.content).toBe("CHANGED");
      expect(writes).toBe(1);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(updated);
    } finally { view.destroy(); }
  });

  it.each(["en", "ar"] as const)("keeps an unsafe math draft and applies a user-confirmed safe rewrite from its %s context menu", async (language) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [], undefined, { language });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor")!;
      editor.value = "$|x|$";

      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true);

      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const item = lastMenu?.items.find((candidate) => candidate.title === createTranslator(language)("menu.useMathAbsoluteSuggestion"));
      expect(item).toBeDefined();
      item?.callback?.();
      await Promise.resolve();

      const parsed = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(parsed.columnCount).toBe(2);
      expect(parsed.rows[1]!.cells[1]!.content).toBe(String.raw`$\lvert x\rvert$`);
      expect(view.state.doc.toString()).not.toMatch(/\p{Bidi_Control}/u);
      expect(parent.querySelector(".structural-tables-cell-editor")).toBeNull();
    } finally { view.destroy(); }
  });

  it.each(["Enter", "Tab"])("keeps unsafe drafts without navigation or growth on %s", (key) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = String.raw`$P(\text{A|B})$`;
      editor.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true);
      expect(editor.value).toBe(String.raw`$P(\text{A|B})$`);
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu?.items.some((item) => item.title.startsWith("Use \\"))).toBe(false);
      lastMenu?.hide();
      const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      expect(activeScopes[0]!.handlers.find((handler) => handler.key === "Escape")!.callback(escape)).toBeUndefined();
      editor.dispatchEvent(escape);
      expect(editor.isConnected).toBe(true);
      expect(editor.value).toBe(String.raw`$P(\text{A|B})$`);
    } finally { view.destroy(); }
  });

  it.each(["cancel", "changed", "composing"])("does not apply a suggestion after %s", async (action) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "$|x|$";
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const item = lastMenu?.items.find((candidate) => candidate.title === "Use \\lvert … \\rvert and save");
      expect(item).toBeDefined();
      if (action === "changed") editor.value = "$|y|$";
      if (action === "composing") editor.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      if (action !== "cancel") item?.callback?.();
      lastMenu?.hide();
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true);
      expect(editor.value).toBe(action === "changed" ? "$|y|$" : "$|x|$");
    } finally { view.destroy(); }
  });

  it("expands the editing row for a long draft and restores its height on cancel", () => {
    const source = "| Name | Value |\n| --- || --- |\n| A | Short |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 120, height: 32, right: 120, bottom: 32, x: 0, y: 0, toJSON: () => ({}),
    });
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
    const row = cell.closest<HTMLTableRowElement>("tr")!;
    Object.defineProperty(editor, "scrollHeight", { configurable: true, get: () => 144 });

    editor.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.style.getPropertyValue("--structural-table-edit-row-height")).toBe("144px");

    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(row.style.getPropertyValue("--structural-table-edit-row-height")).toBe("0px");
    view.destroy();
  });

  it.each(["insertLineBreak", "insertParagraph"])("commits a selected neighbouring cell before soft-keyboard %s can replace its text", async (inputType) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Software | Applications |\n| Next | Target |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const hostInput = vi.fn();
    parent.addEventListener("beforeinput", hostInput);
    try {
      parent.querySelector("[data-structural-row='1'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      parent.querySelector("[data-structural-row='1'][data-structural-column='1']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = parent.querySelector("textarea")!;
      expect(editor.value).toBe("Applications");
      expect(editor.selectionStart).toBe(editor.value.length);
      editor.select();
      const enter = new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true });
      editor.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(true);
      expect(hostInput).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='2'][data-structural-column='1'] textarea"))
        .not.toBeNull());
      expect(parent.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Target");
      expect(undo(view)).toBe(false);

      parent.querySelector("[data-structural-row='1'][data-structural-column='1']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      parent.querySelector("textarea")!.value = "Updated";
      parent.querySelector("textarea")!.dispatchEvent(new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(view.state.doc.toString()).toContain("Updated"));
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("preserves selected text through Gboard's empty replacement before Enter while allowing deliberate deletion", () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Software | Applications |\n| Next | Target |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const open = () => {
      parent.querySelector("[data-structural-row='1'][data-structural-column='1']")!
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return parent.querySelector("textarea")!;
    };
    try {
      const editor = open();
      editor.select(); // The Gboard regression requires an actual text selection.
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Unidentified", bubbles: true }));
      const empty = new InputEvent("beforeinput", { inputType: "insertText", data: "", bubbles: true, cancelable: true });
      // Simulate the browser's default replacement only when it was not cancelled.
      if (editor.dispatchEvent(empty)) editor.setRangeText("", editor.selectionStart, editor.selectionEnd, "end");
      editor.dispatchEvent(new KeyboardEvent("keyup", { key: "Unidentified", bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(empty.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);

      const deleting = open();
      deleting.select(); // Explicit deletion tests a real selected range, not the new collapsed click caret.
      const deletion = new InputEvent("beforeinput", { inputType: "deleteContentBackward", data: null, bubbles: true, cancelable: true });
      expect(deleting.dispatchEvent(deletion)).toBe(true);
      deleting.setRangeText("", deleting.selectionStart, deleting.selectionEnd, "end");
      deleting.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      expect(view.state.doc.toString()).not.toContain("Applications");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);

      const composing = open();
      composing.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const compositionInput = new InputEvent("beforeinput", { inputType: "insertText", data: "", bubbles: true, cancelable: true });
      expect(composing.dispatchEvent(compositionInput)).toBe(true);
      composing.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    } finally { view.destroy(); }
  });

  it("keeps the cell editor open during IME composition and uses Tab as one undoable commit", async () => {
    let documentChanges = 0;
    const listener = EditorView.updateListener.of((update) => {
      if (update.docChanged) documentChanges += 1;
    });
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length }, [listener]);
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor")!;
    editor.value = "输入";
    editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "输" }));
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const composingInput = new InputEvent("beforeinput", {
      inputType: "insertLineBreak", isComposing: true, bubbles: true, cancelable: true,
    });
    editor.dispatchEvent(composingInput);
    expect(composingInput.defaultPrevented).toBe(false);
    expect(cell.querySelector(".structural-tables-cell-editor")).toBe(editor);
    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();

    editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "输入" }));
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await Promise.resolve();
    const next = parent.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor");
    expect(view.state.doc.toString()).toContain("输入");
    expect(next?.closest<HTMLElement>("[data-structural-column]")?.dataset.structuralColumn).toBe("1");

    expect(documentChanges).toBe(1);
    view.destroy();
  });
});
