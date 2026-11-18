// @vitest-environment happy-dom
import type { ExportTableImage } from "../src/app/table-image-modal";
import { EditorSelection, StateField, type Extension } from "@codemirror/state";
import { history, historyKeymap, redo, undo, undoDepth } from "@codemirror/commands";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { MarkdownRenderer, editorInfoField, type Editor } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "../src/config/i18n";
import type { StructuralTable } from "../src/core/model";
import { parseEditableTables } from "../src/core/parser";
import { calloutRanges } from "../src/core/source-lines";
import { TABLE_RANGE_CLIPBOARD_MIME, TABLE_RANGE_CLIPBOARD_WEB_MIME, TABLE_RANGE_HTML_ATTRIBUTE } from "../src/core/table-range-clipboard";
import { recoveredCellDrafts } from "../src/editor/cell-draft-recovery";
import { structuralTableSourceFocus } from "../src/editor/table-source-focus";
import { TableMenuOwner } from "../src/editor/table-menu-session";
import { activeScopes, dispatchScopeCaptureThenDom, editorInfoChanged, lastMenu, Menu, MenuItem, notices } from "./mocks/obsidian";
import { createPopoutFrame } from "./helpers/popout-frame";
import {
  NativeTableWidget,
  nativeTableForSource,
  SourceCalloutWidget,
  screenshotTable,
  mountEditor,
  draftInputEvent,
  typeDraftText,
  replaceDraftText,
  modEvent,
  dispatchDraftShortcut,
  gridClipboardEvent,
  clickCurrentMenuItem,
  dispatchOwnedGridKey,
  dispatchPointerDown,
} from "./helpers/live-preview-editor";

describe("Grid selection, handles and menus", () => {
  it("keeps a pending touch destination intact for modifier keys, Escape and an external-control shortcut", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | final-cell |\n\nAfter";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const host = parent.querySelector(".structural-tables-live-preview");
      const lines = view.contentDOM.querySelectorAll<HTMLElement>(".cm-line"); const line = lines[lines.length - 1]!;
      dispatchPointerDown(line, "touch"); line.dispatchEvent(new Event("pointerup", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20)); view.contentDOM.focus();
      for (const relatedTarget of [document.body, document.documentElement]) {
        view.contentDOM.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget }));
        view.contentDOM.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget }));
        expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
      }
      for (const options of [{ key: "Shift" }, { key: "Control", ctrlKey: true }, { key: "Alt", altKey: true }, { key: "Escape" }, { key: "p", ctrlKey: true }]) {
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { ...options, bubbles: true }));
        expect(parent.querySelector(".structural-tables-live-preview")).toBe(host);
      }
      view.dispatch({ selection: { anchor: source.length } }); await new Promise((resolve) => setTimeout(resolve, 20));
      expect(parent.querySelector(".structural-tables-live-preview")).toBe(host); expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["selection", "source", "rename", "file", "editor", "document"] as const)("defers pointer blur until the native source selection and rejects a changed context (%s)", async (change) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | final-cell |\n\nAfter";
    let writes = 0;
    const { app, parent, view } = mountEditor(source, { anchor: 0 }, [history(), EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; })]);
    const frame = createPopoutFrame();
    try {
      parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      parent.querySelector<HTMLTextAreaElement>("textarea")!.value = "changed-final";
      const line = [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")].slice(-1)[0]!;
      dispatchPointerDown(line, "mouse"); view.contentDOM.focus();
      expect(view.state.doc.toString()).toBe(source); expect(undoDepth(view.state)).toBe(0);
      const info = view.state.field(editorInfoField);
      let expected = source;
      if (change === "selection") view.dispatch({ selection: { anchor: source.length } });
      else if (change === "source") { expected = "External\n" + source; view.dispatch({ changes: { from: 0, insert: "External\n" } }); }
      else if (change === "rename") info.file!.path = "Other.md";
      else if (change === "file") Object.assign(info, { file: { ...info.file! } });
      else if (change === "editor") info.editor = Object.create(info.editor ?? null) as Editor;
      else frame.contentDocument!.body.append(parent);
      await Promise.resolve(); await Promise.resolve();
      if (change === "selection") {
        expect(view.state.doc.toString()).toContain("changed-final"); expect(view.state.selection.main.head).toBe(view.state.doc.length);
        expect(writes).toBe(1);
        expect(view.state.selection.main.empty).toBe(true); expect(undoDepth(view.state)).toBe(1);
        expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
      } else {
        expect(view.state.doc.toString()).toBe(expected); expect(undoDepth(view.state)).toBe(change === "source" ? 1 : 0);
        expect(writes).toBe(change === "source" ? 1 : 0);
        expect(recoveredCellDrafts(app).map((draft) => draft.text)).toContain("changed-final");
      }
    } finally { view.destroy(); frame.remove(); }
  });

  it.each(["focus-at-down", "focus-at-release", "cancel", "window-blur"] as const)("retains a held touch destination until release/cancel (%s)", async (end) => {
    const source = "Before\n\n| Region | Sales | < |\n| --- | --- | --- |\n| North | 10 | 12 |\n\n";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.focus();
      const host = parent.querySelector(".structural-tables-live-preview");
      const lines = view.contentDOM.querySelectorAll<HTMLElement>(".cm-line");
      const line = lines[lines.length - 1]!;
      dispatchPointerDown(line, "touch");
      if (end === "focus-at-down") view.contentDOM.focus();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(parent.querySelector(".structural-tables-live-preview") === host).toBe(true);
      const unrelated = new Event("pointerup", { bubbles: true });
      Object.defineProperty(unrelated, "pointerId", { value: 99 });
      line.dispatchEvent(unrelated);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(parent.querySelector(".structural-tables-live-preview") === host).toBe(true);
      if (end === "window-blur") window.dispatchEvent(new Event("blur"));
      else line.dispatchEvent(new Event(end === "cancel" ? "pointercancel" : "pointerup", { bubbles: true }));
      view.contentDOM.focus();
      if (end === "focus-at-down" || end === "focus-at-release") {
        expect(parent.querySelector(".structural-tables-live-preview") === host).toBe(true);
        view.dispatch({ selection: { anchor: source.length } });
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(parent.querySelector(".structural-tables-live-preview") === host).toBe(true);
      } else {
        expect(parent.querySelector(".structural-tables-live-preview")).toBeNull();
        expect(view.state.selection.main.anchor).toBe(source.indexOf("10"));
      }
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each([
    { axis: "column", pointerType: "mouse" },
    { axis: "column", pointerType: "touch" },
    { axis: "row", pointerType: "mouse" },
    { axis: "row", pointerType: "touch" },
  ] as const)("drags the full merge-expanded $axis selection with $pointerType", async ({ axis, pointerType }) => {
    const rows = axis === "column" ? [
      "| R | A | B | C | D | E |", "| --- || --- | --- | --- | --- | --- |",
      "| a | x | left | < | y | z |", "| b | u | v | right | < | w |",
    ] : [
      "| R | A | B |", "| --- || --- | --- |", "| a | upper | x |",
      "| b | ^ | lower |", "| c | y | ^ |", "| d | z | w |",
    ];
    const source = `Before\n\n${rows.join("\n")}\n\nEnd`;
    const original = parseEditableTables(source).tables[0]!;
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = original.columnCount * 80;
      const height = original.rows.length * 40;
      if (this.classList.contains("structural-tables-live-preview")) return rect(0, 0, width + 80, height + 60);
      if (this.tagName === "TABLE") return rect(40, 20, width, height);
      if (this.tagName === "TR") {
        return rect(40, 20 + [...this.closest("table")!.rows].indexOf(this as HTMLTableRowElement) * 40, width, 40);
      }
      if (this.dataset.structuralColumn !== undefined) return rect(
        40 + Number(this.dataset.structuralColumn) * 80, 20 + Number(this.dataset.structuralRow) * 40,
        Number(this.getAttribute("colspan") ?? 1) * 80, Number(this.getAttribute("rowspan") ?? 1) * 40,
      );
      return rect(0, 0, 0, 0);
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const clicked = axis === "column" ? 3 : 2;
    const expandedStart = axis === "column" ? 2 : 1;
    const selectedIndexes = () => [...parent.querySelectorAll<HTMLElement>(`.structural-tables-${axis}-handle.is-selected`)]
      .map((handle) => Number(handle.getAttribute(`data-structural-${axis}-handle`)));
    const handle = (index: number) => parent.querySelector<HTMLElement>(`[data-structural-${axis}-handle='${index}']`)!;
    const pointer = (type: string, boundary: number) => new PointerEvent(type, {
      pointerId: 1, isPrimary: true, button: 0, pointerType, bubbles: true, cancelable: true,
      clientX: axis === "column" ? 40 + boundary * 80 : 25,
      clientY: axis === "row" ? 20 + boundary * 40 : 10,
    });
    try {
      // One handle expands through two overlapping merges on different rows/columns.
      handle(clicked).dispatchEvent(pointer("pointerdown", clicked + 0.5));
      window.dispatchEvent(pointer("pointerup", clicked + 0.5));
      handle(clicked).click();
      expect(selectedIndexes()).toEqual([expandedStart, expandedStart + 1, expandedStart + 2]);
      expect(view.state.doc.toString()).toBe(source);
      if (pointerType === "mouse") {
        handle(expandedStart).dispatchEvent(new PointerEvent("pointerdown", {
          pointerId: 1, isPrimary: true, button: 0, pointerType, shiftKey: true, bubbles: true, cancelable: true,
        }));
        window.dispatchEvent(pointer("pointerup", expandedStart + 0.5));
        handle(expandedStart).click();
        expect(selectedIndexes()).toEqual([expandedStart, expandedStart + 1, expandedStart + 2]);
      }
      // Expanded handles must already be draggable; header boundaries must still be refused.
      handle(expandedStart).dispatchEvent(pointer("pointerdown", expandedStart + 0.5));
      window.dispatchEvent(pointer("pointermove", 0));
      expect(parent.querySelector<HTMLElement>(".structural-tables-drop-hint")!.textContent).toContain("header boundary");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(view.state.doc.toString()).toBe(source);
      handle(clicked).dispatchEvent(pointer("pointerdown", clicked + 0.5));
      const destination = axis === "column" ? 1 : original.rows.length;
      window.dispatchEvent(pointer("pointermove", destination));
      expect(parent.querySelector<HTMLElement>(".structural-tables-live-preview")!.dataset.reorderState).toBe("allowed");
      window.dispatchEvent(pointer("pointerup", destination));
      const movedStart = axis === "column" ? 1 : 2;
      await vi.waitFor(() => expect(selectedIndexes()).toEqual([movedStart, movedStart + 1, movedStart + 2]));
      const moved = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(moved.valid).toBe(true);
      if (axis === "column") {
        expect(moved.rows[0]!.cells.map((cell) => cell.content)).toEqual(["R", "B", "C", "D", "A", "E"]);
        expect(moved.rows[1]!.cells[1]).toMatchObject({ content: "left", columnSpan: 2 });
        expect(moved.rows[2]!.cells[2]).toMatchObject({ content: "right", columnSpan: 2 });
      } else {
        expect(moved.rows.map((row) => row.cells[0]!.content)).toEqual(["R", "d", "a", "b", "c"]);
        expect(moved.rows[2]!.cells[1]).toMatchObject({ content: "upper", rowSpan: 2 });
        expect(moved.rows[3]!.cells[2]).toMatchObject({ content: "lower", rowSpan: 2 });
      }
      const movedSource = view.state.doc.toString();
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(movedSource);
    } finally { view.destroy(); }
  });

  it("keeps consecutive fast row drags as two independent Undo steps", async () => {
    const source = ["Before", "", "| H | V |", "| --- || --- |", "| A | 1 |", "| B | 2 |", "| C | 3 |", "", "End"].join("\n");
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("structural-tables-live-preview")) return rect(0, 0, 340, 270);
      if (this.tagName === "TABLE") return rect(40, 20, 200, 200);
      if (this.tagName === "TR") return rect(40, 20 + [...this.closest("table")!.rows].indexOf(this as HTMLTableRowElement) * 40, 200, 40);
      if (this.dataset.structuralColumn !== undefined) return rect(40 + Number(this.dataset.structuralColumn) * 100,
        20 + Number(this.dataset.structuralRow) * 40, 100, 40);
      return rect(0, 0, 0, 0);
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const pointer = (type: string, y: number) => new PointerEvent(type, { pointerId: 5, isPrimary: true,
      button: 0, pointerType: "mouse", clientX: 25, clientY: y, bubbles: true, cancelable: true });
    const move = (from: number, to: number) => {
      const handle = parent.querySelector<HTMLElement>(`[data-structural-row-handle='${from}']`)!;
      handle.dispatchEvent(pointer("pointerdown", 20 + from * 40 + 20));
      window.dispatchEvent(pointer("pointermove", 20 + to * 40));
      window.dispatchEvent(pointer("pointerup", 20 + to * 40));
    };
    try {
      move(1, 5);
      await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[0]!.content).toBe("B"));
      const once = view.state.doc.toString();
      move(2, 1);
      await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[0]!.content).toBe("C"));
      const twice = view.state.doc.toString();
      expect(undoDepth(view.state)).toBe(2);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(once);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(once);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(twice);
    } finally { view.destroy(); }
  });

  it("isolates two immediate column drags as two independent Undo and Redo events", async () => {
    const source = ["Before", "", "| H0 | H1 | H2 | H3 |", "| --- || --- | --- | --- |",
      "| R1 | A | B | C |", "| R2 | D | E | F |", "", "End"].join("\n");
    const rect = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("structural-tables-live-preview")) return rect(0, 0, 490, 220);
      if (this.tagName === "TABLE") return rect(40, 20, 400, 120);
      if (this.tagName === "TR") return rect(40, 20 + [...this.closest("table")!.rows].indexOf(this as HTMLTableRowElement) * 40, 400, 40);
      if (this.dataset.structuralColumn !== undefined) return rect(40 + Number(this.dataset.structuralColumn) * 100,
        20 + Number(this.dataset.structuralRow) * 40, 100, 40);
      return rect(0, 0, 0, 0);
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const pointer = (type: string, x: number) => new PointerEvent(type, { pointerId: 8, isPrimary: true,
      button: 0, pointerType: "mouse", clientX: x, clientY: 10, bubbles: true, cancelable: true });
    const move = (from: number, boundary: number) => {
      const handle = parent.querySelector<HTMLElement>(`[data-structural-column-handle='${from}']`)!;
      handle.dispatchEvent(pointer("pointerdown", 40 + from * 100 + 50));
      window.dispatchEvent(pointer("pointermove", 40 + boundary * 100));
      window.dispatchEvent(pointer("pointerup", 40 + boundary * 100));
    };
    const headers = () => parseEditableTables(view.state.doc.toString()).tables[0]!.rows[0]!.cells.map((cell) => cell.content);
    try {
      move(1, 4);
      await vi.waitFor(() => expect(headers()).toEqual(["H0", "H2", "H3", "H1"]));
      const first = view.state.doc.toString();
      move(2, 1);
      await vi.waitFor(() => expect(headers()).toEqual(["H0", "H3", "H2", "H1"]));
      const second = view.state.doc.toString();
      expect(undoDepth(view.state)).toBe(2);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(first);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(first);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(second);
    } finally { view.destroy(); }
  });

  it.each(["row", "column"] as const)("keeps a selected %s handle range through right-click pointerdown", (axis) => {
    const source = "Before\n\n| H | V | W |\n| --- || --- | --- |\n| A | B | C |\n| D | E | F |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    const selector = (index: number) => parent.querySelector<HTMLElement>(
      `[data-structural-${axis}-handle='${index}']`,
    )!;
    const selected = () => parent.querySelectorAll(`.structural-tables-${axis}-handle.is-selected`).length;
    try {
      selector(1).click();
      selector(2).dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        pointerType: "mouse",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
      expect(selected()).toBe(2);

      selector(1).dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: 2,
        isPrimary: true,
        button: 2,
        pointerType: "mouse",
        bubbles: true,
        cancelable: true,
      }));
      expect(selected()).toBe(2);

      selector(1).dispatchEvent(new MouseEvent("contextmenu", {
        button: 2,
        bubbles: true,
        cancelable: true,
      }));
      expect(selected()).toBe(2);
    } finally {
      view.destroy();
    }
  });

  it("moves a two-tap handle range in one history transaction and keeps its handles selected", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n| C | D |\n| E | F |\n\nEnd";
    const rectangle = (left: number, top: number, width: number, height: number): DOMRect =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("structural-tables-live-preview")) return rectangle(0, 0, 300, 230);
      if (this.tagName === "TABLE") return rectangle(40, 20, 200, 160);
      if (this.tagName === "TR") {
        const index = [...this.closest("table")!.rows].indexOf(this as HTMLTableRowElement);
        return rectangle(40, 20 + index * 40, 200, 40);
      }
      if (this.dataset.structuralColumn !== undefined) return rectangle(40 + Number(this.dataset.structuralColumn) * 100,
        20 + Number(this.dataset.structuralRow) * 40, 100, 40);
      return rectangle(0, 0, 0, 0);
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const pointer = (type: string, y: number) => new PointerEvent(type,
      { pointerId: 1, isPrimary: true, button: 0, pointerType: "touch", clientX: 25, clientY: y, bubbles: true, cancelable: true });
    try {
      const first = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!;
      const second = parent.querySelector<HTMLElement>("[data-structural-row-handle='2']")!;
      first.dispatchEvent(pointer("pointerdown", 80));
      window.dispatchEvent(pointer("pointerup", 80));
      second.dispatchEvent(pointer("pointerdown", 120));
      window.dispatchEvent(pointer("pointerup", 120));
      expect(parent.querySelectorAll(".structural-tables-row-handle.is-selected")).toHaveLength(2);
      first.dispatchEvent(pointer("pointerdown", 80));
      window.dispatchEvent(pointer("pointermove", 180));
      window.dispatchEvent(pointer("pointerup", 180));
      await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[0]!.content).toBe("E"));
      await vi.waitFor(() => expect(parent.querySelectorAll(".structural-tables-row-handle.is-selected")).toHaveLength(2));
      expect((document.activeElement as HTMLElement).dataset.structuralRowHandle).toBe("2");
      Object.assign(view.state.field(editorInfoField).editor!, { undo: () => undo(view), redo: () => redo(view) });
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
      expect(view.state.doc.toString()).toBe(source);
      await Promise.resolve();
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[0]!.content).toBe("E");
    } finally { view.destroy(); }
  });

  it("cancels an armed axis drag when external content replaces its source", () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n| C | D |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    const pointer = (type: string, y: number) => new PointerEvent(type,
      { pointerId: 1, isPrimary: true, button: 0, pointerType: "mouse", clientX: 25, clientY: y, bubbles: true, cancelable: true });
    try {
      const handle = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!;
      handle.dispatchEvent(pointer("pointerdown", 80));
      window.dispatchEvent(pointer("pointerup", 80));
      handle.dispatchEvent(pointer("pointerdown", 80));
      const from = source.indexOf("| A") + 2;
      view.dispatch({ changes: { from, to: from + 1, insert: "Changed" } });
      const changed = view.state.doc.toString();
      window.dispatchEvent(pointer("pointermove", 200));
      window.dispatchEvent(pointer("pointerup", 200));
      expect(view.state.doc.toString()).toBe(changed);
      expect(parent.querySelector("[data-reorder-state]")).toBeNull();
    } finally { view.destroy(); }
  });

  it.each(["Delete", "Backspace"] as const)("clears a Callout grid selection with %s and restores through Undo", async (key) => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div");
      element.className = options.cls;
      return element;
    });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const markdown = args[1] as string;
      const container = args[2] as HTMLElement;
      if (container.className !== "structural-tables-container") return;
      const table = nativeTableForSource(markdown, container.ownerDocument);
      if (table !== null) container.replaceChildren(table);
    });
    const source = [
      "Before",
      "",
      "> [!note]",
      "> | H | V |",
      "> | --- || --- |",
      "> | A | 1 |",
      "> | B | 2 |",
      "",
      "End",
    ].join("\n");
    const nativeFor = (text: string) => Decoration.set([
      Decoration.replace({ widget: new SourceCalloutWidget(text), block: true })
        .range(text.indexOf("> [!note]"), text.indexOf("\n\nEnd")),
    ]);
    const native = StateField.define({
      create: (state) => nativeFor(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged ? nativeFor(transaction.newDoc.toString()) : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native, history()]);
    try {
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      const cell = parent.querySelector<HTMLElement>(
        ".callout [data-structural-row='1'][data-structural-column='1']",
      )!;
      dispatchPointerDown(cell, "mouse");
      const event = dispatchOwnedGridKey(cell, key);
      expect(event.defaultPrevented).toBe(true);
      await vi.waitFor(() => {
        expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[1]!.content).toBe("");
      });
      expect(view.state.doc.toString()).toContain("> [!note]");
      expect(view.state.doc.toString().split("\n").filter((line) => line.includes("|")).every((line) => line.startsWith("> "))).toBe(true);

      expect(undo(view)).toBe(true);
      await vi.waitFor(() => expect(view.state.doc.toString()).toBe(source));
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
    } finally {
      view.destroy();
    }
  });

  it("exports the exact owned Callout table through its real context menu", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, markdown, container) => {
      if (container.className !== "structural-tables-container") return;
      const table = nativeTableForSource(markdown, container.ownerDocument); if (table !== null) container.replaceChildren(table);
    });
    const source = "Before\n\n> [!note]\n> | H | V |\n> | --- || --- |\n> | A | 1 |\n\nEnd";
    const native = EditorView.decorations.of(Decoration.set([
      Decoration.replace({ widget: new SourceCalloutWidget(source), block: true }).range(source.indexOf("> [!note]"), source.indexOf("\n\nEnd")),
    ]));
    const exportImage = vi.fn<ExportTableImage>();
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native], undefined, { language: "en" }, exportImage);
    try {
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      const host = parent.querySelector<HTMLElement>(".callout .structural-tables-live-preview")!;
      host.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
      const action = lastMenu?.items.find((item) => item.title === "Export whole table as image…");
      expect(action).toBeDefined(); action!.callback!();
      expect(exportImage).toHaveBeenCalledOnce();
      const [table, path, isCurrent, context] = exportImage.mock.calls[0]!;
      expect(table).toEqual(parseEditableTables(source).tables[0]); expect(path).toBe("Test.md"); expect(isCurrent()).toBe(true);
      expect(context).toBe(host.querySelector("table")); expect(context?.closest(".callout")).not.toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each([
    ["clear", "Clear selected cells"],
    ["row", "Delete selected rows"],
    ["column", "Delete selected columns"],
    ["table", "Delete table"],
  ] as const)("applies Callout context-menu %s through exact source ownership", async (kind, title) => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div");
      element.className = options.cls;
      return element;
    });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const markdown = args[1] as string;
      const container = args[2] as HTMLElement;
      if (container.className !== "structural-tables-container") return;
      const table = nativeTableForSource(markdown, container.ownerDocument);
      if (table !== null) container.replaceChildren(table);
    });
    const source = [
      "Before",
      "",
      "> [!note]",
      "> | H | V |",
      "> | --- || --- |",
      "> | A | 1 |",
      "> | B | 2 |",
      "",
      "End",
    ].join("\n");
    const nativeFor = (text: string) => Decoration.set([
      Decoration.replace({ widget: new SourceCalloutWidget(text), block: true })
        .range(text.indexOf("> [!note]"), text.indexOf("\n\nEnd")),
    ]);
    const native = StateField.define({
      create: (state) => nativeFor(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged ? nativeFor(transaction.newDoc.toString()) : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native, history()]);
    try {
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      const host = parent.querySelector<HTMLElement>(".callout .structural-tables-live-preview")!;
      if (kind === "row") {
        host.querySelector<HTMLButtonElement>("[data-structural-row-handle='1']")!
          .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      } else if (kind === "column") {
        host.querySelector<HTMLButtonElement>("[data-structural-column-handle='1']")!
          .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      } else {
        host.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!
          .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      }
      const item = lastMenu?.items.find((candidate) => candidate.title === title);
      expect(item).toBeDefined();
      item?.callback?.();

      await vi.waitFor(() => {
        const tables = parseEditableTables(view.state.doc.toString()).tables;
        if (kind === "table") expect(tables).toHaveLength(0);
        else if (kind === "row") expect(tables[0]!.rows).toHaveLength(2);
        else if (kind === "column") expect(tables[0]!.columnCount).toBe(1);
        else expect(tables[0]!.rows[1]!.cells[1]!.content).toBe("");
      });
      expect(view.state.doc.toString()).toContain("> [!note]");
      expect(view.state.doc.toString()).toContain("Before\n\n");
      expect(view.state.doc.toString()).toContain("\n\nEnd");

      expect(undo(view)).toBe(true);
      await vi.waitFor(() => expect(view.state.doc.toString()).toBe(source));
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      if (kind === "table") {
        const restored = parent.querySelector<HTMLElement>(
          ".callout [data-structural-row='1'][data-structural-column='1']",
        )!;
        await vi.waitFor(() => expect(document.activeElement).toBe(restored));
        const f2 = new KeyboardEvent("keydown", { key: "F2", cancelable: true });
        expect(activeScopes[activeScopes.length - 1]!.handlers
          .find((handler) => handler.key === "F2")!.callback(f2)).toBe(false);
        expect(restored.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("1");
      }
    } finally {
      view.destroy();
    }
  });

  it.each(["CtrlY", "CtrlShiftZ"] as const)("keeps one Callout intact through first-table removal, Undo/F2 and %s Redo", async (shortcut) => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div");
      element.className = options.cls;
      return element;
    });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const container = args[2] as HTMLElement;
      if (container.className !== "structural-tables-container") return;
      const table = nativeTableForSource(args[1] as string, container.ownerDocument);
      if (table !== null) container.replaceChildren(table);
    });
    const tableText = "> | Region | Value |\n> | --- | --- |\n> | West | 10 |\n> | ^ | 20 |";
    const source = `Before\n\n> [!note] Focus\n> Before tables.\n>\n${tableText}\n>\n> Between tables.\n>\n${tableText}\n>\n> After tables.\n\nEnd`;
    const nativeFor = (text: string) => Decoration.set(calloutRanges(text).map((range) =>
      Decoration.replace({ widget: new SourceCalloutWidget(text.slice(range.from, range.to)), block: true })
        .range(range.from, range.to)));
    const native = StateField.define({
      create: (state) => nativeFor(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged ? nativeFor(transaction.newDoc.toString()) : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [native, history(), keymap.of(historyKeymap)]);
    Object.assign(view.state.field(editorInfoField).editor!, { undo: () => undo(view), redo: () => redo(view) });
    try {
      await vi.waitFor(() => expect(parent.querySelectorAll(".callout .structural-tables-live-preview")).toHaveLength(2));
      const [first, second] = parseEditableTables(source).tables;
      const removed = source.slice(0, first!.range.from) + "> " + source.slice(first!.range.to);
      const firstCell = parent.querySelector<HTMLElement>(".callout [data-structural-row='0'][data-structural-column='0']")!;
      firstCell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Delete table")?.callback?.();
      await vi.waitFor(() => expect(view.state.doc.toString()).toBe(removed));
      expect(calloutRanges(removed)).toHaveLength(1);
      expect(calloutRanges(removed)[0]!.to).toBe(removed.indexOf("\n\nEnd"));
      await vi.waitFor(() => expect(parent.querySelectorAll(".callout .structural-tables-live-preview")).toHaveLength(1));
      await vi.waitFor(() => expect(view.hasFocus).toBe(true));

      dispatchScopeCaptureThenDom(view.contentDOM, new KeyboardEvent("keydown", {
        key: "z", ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await vi.waitFor(() => expect(view.state.doc.toString()).toBe(source));
      await vi.waitFor(() => expect(parent.querySelectorAll(".callout .structural-tables-live-preview")).toHaveLength(2));
      const restoredHosts = parent.querySelectorAll<HTMLElement>(".callout .structural-tables-live-preview");
      const restored = restoredHosts[0]!.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      await vi.waitFor(() => expect(document.activeElement).toBe(restored));
      dispatchScopeCaptureThenDom(restored, new KeyboardEvent("keydown", {
        key: "F2", bubbles: true, cancelable: true,
      }));
      const draft = restored.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(draft?.value).toBe("Region");
      expect(restoredHosts[1]!.querySelector("textarea")).toBeNull();
      dispatchScopeCaptureThenDom(draft, new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();
      dispatchScopeCaptureThenDom(document.activeElement as HTMLElement, new KeyboardEvent("keydown", {
        key: shortcut === "CtrlY" ? "y" : "z", ctrlKey: true, shiftKey: shortcut === "CtrlShiftZ",
        bubbles: true, cancelable: true,
      }));
      await vi.waitFor(() => expect(view.state.doc.toString()).toBe(removed));
      await vi.waitFor(() => expect(parent.querySelectorAll(".callout .structural-tables-live-preview")).toHaveLength(1));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const remaining = parseEditableTables(view.state.doc.toString()).tables;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.source).toBe(second!.source);
      expect(calloutRanges(view.state.doc.toString())[0]!.to).toBe(removed.indexOf("\n\nEnd"));
      expect(view.hasFocus).toBe(true);
      // The host block widget may place native focus at a Callout boundary.
      expect(view.state.selection.main.anchor).toBeGreaterThanOrEqual(first!.range.from);
      expect(view.state.selection.main.anchor).toBeLessThanOrEqual(removed.indexOf("\n\nEnd") + 1);
      expect(parent.querySelector(".structural-tables-live-preview")!.contains(document.activeElement)).toBe(false);
      dispatchScopeCaptureThenDom(document.activeElement as HTMLElement, new KeyboardEvent("keydown", {
        key: "F2", bubbles: true, cancelable: true,
      }));
      expect(parent.querySelector("textarea")).toBeNull();
      expect(view.state.doc.toString()).toBe(removed);
    } finally {
      view.destroy();
    }
  });

  it.each([
    ["single", "Delete"],
    ["partial", "Backspace"],
    ["row", "Delete"],
    ["column", "Backspace"],
    ["all", "Delete"],
  ] as const)("clears %s owned-grid selection with unmodified %s while preserving structure", async (mode, key) => {
    const source = [
      "| H1 | H2 | < |",
      "| --- || :---: | ---: |",
      "| R1 | A | B |",
      "| R2 | C | D |",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const cell = (row: number, column: number) => parent.querySelector<HTMLElement>(
        `[data-structural-row='${row}'][data-structural-column='${column}']`,
      )!;
      if (mode === "single") {
        dispatchPointerDown(cell(1, 1), "mouse");
      } else if (mode === "partial") {
        dispatchPointerDown(cell(1, 1), "mouse");
        cell(1, 2).dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      } else if (mode === "row") {
        const handle = parent.querySelector<HTMLButtonElement>("[data-structural-row-handle='1']")!;
        handle.focus();
        handle.click();
      } else if (mode === "column") {
        const handle = parent.querySelector<HTMLButtonElement>("[data-structural-column-handle='0']")!;
        handle.focus();
        handle.click();
      } else {
        dispatchPointerDown(cell(0, 0), "mouse");
        cell(2, 2).dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      }
      const active = document.activeElement as HTMLElement;
      const event = dispatchOwnedGridKey(active, key);
      expect(event.defaultPrevented).toBe(true);

      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table).toMatchObject({
        valid: true,
        columnCount: 3,
        headerRowCount: 1,
        rowHeaderColumnCount: 1,
      });
      expect(table.alignments).toEqual(["default", "center", "right"]);
      expect(table.rows[0]!.cells[2]!.marker).toBe("left");

      if (mode === "single") {
        expect(table.rows[1]!.cells.map((item) => item.content)).toEqual(["R1", "", "B"]);
      } else if (mode === "partial") {
        expect(table.rows[1]!.cells.map((item) => item.content)).toEqual(["R1", "", ""]);
      } else if (mode === "row") {
        expect(table.rows[1]!.cells.filter((item) => !item.covered).every((item) => item.content === "")).toBe(true);
      } else if (mode === "column") {
        expect(table.rows.map((row) => row.cells[0]!.content)).toEqual(["", "", ""]);
      } else {
        expect(table.rows.every((row) => row.cells.filter((item) => !item.covered).every((item) => item.content === ""))).toBe(true);
      }
      expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("runs Scope capture and DOM fallback through one clear handler without duplicate writes", () => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => {
      if (update.docChanged) writes += 1;
    });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    try {
      const select = () => {
        const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
        dispatchPointerDown(cell, "mouse");
        return cell;
      };
      const first = select();
      const captured = dispatchOwnedGridKey(first, "Delete", true);
      expect(captured.defaultPrevented).toBe(true);
      expect(writes).toBe(1);

      expect(undo(view)).toBe(true);
      const second = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(second, "mouse");
      const bubbled = dispatchOwnedGridKey(second, "Backspace", false);
      expect(bubbled.defaultPrevented).toBe(true);
      expect(writes).toBe(3);
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[1]!.content).toBe("");
    } finally {
      view.destroy();
    }
  });

  it("does not turn textarea Delete or Backspace into a grid operation", () => {
    const source = "| H | V |\n| --- || --- |\n| A | West |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(1, 3);
      for (const key of ["Delete", "Backspace"] as const) {
        const keyEvent = dispatchOwnedGridKey(editor, key);
        expect(keyEvent.defaultPrevented).toBe(false);
      }
      const before = draftInputEvent("beforeinput", "deleteContentBackward", null);
      expect(editor.dispatchEvent(before)).toBe(true);
      editor.setRangeText("", editor.selectionStart, editor.selectionEnd, "end");
      editor.dispatchEvent(draftInputEvent("input", "deleteContentBackward", null));
      expect(editor.value).toBe("Wt");
      expect(view.state.doc.toString()).toBe(source);
      dispatchDraftShortcut(editor, "z");
      expect(editor.value).toBe("West");
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("keeps an empty clear byte-stable and adds no extra history entry", () => {
    const source = "| H | V |\n| --- || --- |\n| A |  |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(cell, "mouse");
      const event = dispatchOwnedGridKey(cell, "Delete");
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
    } finally {
      view.destroy();
    }
  });

  it.each([
    ["clear", "Clear selected cells"],
    ["row", "Delete selected rows"],
    ["column", "Delete selected columns"],
  ] as const)("applies the explicit %s context-menu intent to non-empty owned content", async (kind, title) => {
    const source = [
      "| H | V | W |",
      "| --- || --- | --- |",
      "| A | 1 | 2 |",
      "| B | 3 | 4 |",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      if (kind === "row") {
        const handle = parent.querySelector<HTMLButtonElement>("[data-structural-row-handle='1']")!;
        handle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      } else if (kind === "column") {
        const handle = parent.querySelector<HTMLButtonElement>("[data-structural-column-handle='1']")!;
        handle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      } else {
        const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
        cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      }
      const item = lastMenu?.items.find((candidate) => candidate.title === title);
      expect(item).toBeDefined();
      item?.callback?.();
      await Promise.resolve();

      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      if (kind === "clear") {
        expect(table.rows).toHaveLength(3);
        expect(table.columnCount).toBe(3);
        expect(table.rows[1]!.cells[1]!.content).toBe("");
        await vi.waitFor(() => expect(
          document.activeElement?.closest("[data-structural-row='1'][data-structural-column='1']"),
        ).not.toBeNull());
      } else if (kind === "row") {
        expect(table.rows).toHaveLength(2);
        expect(table.rows[1]!.cells.map((cell) => cell.content)).toEqual(["B", "3", "4"]);
        await vi.waitFor(() => expect(
          (document.activeElement as HTMLElement | null)?.dataset.structuralRowHandle,
        ).toBe("1"));
      } else {
        expect(table.columnCount).toBe(2);
        expect(table.rows[1]!.cells.map((cell) => cell.content)).toEqual(["A", "2"]);
        await vi.waitFor(() => expect(
          (document.activeElement as HTMLElement | null)?.dataset.structuralColumnHandle,
        ).toBe("1"));
      }
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("removes exactly the selected table and restores it through host Undo/Redo", async () => {
    const tableText = "| H | V |\n| --- || --- |\n| A | 1 |";
    const source = `Before\n\n${tableText}\n\nBetween\n\n${tableText}\n\nAfter`;
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const tablesBefore = parseEditableTables(source).tables;
      const first = tablesBefore[0]!;
      const expectedRemoved = source.slice(0, first.range.from) + source.slice(first.range.to);
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      expect(hosts).toHaveLength(2);
      const firstCell = hosts[0]!.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      firstCell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const remove = lastMenu?.items.find((candidate) => candidate.title === "Delete table");
      expect(remove).toBeDefined();
      remove?.callback?.();
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(expectedRemoved);
      expect(parseEditableTables(view.state.doc.toString()).tables).toHaveLength(1);
      expect(view.state.doc.toString()).toContain("Before\n\n");
      expect(view.state.doc.toString()).toContain("\n\nBetween\n\n");
      expect(view.state.doc.toString()).toContain(`${tableText}\n\nAfter`);

      expect(undo(view)).toBe(true);
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe(source);
      const restoredTables = parseEditableTables(view.state.doc.toString()).tables;
      expect(restoredTables).toHaveLength(2);
      await vi.waitFor(() => expect(parent.querySelectorAll(".structural-tables-live-preview")).toHaveLength(2));
      const restoredHosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      const restoredFirst = restoredHosts[0]!;
      const restoredSecond = restoredHosts[1]!;
      const restoredCell = restoredFirst.querySelector<HTMLElement>(
        "[data-structural-row='1'][data-structural-column='0']",
      )!;
      await vi.waitFor(() => expect(document.activeElement).toBe(restoredCell));
      expect(restoredSecond.contains(document.activeElement)).toBe(false);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(restoredCell.isConnected).toBe(true);
      expect(document.activeElement).toBe(restoredCell);
      expect(restoredFirst.querySelector("textarea")).toBeNull();
      expect(restoredSecond.querySelector("textarea")).toBeNull();
      const f2 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
      dispatchScopeCaptureThenDom(restoredCell, f2);
      expect(f2.defaultPrevented).toBe(true);
      const draft = restoredCell.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(draft?.value).toBe("A");
      expect(restoredSecond.querySelector("textarea")).toBeNull();
      dispatchScopeCaptureThenDom(draft, new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe(source);

      expect(redo(view)).toBe(true);
      await vi.waitFor(() => expect(view.state.doc.toString()).toBe(expectedRemoved));
      const remaining = parseEditableTables(view.state.doc.toString()).tables;
      expect(remaining).toHaveLength(1);
      await vi.waitFor(() => expect(view.hasFocus).toBe(true));
      expect(view.state.selection.main.anchor).toBe(first.range.from);
      expect(view.state.selection.main.anchor).toBeLessThan(remaining[0]!.range.from);
    } finally {
      view.destroy();
    }
  });

  it("restores an ordinary table as owned after Undo while takeover remains enabled", async () => {
    const source = "Before\n\n| H | V |\n| --- | --- |\n| A | 1 |\n\nEnd";
    const { parent, view } = mountEditor(
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

      expect(undo(view)).toBe(true);
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull());
      const restored = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      await vi.waitFor(() => expect(document.activeElement).toBe(restored));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(restored.isConnected).toBe(true);
      expect(document.activeElement).toBe(restored);
      expect(parent.querySelector("textarea")).toBeNull();
      const f2 = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
      dispatchScopeCaptureThenDom(restored, f2);
      expect(f2.defaultPrevented).toBe(true);
      const draft = restored.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(draft?.value).toBe("A");
      dispatchScopeCaptureThenDom(draft, new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      await vi.waitFor(() => expect(parseEditableTables(view.state.doc.toString()).tables).toHaveLength(0));
      await vi.waitFor(() => expect(view.hasFocus).toBe(true));
      expect(view.state.selection.main.anchor).toBe(source.indexOf("| H | V |"));
    } finally {
      view.destroy();
    }
  });

  it.each(["CtrlY", "CtrlShiftZ"] as const)("keeps %s whole-table Redo on native source instead of a remaining identical table", async (shortcut) => {
    const tableText = "| Region | Value |\n| --- | --- |\n| West | 10 |\n| ^ | 20 |";
    const source = `Before\n\n${tableText}\n\nBetween\n\n${tableText}\n\nAfter`;
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), keymap.of(historyKeymap)]);
    Object.assign(view.state.field(editorInfoField).editor!, { undo: () => undo(view), redo: () => redo(view) });
    try {
      const first = parseEditableTables(source).tables[0]!;
      const removed = source.slice(0, first.range.from) + source.slice(first.range.to);
      parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Delete table")?.callback?.();
      await vi.waitFor(() => expect(view.hasFocus).toBe(true));
      expect(view.state.doc.toString()).toBe(removed);

      dispatchScopeCaptureThenDom(view.contentDOM, new KeyboardEvent("keydown", {
        key: "z", ctrlKey: true, bubbles: true, cancelable: true,
      }));
      await vi.waitFor(() => expect(view.state.doc.toString()).toBe(source));
      const restored = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      await vi.waitFor(() => expect(document.activeElement).toBe(restored));
      dispatchScopeCaptureThenDom(restored, new KeyboardEvent("keydown", {
        key: "F2", bubbles: true, cancelable: true,
      }));
      const draft = restored.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(draft?.value).toBe("Region");
      dispatchScopeCaptureThenDom(draft, new KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      }));
      await Promise.resolve();
      const active = document.activeElement as HTMLElement;
      const event = new KeyboardEvent("keydown", {
        key: shortcut === "CtrlY" ? "y" : "z",
        ctrlKey: true, shiftKey: shortcut === "CtrlShiftZ", bubbles: true, cancelable: true,
      });
      dispatchScopeCaptureThenDom(active, event);
      expect(event.defaultPrevented).toBe(true);
      await vi.waitFor(() => expect(view.state.doc.toString()).toBe(removed));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const remainingHost = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      expect(view.hasFocus).toBe(true);
      expect(view.state.selection.main.anchor).toBe(first.range.from);
      expect(remainingHost.contains(document.activeElement)).toBe(false);
      dispatchScopeCaptureThenDom(document.activeElement as HTMLElement, new KeyboardEvent("keydown", {
        key: "F2", bubbles: true, cancelable: true,
      }));
      expect(parent.querySelector("textarea")).toBeNull();
      expect(view.state.doc.toString()).toBe(removed);
    } finally {
      view.destroy();
    }
  });

  it("keeps whole-grid clear selection on the exact first table while CodeMirror rebinds its identical neighbor", async () => {
    const tableText = "| Region | Value |\n| --- | --- |\n| West | 10 |\n| ^ | 20 |";
    const source = `Before\n\n${tableText}\n\nBetween\n\n${tableText}\n\nAfter`;
    const nativeTables = (text: string) => Decoration.set(parseEditableTables(text).tables.map((table) =>
      Decoration.replace({ widget: new NativeTableWidget(), block: true }).range(table.range.from, table.range.to)));
    const native = StateField.define({
      create: (state) => nativeTables(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged ? nativeTables(transaction.newDoc.toString()) : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), native]);
    try {
      const firstHost = parent.querySelector<HTMLElement>(".structural-tables-live-preview")!;
      const secondHost = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview")[1]!;
      const secondFrom = parseEditableTables(source).tables[1]!.range.from;
      const firstCell = firstHost.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
      dispatchPointerDown(firstCell, "mouse");
      firstHost.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!
        .dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      const event = dispatchOwnedGridKey(firstCell, "Delete");
      expect(event.defaultPrevented).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      const tables = parseEditableTables(view.state.doc.toString()).tables;
      expect(tables).toHaveLength(2);
      expect(tables[0]).toMatchObject({ valid: true, columnCount: 2, headerRowCount: 1 });
      expect(tables[0]!.rows).toHaveLength(3);
      expect(tables[0]!.rows[2]!.cells[0]!.marker).toBe("up");
      expect(tables[0]!.rows.every((row) => row.cells.filter((cell) => !cell.covered).every((cell) => cell.content === ""))).toBe(true);
      expect(tables[1]!.source).toBe(tableText);
      expect(view.state.doc.toString()).toContain("Before\n\n");
      expect(view.state.doc.toString()).toContain("\n\nBetween\n\n");
      expect(view.state.doc.toString()).toContain(`${tableText}\n\nAfter`);
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      expect(hosts[1]).toBe(secondHost);
      expect(tables[1]!.range.from).not.toBe(secondFrom);
      expect(hosts[0]!.querySelectorAll("[aria-selected='true']")).toHaveLength(5);
      expect(hosts[1]!.querySelectorAll("[aria-selected='true']")).toHaveLength(0);
      expect(hosts[0]!.contains(document.activeElement)).toBe(true);
      expect(hosts[1]!.contains(document.activeElement)).toBe(false);
      dispatchScopeCaptureThenDom(document.activeElement as HTMLElement, new KeyboardEvent("keydown", {
        key: "F2", bubbles: true, cancelable: true,
      }));
      expect(hosts[0]!.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("");
      expect(hosts[1]!.querySelector("textarea")).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("owns Delete on hidden-overflow takeover and refuses before any parent source command", () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 | KEEP |";
    const { app, parent, view } = mountEditor(
      source,
      { anchor: source.length },
      [history()],
      undefined,
      { takeOverOrdinaryTables: true },
    );
    const parentDelete = vi.fn(() => {
      view.dispatch({ changes: { from: 0, to: 1, insert: "" } });
      return false;
    });
    app.scope.register([], "Delete", parentDelete);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      dispatchPointerDown(cell, "mouse");
      const event = dispatchOwnedGridKey(cell, "Delete");
      expect(event.defaultPrevented).toBe(true);
      expect(parentDelete).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
      expect(notices[notices.length - 1]).toContain("extra source cells");

      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu?.items.find((item) => item.title === "Clear selected cells")?.callback?.();
      expect(view.state.doc.toString()).toBe(source);
    } finally {
      view.destroy();
    }
  });

  it("revalidates the exact table after a menu opens and preserves a newer external source change", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const clear = lastMenu?.items.find((item) => item.title === "Clear selected cells");
      expect(clear).toBeDefined();

      const position = view.state.doc.toString().indexOf("| A | B |") + "| A | ".length;
      view.dispatch({ changes: { from: position, to: position + 1, insert: "External" } });
      const externallyChanged = view.state.doc.toString();
      clear?.callback?.();
      await Promise.resolve();

      expect(view.state.doc.toString()).toBe(externallyChanged);
      expect(view.state.doc.toString()).toContain("External");
      expect(notices[notices.length - 1]).toContain("changed");
    } finally {
      view.destroy();
    }
  });

  it("ignores owned-grid Delete while its context menu is open", () => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(cell, "mouse");
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const event = dispatchOwnedGridKey(cell, "Delete", false);
      expect(event.defaultPrevented).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      lastMenu?.hide();
    } finally {
      view.destroy();
    }
  });

  it("owns Escape before the host keymap and releases the cell scope on cancel and destroy", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
    editor.value = "Cancelled draft";
    expect(activeScopes).toHaveLength(1);
    const escape = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    expect(activeScopes[0]!.handlers.find((handler) => handler.key === "Escape")!.callback(escape)).toBe(false);
    expect(escape.defaultPrevented).toBe(true);
    expect(activeScopes).toHaveLength(1);
    expect(activeScopes[0]!.handlers.some((handler) => handler.key === "F2")).toBe(true);
    expect(view.state.doc.toString()).toBe(screenshotTable);
    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
    cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    view.destroy();
    expect(activeScopes).toHaveLength(0);
  });

  it.each([
    ["ctrl", "b", "**"],
    ["meta", "b", "**"],
    ["ctrl", "i", "*"],
    ["meta", "i", "*"],
  ] as const)("owns %s Mod+%s in Scope capture before textarea bubbling",
    (platform, key, marker) => {
      const source = "Before\n\n| Region | Value |\n| --- || --- |\n| East | West |\n\nEnd";
      const { app, parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
      const saved = source.indexOf("West");
      const inherited = vi.fn((event: KeyboardEvent) => {
        event.preventDefault();
        view.dispatch({ changes: { from: saved, to: saved + 4, insert: "**West**" } });
        return false;
      });
      app.scope.register(["Mod"], key, inherited);
      try {
        const cell = parent.querySelector<HTMLElement>(
          "[data-structural-row='1'][data-structural-column='1']",
        )!;
        cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
        replaceDraftText(editor, "West draft");
        editor.select();
        const bubbled = vi.fn();
        editor.addEventListener("keydown", bubbled);

        const event = dispatchDraftShortcut(editor, key, platform);

        expect(inherited).not.toHaveBeenCalled();
        expect(bubbled).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
        expect(editor.isConnected).toBe(true);
        expect(document.activeElement).toBe(editor);
        expect(editor.value).toBe(`${marker}West draft${marker}`);
        expect(editor.selectionStart).toBe(marker.length);
        expect(editor.selectionEnd).toBe(marker.length + "West draft".length);
        expect(view.state.doc.toString()).toBe(source);
      } finally {
        view.destroy();
      }
    });

  it.each([false, true])("clears the frozen merged menu owner after document pointerdown (hide first=%s)", async (hideBeforeCallback) => {
    const table = "| H1 | H2 | H3 |\n| --- || --- | --- |\n| Region | West | < |";
    const source = `Before\n\n${table}\n\nBetween\n\n${table}\n\nAfter`;
    let writes = 0;
    const listener = EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; });
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), listener]);
    try {
      const west = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      dispatchPointerDown(west, "mouse");
      west.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem("Clear selected cells", hideBeforeCallback);
      await vi.waitFor(() => {
        const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
        expect(table.rows[1]!.cells[0]!.content).toBe("Region");
        expect(table.rows[1]!.cells[1]!.content).toBe("");
        expect(table.rows[1]!.cells[2]!.marker).toBe("left");
        expect(parseEditableTables(view.state.doc.toString()).tables[1]!.source).toBe(
          parseEditableTables(source).tables[1]!.source,
        );
      });
      const restored = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      await vi.waitFor(() => expect(document.activeElement).toBe(restored));
      expect(writes).toBe(1);
      const cleared = view.state.doc.toString();
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(cleared);
    } finally { view.destroy(); }
  });

  it("cancels a dismissed menu after an unrelated document pointerdown", async () => {
    const source = "| H | V |\n| --- || --- |\n| A | B |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      dispatchPointerDown(cell, "mouse");
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const callback = lastMenu?.items.find((item) => item.title === "Clear selected cells")?.callback;
      const outside = document.body.appendChild(document.createElement("button"));
      dispatchPointerDown(outside, "mouse");
      outside.focus();
      lastMenu?.hide();
      await Promise.resolve();
      callback?.();
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(0);
      expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
    } finally { view.destroy(); }
  });

  it.each([false, true])("groups an owned menu by action scope, retaining whole-table export (ordinary=%s)", (ordinary) => {
    const table = `| Region | Value |\n| --- ${ordinary ? "|" : "||"} :---: |\n| West | 2 |`;
    const source = `Before\n\n${table}\n\nBetween\n\n${table}\n\nAfter`;
    const exportImage = vi.fn<ExportTableImage>();
    const { parent, view } = mountEditor(source, { anchor: source.length }, [], vi.fn(), {
      language: "en", takeOverOrdinaryTables: ordinary,
    }, exportImage);
    try {
      const header = parent.querySelector<HTMLElement>("[data-structural-row-handle='0']")!;
      header.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const items = lastMenu!.items;
      expect(items.filter((item, index) => item.section !== items[index - 1]?.section).map((item) => item.section)).toEqual([
        "structural-tables-clipboard",
        "structural-tables",
        "structural-tables-row",
        "structural-tables-column",
        "structural-tables-transform",
        "structural-tables-output",
        "structural-tables-source",
        "structural-tables-clear",
        "structural-tables-danger",
      ]);
      expect(items.filter((item) => item.section === "structural-tables-output").map((item) => item.title))
        .toEqual(["Copy whole table for Word / HTML", "Export whole table as image…"]);
      expect(items.filter((item) => item.section === "structural-tables-source")).toHaveLength(2);
      for (const [section, title] of [
        ["structural-tables-row", "Delete selected rows"],
        ["structural-tables-column", "Delete selected columns"],
        ["structural-tables-danger", "Delete table"],
      ]) {
        const group = items.filter((item) => item.section === section);
        expect(group[group.length - 1]).toMatchObject({ title, warning: true });
      }
      expect(items[items.length - 1]?.title).toBe("Delete table");
      expect(items.some((item) => item.title === "Set first 1 rows as column headers")).toBe(false);
      expect(items.some((item) => item.title === "Remove column headers")).toBe(true);
      expect(view.state.doc.toString()).toBe(source);

      clickCurrentMenuItem("Export whole table as image…", true);
      expect(exportImage).toHaveBeenCalledOnce();
      const [snapshot, sourcePath, isCurrent, context] = exportImage.mock.calls[0]!;
      expect(snapshot).toEqual(parseEditableTables(source).tables[0]);
      expect(sourcePath).toBe("Test.md");
      expect(isCurrent()).toBe(true);
      expect(context).toBe(parent.querySelector(".structural-tables-table"));
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("provides row and column handles with the full structural-table menu", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const rows = parent.querySelectorAll<HTMLElement>("[data-structural-row-handle]");
    const columns = parent.querySelectorAll<HTMLElement>("[data-structural-column-handle]");
    expect(rows).toHaveLength(5);
    expect(columns).toHaveLength(5);
    for (const handle of [...rows, ...columns]) {
      const decoration = handle.querySelector(".structural-tables-handle-icon")!;
      const icon = decoration.querySelector("svg")!;
      expect(decoration.getAttribute("aria-hidden")).toBe("true");
      expect(icon.ownerDocument).toBe(handle.ownerDocument);
      expect(icon.getAttribute("focusable")).toBe("false");
      expect(icon.getAttribute("tabindex")).toBe("-1");
      expect(handle.querySelectorAll("button")).toHaveLength(0);
      expect(handle.getAttribute("aria-label")).toMatch(/(?:row|column) \d+/iu);
    }

    rows[2]?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(rows[2]?.classList.contains("is-selected")).toBe(true);
    expect(Array.from(rows).filter((handle) => handle.classList.contains("is-selected"))).toEqual([rows[2]]);
    expect(Array.from(columns).some((handle) => handle.classList.contains("is-selected"))).toBe(false);
    expect(lastMenu?.items.map((item) => item.title)).toContain("Insert row above");
    expect(lastMenu?.items.map((item) => item.title)).toContain("Delete selected rows");

    columns[1]?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(Array.from(columns).filter((handle) => handle.classList.contains("is-selected"))).toEqual([columns[1]]);
    expect(Array.from(rows).some((handle) => handle.classList.contains("is-selected"))).toBe(false);

    view.destroy();
  });

  it("keeps handle touches out of host swipe gestures while allowing cell scrolling and handle menus", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const swipe = vi.fn();
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) parent.addEventListener(type, swipe);
    const handle = parent.querySelector<HTMLElement>("[data-structural-column-handle='1']")!;
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      const touch = new Event(type, { bubbles: true, cancelable: true });
      handle.dispatchEvent(touch);
      expect(touch.defaultPrevented).toBe(false);
    }
    expect(swipe).not.toHaveBeenCalled();
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new Event("touchmove", { bubbles: true, cancelable: true }));
    expect(swipe).toHaveBeenCalledOnce();
    handle.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(lastMenu?.items.length).toBeGreaterThan(0);
    view.destroy();
  });

  it("reveals only the row and column handles corresponding to the hovered cell", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
    const move = new Event("pointermove", { bubbles: true });
    Object.defineProperties(move, {
      pointerType: { value: "mouse" },
      clientX: { value: 0 },
      clientY: { value: 0 },
    });
    cell.dispatchEvent(move);

    const rows = Array.from(parent.querySelectorAll<HTMLElement>(".structural-tables-row-handle.is-revealed"));
    const columns = Array.from(parent.querySelectorAll<HTMLElement>(".structural-tables-column-handle.is-revealed"));
    expect(rows.map((handle) => handle.dataset.structuralRowHandle)).toEqual(["2"]);
    expect(columns.map((handle) => handle.dataset.structuralColumnHandle)).toEqual(["1"]);

    parent.querySelector<HTMLElement>(".structural-tables-live-preview")
      ?.dispatchEvent(new Event("pointerleave"));
    expect(parent.querySelector(".is-revealed")).toBeNull();
    view.destroy();
  });

  it("positions overlaid handles from the actual centered table rectangle", () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
      if (this.classList.contains("structural-tables-live-preview")) {
        return { left: 20, right: 520, top: 10, bottom: 310, width: 500, height: 300, x: 20, y: 10, toJSON: () => ({}) };
      }
      if (this.classList.contains("structural-tables-table")) {
        return { left: 170, right: 370, top: 50, bottom: 250, width: 200, height: 200, x: 170, y: 50, toJSON: () => ({}) };
      }
      return originalRect.call(this);
    };
    try {
      const { parent, view } = mountEditor(
        screenshotTable,
        { anchor: screenshotTable.length },
        [],
        undefined,
        { layout: "content-center" },
      );
      const row = parent.querySelector<HTMLElement>(".structural-tables-row-handle")!;
      const column = parent.querySelector<HTMLElement>(".structural-tables-column-handle")!;
      expect(row.style.getPropertyValue("inset-inline-start")).toBe("calc(150px - var(--structural-table-handle-gutter))");
      expect(column.style.getPropertyValue("inset-block-start")).toBe("40px");
      expect(column.style.left).toBe("170px");
      view.destroy();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
    }
  });

  it("does not select every handle when a structural cell is selected", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

    expect(parent.querySelector(".structural-tables-row-handle.is-selected")).toBeNull();
    expect(parent.querySelector(".structural-tables-column-handle.is-selected")).toBeNull();
    view.destroy();
  });

  it.each([200, 2_000])("preserves a touch rectangle through a subsequent long press after %ims", (delay) => {
    const source = "| A | B |\n| --- || --- |\n| C | D |\n| E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const first = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
    const last = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;

    const firstTap = dispatchPointerDown(first, "touch", 1_000);
    first.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(firstTap.defaultPrevented).toBe(false);
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.querySelector(".structural-tables-cell-editor")).toBeNull();

    const secondTap = dispatchPointerDown(last, "touch", 2_000);
    last.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(secondTap.defaultPrevented).toBe(false);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);

    const longPress = dispatchPointerDown(last, "touch", 2_000 + delay);
    expect(longPress.defaultPrevented).toBe(false);
    expect(parent.querySelector("textarea")).toBeNull();
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
    last.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(lastMenu?.items.map((item) => item.title)).toContain("Merge selected cells");
    view.destroy();
  });

  it("starts a new touch range outside a completed rectangle and allows double-tap editing inside it", () => {
    const source = "| A | B |\n| --- || --- |\n| C | D |\n| E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const cell = (row: number, column: number) => parent.querySelector<HTMLElement>(
      `[data-structural-row='${row}'][data-structural-column='${column}']`,
    )!;
    dispatchPointerDown(cell(1, 0), "touch", 1_000);
    dispatchPointerDown(cell(2, 1), "touch", 2_000);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);

    dispatchPointerDown(cell(0, 0), "touch", 3_000);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(1);
    dispatchPointerDown(cell(1, 1), "touch", 4_000);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);

    dispatchPointerDown(cell(1, 0), "touch", 5_000);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
    dispatchPointerDown(cell(1, 0), "touch", 5_300);
    expect(cell(1, 0).querySelector("textarea")).not.toBeNull();
    view.destroy();
  });

  it.each(["cancel", "blur"])("requires a fresh double tap after a touch gesture ends with %s", (ending) => {
    const source = "| A | B |\n| --- || --- |\n| C | D |\n| E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      const tap = (id: number, at: number) => {
        const event = new PointerEvent("pointerdown", { pointerType: "touch", pointerId: id, isPrimary: true, button: 0, bubbles: true, cancelable: true });
        Object.defineProperty(event, "timeStamp", { value: at }); cell.dispatchEvent(event); return event;
      };
      tap(7, 1_000);
      window.dispatchEvent(ending === "cancel" ? new PointerEvent("pointercancel", { pointerId: 7 }) : new Event("blur"));
      expect(tap(8, 1_200).defaultPrevented).toBe(false);
      expect(cell.querySelector("textarea")).toBeNull();
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 8 }));
      expect(tap(9, 1_400).defaultPrevented).toBe(true);
      expect(cell.querySelector("textarea")).not.toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("ignores another pointer's cancellation and preserves a completed touch range for long press", () => {
    const source = "| A | B |\n| --- || --- |\n| C | D |\n| E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = (row: number, column: number) => parent.querySelector<HTMLElement>(`[data-structural-row='${row}'][data-structural-column='${column}']`)!;
      const tap = (target: HTMLElement, id: number, at: number) => {
        const event = new PointerEvent("pointerdown", { pointerType: "touch", pointerId: id, isPrimary: true, button: 0, bubbles: true, cancelable: true });
        Object.defineProperty(event, "timeStamp", { value: at }); target.dispatchEvent(event); return event;
      };
      tap(cell(1, 0), 1, 1_000);
      window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 99 }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
      expect(tap(cell(1, 0), 2, 1_300).defaultPrevented).toBe(true);
      cell(1, 0).querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      tap(cell(1, 0), 3, 2_000); window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 3 }));
      tap(cell(2, 1), 4, 3_000); window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 4 }));
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
      tap(cell(2, 1), 5, 3_200); window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 5 }));
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
      expect(tap(cell(2, 1), 6, 3_300).defaultPrevented).toBe(false);
      expect(parent.querySelector("textarea")).toBeNull();
      cell(2, 1).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu?.items.map((item) => item.title)).toContain("Merge selected cells");
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each([false, true])("keeps repeated owned merges working with native menus preferred (takeover=%s)", async (takeOverOrdinaryTables) => {
    const source = "| A | B | C |\n| --- | --- | --- |\n| x | < | z |\n| d |  | f |\n| g |  | i |\n\nOutside";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()], undefined, { takeOverOrdinaryTables });
    Menu.useNativeMenu = true;
    try {
      for (const row of [2, 3]) {
        const first = parent.querySelector<HTMLElement>(`[data-structural-row='${row}'][data-structural-column='0']`)!;
        const last = parent.querySelector<HTMLElement>(`[data-structural-row='${row}'][data-structural-column='1']`)!;
        dispatchPointerDown(first, "mouse");
        last.dispatchEvent(new MouseEvent("pointerover", { bubbles: true, buttons: 1 }));
        document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
        last.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        const menu = lastMenu!;
        const merge = menu.items.find((item) => item.title === "Merge selected cells")!;
        expect(merge).toBeDefined();
        // Electron's native menu-will-close reaches the renderer before click.
        if (menu.useNativeMenu) { menu.hide(); await Promise.resolve(); }
        merge.callback?.();
        menu.hide();
        await Promise.resolve();
        const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
        expect(table.rows[row]!.cells[0]!.columnSpan).toBe(2);
      }
      expect(new Menu().useNativeMenu).toBe(true);
      expect(undo(view)).toBe(true);
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[3]!.cells[0]!.columnSpan).toBe(1);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { Menu.useNativeMenu = false; view.destroy(); }
  });

  it("keeps desktop pointer drag ownership separate from touch selection", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;

    const pointerDown = dispatchPointerDown(cell, "mouse");
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(cell.getAttribute("aria-selected")).toBe("true");
    view.destroy();
  });

  it("keeps selection local to the structural table receiving the pointer", () => {
    const second = screenshotTable.split("|  |").join("| x |");
    const source = `${screenshotTable}\n\n${second}\n\nOutside`;
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
    expect(hosts).toHaveLength(2);
    const firstHost = hosts.item(0);
    const secondHost = hosts.item(1);
    const firstCell = firstHost.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
    const secondCell = secondHost.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;

    dispatchPointerDown(firstCell, "mouse");
    expect(firstCell.getAttribute("aria-selected")).toBe("true");
    dispatchPointerDown(secondCell, "mouse");

    expect(firstCell.getAttribute("aria-selected")).toBe("false");
    expect(secondCell.getAttribute("aria-selected")).toBe("true");
    view.destroy();
  });

  it("offers structural expansion and Base upgrade from the owned context menu", () => {
    const requested: StructuralTable[] = [];
    const { parent, view } = mountEditor(
      screenshotTable,
      { anchor: screenshotTable.length },
      [],
      (_editor, _sourceFile, table) => { requested.push(table); },
    );
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

    const item = lastMenu?.items.find((candidate) => candidate.title === "Expand structure and upgrade to Base…");
    expect(item).toBeDefined();
    item?.callback?.();
    expect(requested[0]?.structural).toBe(true);
    view.destroy();
  });

  it("keeps drag selection and links separate from desktop click editing", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const first = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    const last = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;

    dispatchPointerDown(first, "mouse");
    last.dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
    last.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
    expect(parent.querySelector(".structural-tables-cell-editor")).toBeNull();

    const link = first.appendChild(document.createElement("a"));
    link.textContent = "Link";
    dispatchPointerDown(link, "mouse");
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(parent.querySelector(".structural-tables-cell-editor")).toBeNull();
    view.destroy();
  });
});

describe("grid gestures and editing events", () => {
  function mouseGesture(target: HTMLElement): void {
    dispatchPointerDown(target, "mouse");
    window.dispatchEvent(new PointerEvent("pointerup", {
      pointerType: "mouse", pointerId: 1, button: 0, isPrimary: true, bubbles: true,
    }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  }

  it.each([
    { destination: "same", edited: false },
    { destination: "same", edited: true },
    { destination: "other", edited: false },
    { destination: "other", edited: true },
  ] as const)("opens $destination B after the first click on a changed or unchanged A ($edited)", async ({ destination, edited }) => {
    const source = [
      "Before", "", "| H | V |", "| --- || --- |", "| Alpha | Beta |",
      "", "Between", "", "| J | K |", "| --- || --- |", "| Gamma | Delta |", "", "After",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const first = parent.querySelector<HTMLElement>(
        "[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='0']",
      )!;
      expect(first).not.toBeNull();
      mouseGesture(first);
      const a = parent.querySelector<HTMLTextAreaElement>("textarea.structural-tables-cell-editor")!;
      expect(a).not.toBeNull();
      if (edited) replaceDraftText(a, "Edited-Alpha");
      const targetSelector = destination === "same"
        ? "[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='1']"
        : "[data-structural-source-table-index='1'] [data-structural-row='1'][data-structural-column='1']";
      const b = parent.querySelector<HTMLElement>(targetSelector)!;
      expect(b).not.toBeNull();
      dispatchPointerDown(b, "mouse");
      expect(a.isConnected).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      window.dispatchEvent(new PointerEvent("pointerup", {
        pointerType: "mouse", pointerId: 1, button: 0, isPrimary: true, bubbles: true,
      }));
      b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
      await vi.waitFor(() => expect(parent.querySelector(targetSelector + " textarea")).not.toBeNull());
      const target = parent.querySelector<HTMLTextAreaElement>(targetSelector + " textarea")!;
      expect(document.activeElement).toBe(target);
      typeDraftText(target, "!");
      target.blur();
      await vi.waitFor(() => expect(view.state.doc.toString()).toContain(
        destination === "same" ? "Beta!" : "Delta!",
      ));
      expect(view.state.doc.toString()).toContain(edited ? "Edited-Alpha" : "Alpha");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).not.toContain(destination === "same" ? "Beta!" : "Delta!");
      if (edited) {
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(source);
      }
    } finally { view.destroy(); }
  });

  it.each(["rejected", "composing"] as const)("keeps a $case draft and refuses an unintended B switch", async (kind) => {
    const source = "| H | V |\n| --- || --- |\n| Alpha | Beta |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const first = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      mouseGesture(first);
      const a = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      if (kind === "rejected") replaceDraftText(a, "<!--");
      else a.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const b = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      mouseGesture(b);
      expect(view.state.doc.toString()).toBe(source);
      expect(a.isConnected).toBe(true);
      expect(b.querySelector("textarea")).toBeNull();
      if (kind === "composing") a.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    } finally { view.destroy(); }
  });

  it.each([
    { raw: "*Bright*", visible: "Bright", offset: 2, expected: 3, html: "<em>Bright</em>" },
    { raw: "`symbol`", visible: "symbol", offset: 4, expected: 5, html: "<code>symbol</code>" },
    { raw: "[Alias](target)", visible: "Alias", offset: 2, expected: 3, html: "<a href='#'>Alias</a>" },
    { raw: "A😀B", visible: "A😀B", offset: 3, expected: 3, html: "A😀B" },
    { raw: "R&amp;D", visible: "R&D", offset: 2, expected: 6, html: "R&amp;D" },
  ])("maps rendered syntax to a safe source offset ($raw)", ({ raw, visible, offset, expected, html }) => {
    const source = "| H | V |\n| --- || --- |\n| " + raw + " | Other |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      const content = cell.querySelector<HTMLElement>(".structural-tables-cell-content")!;
      content.innerHTML = html;
      const node = content.querySelector("em, code, a")?.firstChild ?? content.firstChild!;
      expect(node.textContent).toBe(visible);
      Object.defineProperty(document, "caretPositionFromPoint", {
        configurable: true, value: () => ({ offsetNode: node, offset }),
      });
      dispatchPointerDown(cell, "mouse");
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(editor).not.toBeNull();
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([expected, expected]);
    } finally {
      Reflect.deleteProperty(document, "caretPositionFromPoint");
      view.destroy();
    }
  });

  it.each(["ctrl", "meta"] as const)("hands an untouched B draft to committed history through %s Scope", async (platform) => {
    const source = "| H | V |\n| --- || --- |\n| Alpha | Beta |\n\nBetween\n\n| J | K |\n| --- || --- |\n| Gamma | Delta |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    Object.assign(view.state.field(editorInfoField).editor!, { undo: () => undo(view), redo: () => redo(view) });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      replaceDraftText(parent.querySelector<HTMLTextAreaElement>("textarea")!, "Changed Alpha");
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-source-table-index='1'] [data-structural-row='1'][data-structural-column='1']")!);
      await Promise.resolve();
      const committed = view.state.doc.toString();
      expect(committed).toContain("Changed Alpha");
      const b = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(b.value).toBe("Delta");
      dispatchDraftShortcut(b, "z", platform);
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe(source);
      expect(b.isConnected).toBe(false);
      expect((document.activeElement as HTMLElement).closest<HTMLElement>("[data-structural-source-table-index]")?.dataset.structuralSourceTableIndex).toBe("0");
      dispatchScopeCaptureThenDom(document.activeElement as HTMLElement, modEvent("z", platform, true));
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe(committed);
    } finally { view.destroy(); }
  });

  const copiedSquare = { version: 1, rows: 2, columns: 2, owners: [["o0", "o1"], ["o2", "o3"]],
    rawByOwner: { o0: "**P**", o1: "Q", o2: "R", o3: "S😀" } };

  it("retains composition ownership across repeated cross-table clicks", () => {
    const source = "| H | V |\n| --- || --- |\n| Alpha | Beta |\n\n| J | K |\n| --- || --- |\n| Gamma | Delta |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const other = parent.querySelector<HTMLElement>("[data-structural-source-table-index='1'] [data-structural-row='1'][data-structural-column='1']")!;
      mouseGesture(other); mouseGesture(other);
      expect(parent.querySelectorAll("textarea")).toHaveLength(1);
      expect(editor.isConnected).toBe(true); expect(view.state.doc.toString()).toBe(source);
      editor.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    } finally { view.destroy(); }
  });

  it("pastes an owned range from a freshly clicked cell in one expandable history transaction", async () => {
    const source = "Before\n\n| H | V |\n| --- || :---: |\n| Keep | Old |\n\nAfter";
    let writes = 0;
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(),
      EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; })]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const transfer = new DataTransfer();
      transfer.setData(TABLE_RANGE_CLIPBOARD_MIME, JSON.stringify(copiedSquare));
      transfer.setData("text/plain", "Must not become one cell");
      parent.querySelector<HTMLTextAreaElement>("textarea")!.dispatchEvent(gridClipboardEvent("paste", transfer));
      await Promise.resolve();
      const pasted = view.state.doc.toString();
      const table = parseEditableTables(pasted).tables[0]!;
      expect(table.columnCount).toBe(3);
      expect(table.rows).toHaveLength(3);
      expect(table.rows[1]!.cells.map((cell) => cell.raw.trim())).toEqual(["Keep", "**P**", "Q"]);
      expect(table.rows[2]!.cells.map((cell) => cell.raw.trim())).toEqual(["", "R", "S😀"]);
      expect(table.alignments).toEqual(["default", "center", "default"]);
      expect(table.rowHeaderColumnCount).toBe(1);
      expect(pasted.startsWith("Before\n\n")).toBe(true);
      expect(pasted.endsWith("\n\nAfter")).toBe(true);
      expect(writes).toBe(1);
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
      expect(redo(view)).toBe(true); expect(view.state.doc.toString()).toBe(pasted);
    } finally { view.destroy(); }
  });

  it.each(["changed", "composition", "invalid-payload", "partial-merge"] as const)("preserves source and draft when active-cell range paste is %s", (kind) => {
    const source = "| H | V | W |\n| --- || --- | --- |\n| Keep | Old | End |\n| Next | Merged | < |";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      if (kind === "changed") replaceDraftText(editor, "Unsaved draft");
      if (kind === "composition") editor.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const payload = kind === "partial-merge" ? { ...copiedSquare, columns: 1, owners: [["o0"], ["o1"]], rawByOwner: { o0: "P", o1: "Q" } } : copiedSquare;
      const transfer = new DataTransfer();
      transfer.setData(TABLE_RANGE_CLIPBOARD_MIME, kind === "invalid-payload" ? "bad" : JSON.stringify(payload));
      transfer.setData("text/plain", "Must not be inserted");
      const value = editor.value;
      editor.dispatchEvent(gridClipboardEvent("paste", transfer));
      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true); expect(editor.value).toBe(value);
      expect(undoDepth(view.state)).toBe(0);
      if (kind === "partial-merge") {
        mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='2']")!);
        expect(parent.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("End");
        expect(view.state.doc.toString()).toBe(source);
      }
    } finally { view.destroy(); }
  });

  it("restores the full pasted range after an asynchronously rebuilt native Callout", async () => {
    vi.stubGlobal("createDiv", (options: { cls: string }) => {
      const element = document.createElement("div"); element.className = options.cls; return element;
    });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (...args: unknown[]) => {
      const container = args[2] as HTMLElement;
      if (container.className === "structural-tables-container") container.innerHTML = nativeTableForSource(args[1] as string)!.outerHTML;
    });
    class DeferredCallout extends WidgetType {
      constructor(private readonly source: string) { super(); }
      override toDOM(): HTMLElement { return new SourceCalloutWidget(this.source).toDOM(); }
      override updateDOM(dom: HTMLElement): boolean {
        queueMicrotask(() => dom.replaceChildren(...this.toDOM().childNodes));
        return true;
      }
    }
    const nativeFor = (source: string) => Decoration.set([
      Decoration.replace({ widget: new DeferredCallout(source), block: true })
        .range(source.indexOf("> [!note]"), source.indexOf("\n\nEnd")),
    ]);
    const native = StateField.define({
      create: (state) => nativeFor(state.doc.toString()),
      update: (value, transaction) => transaction.docChanged ? nativeFor(transaction.newDoc.toString()) : value,
      provide: (field) => EditorView.decorations.from(field),
    });
    const source = "Before\n\n> [!note]\n> | H | V |\n> | --- || --- |\n> | Keep | Old |\n\nEnd";
    let writes = 0;
    const { parent, view } = mountEditor(source, { anchor: 0 }, [native, history(),
      EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; })]);
    try {
      await vi.waitFor(() => expect(parent.querySelector(".callout .structural-tables-live-preview")).not.toBeNull());
      mouseGesture(parent.querySelector<HTMLElement>(".callout [data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      const transfer = new DataTransfer();
      transfer.setData(TABLE_RANGE_CLIPBOARD_MIME, JSON.stringify(copiedSquare));
      editor.dispatchEvent(gridClipboardEvent("paste", transfer));
      expect(editor.isConnected).toBe(true);
      expect(writes).toBe(1);
      await vi.waitFor(() => expect(parent.querySelectorAll(".callout [aria-selected='true']")).toHaveLength(4));
      const pasted = view.state.doc.toString();
      expect(pasted.startsWith("Before\n\n> [!note]\n")).toBe(true);
      expect(pasted.endsWith("\n\nEnd")).toBe(true);
      expect(document.activeElement).toBe(parent.querySelector(".callout [data-structural-row='1'][data-structural-column='1']"));
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
      expect(redo(view)).toBe(true); expect(view.state.doc.toString()).toBe(pasted);
    } finally { view.destroy(); }
  });

  it("maps a first held text drag into a partial source selection without writing", () => {
    const source = "| H | V |\n| --- || --- |\n| **Bright** | Other |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      const content = cell.querySelector<HTMLElement>(".structural-tables-cell-content")!;
      content.innerHTML = "<strong>Bright</strong>";
      Object.defineProperty(document, "caretPositionFromPoint", { configurable: true,
        value: (x: number) => ({ offsetNode: content.firstChild!.firstChild!, offset: x < 5 ? 1 : 4 }) });
      cell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true,
        isPrimary: true, pointerType: "mouse", button: 0, clientX: 0, clientY: 0 }));
      cell.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, buttons: 1, clientX: 10 }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 }));
      cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: 10 }));
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe("rig");
      expect(view.state.doc.toString()).toBe(source);
    } finally { Reflect.deleteProperty(document, "caretPositionFromPoint"); view.destroy(); }
  });

  it("does not use the single-line fallback to escape uncertain bidi geometry", () => {
    const source = "| H | V |\n| --- || --- |\n| Keep | مرحبا ABC |\n| Next | Other |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.style.lineHeight = "20px";
      Object.defineProperties(editor, { clientHeight: { value: 20 }, scrollHeight: { value: 20 } });
      editor.setSelectionRange(editor.value.length, editor.value.length);
      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      editor.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false); expect(editor.isConnected).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("does not arm full-cell replacement when two identical labels make the mapping ambiguous", () => {
    const source = "| H | V |\n| --- || --- |\n| **abc** abc | Other |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      const content = cell.querySelector<HTMLElement>(".structural-tables-cell-content")!;
      content.innerHTML = "<strong>abc</strong> abc";
      const node = content.firstChild!.firstChild!;
      Object.defineProperty(document, "caretPositionFromPoint", {
        configurable: true, value: () => ({ offsetNode: node, offset: 1 }),
      });
      mouseGesture(cell);
      const editor = cell.querySelector<HTMLTextAreaElement>("textarea")!;
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([editor.value.length, editor.value.length]);
    } finally {
      Reflect.deleteProperty(document, "caretPositionFromPoint");
      view.destroy();
    }
  });
  it.each(["editor", "other"] as const)("hands a changed draft to a real grid drag from %s", async (origin) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n| Gamma | Delta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const cell = (r: number, c: number) => parent.querySelector<HTMLElement>(`[data-structural-row='${r}'][data-structural-column='${c}']`)!;
    try {
      mouseGesture(cell(1, 0));
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, "Changed Alpha");
      dispatchPointerDown(origin === "editor" ? editor : cell(2, 1), "mouse");
      (origin === "editor" ? cell(2, 1) : cell(1, 0)).dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      window.dispatchEvent(new Event("pointerup"));
      await Promise.resolve();
      cell(2, 1).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      expect(parent.querySelector("textarea")).toBeNull();
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
      expect(view.state.doc.toString()).toContain("Changed Alpha");
      const transfer = new DataTransfer();
      cell(1, 0).dispatchEvent(gridClipboardEvent("copy", transfer));
      expect(transfer.getData(TABLE_RANGE_CLIPBOARD_MIME)).toContain("Changed Alpha");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toContain("Changed Alpha");
    } finally { view.destroy(); }
  });

  it.each(["ime", "invalid"] as const)("refuses drag ownership transfer for an %s draft", (kind) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n| C | D |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const first = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      mouseGesture(first);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      if (kind === "ime") editor.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      else editor.value = "$x|y$";
      dispatchPointerDown(editor, "mouse");
      parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!
        .dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      window.dispatchEvent(new Event("pointerup"));
      expect(editor.isConnected).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(1);
    } finally { view.destroy(); }
  });

  it.each(["redundant", "affinity", "moved", "moved-back", "source-pointer", "document"] as const)("distinguishes an explicit %s source selection after a completed grid handoff", async (change) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n| Gamma | Delta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const cell = (row: number, column: number) => parent.querySelector<HTMLElement>(`[data-structural-row='${row}'][data-structural-column='${column}']`)!;
    try {
      mouseGesture(cell(1, 0));
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, "Changed Alpha");
      dispatchPointerDown(editor, "mouse");
      cell(2, 1).dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      window.dispatchEvent(new Event("pointerup"));
      await Promise.resolve();
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
      expect(document.activeElement).toBe(cell(1, 0));
      const committed = view.state.doc.toString();
      const selection = view.state.selection;
      if (change === "source-pointer") {
        view.contentDOM.dispatchEvent(new PointerEvent("pointerdown", {
          bubbles: true, cancelable: true, pointerType: "mouse", pointerId: 9, isPrimary: true, button: 0,
        }));
        view.contentDOM.focus();
        expect(view.state.selection.eq(selection)).toBe(true);
      }
      const repeated = change === "affinity" ? EditorSelection.create([
        EditorSelection.cursor(selection.main.head, selection.main.assoc === 1 ? -1 : 1),
      ]) : selection;
      const first = view.state.update({ selection: change === "moved" || change === "moved-back" ? { anchor: committed.length } : repeated,
        ...(change === "document" ? { changes: { from: committed.length, insert: " changed" } } : {}) });
      const transactions = change === "moved-back" ? [first, first.state.update({ selection })] : [first];
      for (const transaction of transactions) {
        expect(transaction.selection).toBeDefined();
        expect(transaction.state.selection.eq(transaction.startState.selection)).toBe(change !== "moved" && change !== "moved-back");
        expect(transaction.docChanged).toBe(change === "document");
      }
      if (change === "affinity") expect(first.state.selection.eq(first.startState.selection, true)).toBe(false);
      if (change === "moved-back") expect(transactions[1]!.state.selection.eq(view.state.selection)).toBe(true);
      view.dispatch(transactions);
      expect(view.state.doc.toString()).toBe(committed + (change === "document" ? " changed" : ""));
      expect(undoDepth(view.state)).toBe(change === "document" ? 2 : 1);
      if (change !== "redundant" && change !== "affinity") {
        expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(0);
        if (change === "source-pointer") {
          view.contentDOM.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse", pointerId: 9, button: 0 }));
          await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).toBeNull());
        }
        return;
      }
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);
      const transfer = new DataTransfer();
      const copy = gridClipboardEvent("copy", transfer); cell(1, 0).dispatchEvent(copy);
      expect(copy.defaultPrevented).toBe(true);
      expect(transfer.getData("text/plain")).toBe("| Changed Alpha | Beta |\n| --- | --- |\n| Gamma | Delta |");
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each([false, true])("clears a range for explicit source focus with an unchanged caret outside the table; split transaction=%s", (split) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n| Gamma | Delta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.click();
      expect(view.state.selection.main.anchor).toBe(0);
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(2);
      const selection = view.state.selection;
      const first = view.state.update({ selection, ...(split ? {} : { effects: structuralTableSourceFocus.of(true) }) });
      view.dispatch(split ? [first, first.state.update({ effects: structuralTableSourceFocus.of(true) })] : [first]);
      expect(view.state.selection.eq(selection)).toBe(true);
      expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(0);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["file", "editor"] as const)("clears a range when source %s identity changes and returns within one update", (identity) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.click();
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(2);
      const info = view.state.field(editorInfoField);
      const replacement = { ...info, [identity]: identity === "file" ? { path: info.file!.path } : {} };
      const first = view.state.update({ selection: view.state.selection, effects: editorInfoChanged.of(replacement) });
      const last = first.state.update({ selection: first.state.selection, effects: editorInfoChanged.of(info) });
      expect(last.state.field(editorInfoField)).toBe(info);
      expect(last.state.selection.eq(view.state.selection)).toBe(true);
      view.dispatch([first, last]);
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(0);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("commits cross-cell right-click once and keeps later clicks in grid mode", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    const cell = (c: number) => parent.querySelector<HTMLElement>(`[data-structural-row='1'][data-structural-column='${c}']`)!;
    try {
      mouseGesture(cell(0));
      typeDraftText(parent.querySelector<HTMLTextAreaElement>("textarea")!, "Changed");
      cell(1).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      expect(parent.querySelector("textarea")).toBeNull();
      expect(lastMenu?.items.some((entry) => entry.title === "Copy selected cells")).toBe(true);
      lastMenu?.hide(); await Promise.resolve();
      cell(0).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu?.items.some((entry) => entry.title === "Copy selected cells")).toBe(true);
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
    } finally { view.destroy(); }
  });

  it.each([false, true])("replaces the preceding grid menu without a manual hide; cross-table=%s", async (crossTable) => {
    const table = "| H | V |\n| --- || --- |\n| A | B |";
    const source = `Before\n\n${table}\n\nBetween\n\n${table}\n\nEnd`;
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      const first = hosts[0]!.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      first.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const previous = lastMenu!;
      const hide = vi.spyOn(previous, "hide");
      const oldClear = previous.items.find((item) => item.title === "Clear selected cells")!.callback!;
      const next = hosts[crossTable ? 1 : 0]!.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      next.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu).not.toBe(previous);
      expect(hide).toHaveBeenCalledOnce();
      oldClear();
      await Promise.resolve();
      expect(view.state.doc.toString()).toBe(source);
      expect(next.getAttribute("aria-selected")).toBe("true");
    } finally { view.destroy(); }
  });

  it.each(["break", "math", "table"] as const)("revokes a replaced text-menu %s callback", (kind) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.value = "$|x|$"; editor.select();
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const oldMenu = lastMenu!;
      const callback = kind === "table"
        ? oldMenu.items.find((item) => item.title === "Table operations")!.submenu!.items.find((item) => item.title === "Insert row below")!.callback!
        : oldMenu.items.find((item) => item.title === createTranslator("en")(kind === "break" ? "menu.insertCellBreak" : "menu.useMathAbsoluteSuggestion"))!.callback!;
      const hide = vi.spyOn(oldMenu, "hide");
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(hide).toHaveBeenCalledOnce();
      callback();
      expect(editor.value).toBe("$|x|$");
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["Copy", "Cut"] as const)("does not overwrite the clipboard for text-menu %s without selected text", async (action) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | KEEP |\n\nEnd";
    let clipboard = "Previous clipboard";
    const writeText = vi.fn(async (value: string) => { clipboard = value; });
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(2, 2);
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const item = lastMenu!.items.find((entry) => entry.title === action)!;
      expect(item.disabled).toBe(true);
      // A retained callback must also refuse, independently of native menu styling.
      item.callback!();
      await Promise.resolve(); await Promise.resolve();
      expect(writeText).not.toHaveBeenCalled();
      expect(clipboard).toBe("Previous clipboard");
      expect(editor.value).toBe("Alpha");
      expect(editor.selectionStart).toBe(2); expect(editor.selectionEnd).toBe(2);
      expect(view.state.doc.toString()).toBe(source);
      expect(undoDepth(view.state)).toBe(0);
    } finally { view.destroy(); }
  });

  it.each(["Copy", "Cut"] as const)("keeps text-menu %s effective for a non-empty draft selection", async (action) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | KEEP |\n\nEnd";
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.setSelectionRange(1, 4);
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu!.items.find((entry) => entry.title === action)!.disabled).toBe(false);
      clickCurrentMenuItem(action, true);
      await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith("lph"));
      await vi.waitFor(() => expect(editor.value).toBe(action === "Cut" ? "Aa" : "Alpha"));
      expect(view.state.doc.toString()).toBe(source);
      expect(undoDepth(view.state)).toBe(0);
    } finally { view.destroy(); }
  });

  it.each(["Cut", "Paste as plain text"] as const)("revokes pending text-menu %s when an identical draft menu replaces it", async (action) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n\nEnd";
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    const writeText = vi.fn(() => pending.then(() => {}));
    const readText = vi.fn(() => pending);
    vi.stubGlobal("navigator", { clipboard: { writeText, readText } });
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu!.items.find((item) => item.title === action)!.callback!();
      await vi.waitFor(() => expect(action === "Cut" ? writeText : readText).toHaveBeenCalledOnce());
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      release("NEW");
      await pending; await Promise.resolve(); await Promise.resolve();
      expect(editor.value).toBe("A");
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("accepts a real hide-before-click asynchronous text paste", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n\nEnd";
    vi.stubGlobal("navigator", { clipboard: { readText: vi.fn(async () => "NEW") } });
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem("Paste as plain text", true);
      await vi.waitFor(() => expect(editor.value).toBe("NEW"));
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("does not steal an outside input's focus after text-menu dismissal", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const outside = document.body.appendChild(document.createElement("input"));
      dispatchPointerDown(outside, "mouse"); outside.focus(); lastMenu!.hide();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(document.activeElement).toBe(outside);
      editor.focus();
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(parent.querySelector("textarea")).toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("releases the text-menu guard after an axis menu supersedes it", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu!.hide(); await new Promise((resolve) => setTimeout(resolve, 5));
      editor.focus(); editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(parent.querySelector("textarea")).toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("returns focus after a fallback submenu replaces its dismissed parent", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n\nEnd";
    const descriptor = Object.getOwnPropertyDescriptor(MenuItem.prototype, "setSubmenu")!;
    Object.defineProperty(MenuItem.prototype, "setSubmenu", { ...descriptor, value: undefined });
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const show = vi.spyOn(Menu.prototype, "showAtPosition");
      clickCurrentMenuItem("Table operations", true);
      await Promise.resolve();
      expect(show).toHaveBeenCalledOnce();
      const child = show.mock.instances[0] as Menu;
      child.hide();
      await vi.waitFor(() => expect(document.activeElement).toBe(editor));
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      expect(parent.querySelector("textarea")).toBeNull();
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); Object.defineProperty(MenuItem.prototype, "setSubmenu", descriptor); }
  });

  it.each((["row", "column"] as const).flatMap((axis) => [1, 2].flatMap((index) =>
    [false, true].map((changed) => ({ axis, index, changed })))))("completes $axis $index selection and releases the draft (changed=$changed)", ({ axis, index, changed }) => {
    const source = "Before\n\n| H | V | J |\n| --- || --- | --- |\n| Alpha | Beta | KEEP |\n| Gamma | Delta | KEEP-ROW |\n\nEnd";
    let writes = 0;
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history(), EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; })]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      if (changed) { editor.select(); typeDraftText(editor, "Changed Beta"); }
      mouseGesture(parent.querySelector<HTMLElement>(`[data-structural-${axis}-handle='${index}']`)!);
      expect(parent.querySelector("textarea")).toBeNull();
      const handle = parent.querySelector<HTMLElement>(`[data-structural-${axis}-handle='${index}']`)!;
      expect(document.activeElement).toBe(handle);
      expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(3);
      expect(writes).toBe(changed ? 1 : 0);
      expect(undoDepth(view.state)).toBe(changed ? 1 : 0);
      const transfer = new DataTransfer();
      handle.dispatchEvent(gridClipboardEvent("copy", transfer));
      expect(transfer.getData("text/plain")).toContain(axis === "row" && index === 2 ? "Gamma" : index === 1 ? (changed ? "Changed Beta" : "Beta") : "KEEP");
      dispatchOwnedGridKey(handle, "Delete");
      const selected = parseEditableTables(view.state.doc.toString()).tables[0]!;
      const contents = axis === "row" ? selected.rows[index]!.cells.map((cell) => cell.content)
        : selected.rows.map((row) => row.cells[index]!.content);
      expect(contents).toEqual(["", "", ""]);
      expect(undo(view)).toBe(true);
      if (changed) { expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source); }
    } finally { view.destroy(); }
  });

  it.each(["invalid", "ime", "stale"] as const)("refuses completed axis selection without changing focus, range or history: %s", async (kind) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n| Gamma | Delta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, kind === "invalid" ? "$x|y$" : "Changed Beta");
      if (kind === "ime") editor.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      if (kind === "stale") view.state.field(editorInfoField).file!.path = "Other.md";
      const before = [...parent.querySelectorAll("[aria-selected='true']")];
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row-handle='2']")!);
      await Promise.resolve();
      expect(editor.isConnected).toBe(true); expect(document.activeElement).toBe(editor);
      expect([...parent.querySelectorAll("[aria-selected='true']")]).toEqual(before);
      expect(parent.querySelector(".structural-tables-row-handle.is-selected")).toBeNull();
      expect(view.state.doc.toString()).toBe(source); expect(undo(view)).toBe(false);
    } finally { view.destroy(); }
  });

  it.each(["Escape", "pointercancel", "blur"] as const)("rolls back a pending axis preview on %s without committing the draft", (cancel) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n| Gamma | Delta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, "Changed Beta");
      const before = [...parent.querySelectorAll("[aria-selected='true']")];
      dispatchPointerDown(parent.querySelector<HTMLElement>("[data-structural-row-handle='2']")!, "mouse");
      expect(parent.querySelector(".structural-tables-row-handle.is-selected")).not.toBeNull();
      if (cancel === "Escape") window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      else if (cancel === "blur") { editor.blur(); window.dispatchEvent(new Event("blur")); }
      else window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
      expect(editor.isConnected).toBe(true); expect(editor.value).toBe("Changed Beta");
      expect([...parent.querySelectorAll("[aria-selected='true']")]).toEqual(before);
      expect(parent.querySelector(".structural-tables-row-handle.is-selected")).toBeNull();
      expect(view.state.doc.toString()).toBe(source); expect(undo(view)).toBe(false);
      // A cancelled mouse tail must not consume the next keyboard activation.
      parent.querySelector<HTMLElement>("[data-structural-row-handle='2']")!.click();
      expect(parent.querySelector("textarea")).toBeNull(); expect(undoDepth(view.state)).toBe(1);
    } finally { view.destroy(); }
  });

  it.each([false, true])("settles a pending release without a native trailing click; inside=%s", (inside) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n| Gamma | Delta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, "Changed Beta");
      const handle = parent.querySelector<HTMLElement>("[data-structural-row-handle='2']")!;
      vi.spyOn(handle, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 10, 20, 20));
      handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 9, pointerType: "mouse", isPrimary: true, button: 0, clientX: 29, clientY: 20 }));
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, pointerType: "mouse", clientX: inside ? 29 : 31, clientY: 20 }));
      expect(parent.querySelector("textarea") === null).toBe(inside);
      expect(undoDepth(view.state)).toBe(inside ? 1 : 0);
      expect(parent.querySelector(".structural-tables-row-handle.is-selected") !== null).toBe(inside);
    } finally { view.destroy(); }
  });

  it("keeps touch range anchors across draft commit and does not retain a refused first tap", () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n| Gamma | Delta |\n| Last | KEEP |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, "$x|y$");
      const tap = (index: number): void => {
        const handle = parent.querySelector<HTMLElement>(`[data-structural-row-handle='${index}']`)!;
        handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 7, isPrimary: true, button: 0 }));
        window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 7 }));
        if (handle.isConnected) handle.click();
      };
      tap(1); expect(editor.isConnected).toBe(true);
      editor.select(); typeDraftText(editor, "Changed Beta");
      tap(3);
      expect(parent.querySelector("textarea")).toBeNull();
      expect(parent.querySelectorAll(".structural-tables-row-handle.is-selected")).toHaveLength(1);
      tap(2);
      expect([...parent.querySelectorAll<HTMLElement>(".structural-tables-row-handle.is-selected")].map((handle) => handle.dataset.structuralRowHandle)).toEqual(["2", "3"]);
      expect(undoDepth(view.state)).toBe(1);
    } finally { view.destroy(); }
  });

  it.each(["copy", "cut", "paste"] as const)("keeps %s inside its closest owner and respects a consumed event", (type) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.click();
      const handle = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!;
      const host = handle.closest(".structural-tables-live-preview")!;
      const inner = host.appendChild(document.createElement("div")); inner.className = "structural-tables-live-preview";
      const target = inner.appendChild(document.createElement("button"));
      const transfer = new DataTransfer(); transfer.setData("text/plain", "SENTINEL");
      const write = vi.spyOn(transfer, "setData");
      const nested = gridClipboardEvent(type, transfer); target.dispatchEvent(nested);
      expect(nested.defaultPrevented).toBe(false); expect(write).not.toHaveBeenCalled();
      const consumed = gridClipboardEvent(type, transfer); consumed.preventDefault(); handle.dispatchEvent(consumed);
      expect(write).not.toHaveBeenCalled(); expect(view.state.doc.toString()).toBe(source);
      const text = host.appendChild(document.createElement("textarea"));
      const native = gridClipboardEvent(type, transfer); text.dispatchEvent(native);
      expect(native.defaultPrevented).toBe(false); expect(write).not.toHaveBeenCalled();
    } finally { view.destroy(); }
  });

  it.each(["copy", "cut"] as const)("rejects stale owned %s before writing clipboard data", (type) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.click();
      const handle = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!;
      view.state.field(editorInfoField).file!.path = "Other.md";
      const transfer = new DataTransfer(); const write = vi.spyOn(transfer, "setData");
      const event = gridClipboardEvent(type, transfer); handle.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true); expect(write).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source); expect(undo(view)).toBe(false);
    } finally { view.destroy(); }
  });

  it.each(["valid", "invalid", "ime"] as const)("guards direct handle focus before keyboard navigation: %s", async (kind) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n| Gamma | Delta |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, kind === "invalid" ? "$x|y$" : "Changed Beta");
      if (kind === "ime") editor.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.focus();
      await Promise.resolve();
      if (kind !== "valid") {
        expect(document.activeElement).toBe(editor); expect(editor.isConnected).toBe(true);
        expect(parent.querySelector(".structural-tables-row-handle.is-selected")).toBeNull();
        expect(view.state.doc.toString()).toBe(source); return;
      }
      const live = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!;
      expect(document.activeElement).toBe(live); expect(parent.querySelector("textarea")).toBeNull();
      live.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(parent.querySelector("[data-structural-row-handle='2']"));
      expect(undoDepth(view.state)).toBe(1);
    } finally { view.destroy(); }
  });

  it("retains the logical anchor through a context menu inside a reverse Shift selection", () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| Alpha | Beta |\n| Gamma | Delta |\n| Last | KEEP |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 });
    const handle = (index: number) => parent.querySelector<HTMLElement>(`[data-structural-row-handle='${index}']`)!;
    const shift = (index: number): void => {
      handle(index).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse", isPrimary: true, button: 0, shiftKey: true }));
      handle(index).click();
    };
    try {
      handle(3).click(); shift(1);
      handle(2).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu!.hide(); shift(2);
      expect([...parent.querySelectorAll<HTMLElement>(".structural-tables-row-handle.is-selected")].map((item) => item.dataset.structuralRowHandle)).toEqual(["2", "3"]);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it.each(["valid", "invalid", "ime"] as const)("ends editing before an axis menu, refusing unsafe drafts: %s", async (kind) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n| C | D |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, kind === "invalid" ? "$x|y$" : "AlphaX");
      if (kind === "ime") editor.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const textMenu = lastMenu;
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      if (kind !== "valid") {
        expect(lastMenu).toBe(textMenu);
        expect(view.state.doc.toString()).toBe(source);
        expect(editor.isConnected).toBe(true);
        expect(editor.value).toBe(kind === "invalid" ? "$x|y$" : "AlphaX");
        expect(parent.querySelector(".structural-tables-row-handle.is-selected")).toBeNull();
        expect(undo(view)).toBe(false);
        return;
      }
      expect(parent.querySelector("textarea")).toBeNull();
      const committed = view.state.doc.toString();
      expect(committed).toContain("AlphaX");
      expect(undoDepth(view.state)).toBe(1);
      clickCurrentMenuItem("Insert row below", true);
      await Promise.resolve();
      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table.rows[1]!.cells[0]!.content).toBe("AlphaX");
      expect(table.rows[1]!.cells[1]!.content).toBe("KEEP");
      expect(table.rows).toHaveLength(4);
      expect(parent.querySelector(".structural-tables-row-handle.is-selected")).not.toBeNull();
      expect(document.activeElement).toBe(parent.querySelector("[data-structural-row-handle='1']"));
      expect(undoDepth(view.state)).toBe(2);
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(committed);
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull());
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
    } finally { view.destroy(); }
  });

  it.each(["Copy selected cells", "Cut selected cells", "Paste into selected cells", "Paste as plain text", "Copy whole table for Word / HTML"].flatMap((action) =>
    (["invalid", "ime"] as const).map((kind) => ({ action, kind }))))("keeps axis clipboard $action unavailable with a $kind draft", ({ kind }) => {
    const source = "Before\n\n| H | V |\n| --- | --- |\n| A | < |\n\nEnd";
    const clipboard = { write: vi.fn(), writeText: vi.fn(), read: vi.fn(), readText: vi.fn() };
    vi.stubGlobal("navigator", { clipboard });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      if (kind === "invalid") { editor.select(); typeDraftText(editor, "$x|y$"); }
      if (kind === "ime") editor.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      const previousMenu = lastMenu;
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu).toBe(previousMenu);
      for (const method of Object.values(clipboard)) expect(method).not.toHaveBeenCalled();
      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true); expect(editor.value).toBe(kind === "invalid" ? "$x|y$" : "A");
      expect(undo(view)).toBe(false);
    } finally { view.destroy(); }
  });

  it.each(["Cut selected cells", "Paste as plain text"].flatMap((action) =>
    (["changed", "ime"] as const).map((kind) => ({ action, kind }))))("revokes pending axis $action when a new $kind draft starts", async ({ action, kind }) => {
    const source = "Before\n\n| H | V |\n| --- | --- |\n| A | < |\n\nEnd";
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    const write = vi.fn(() => pending.then(() => {}));
    const readText = vi.fn(() => pending);
    class MockClipboardItem { constructor(readonly data: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { write, readText } });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(parent.querySelector("textarea")).toBeNull();
      lastMenu!.items.find((item) => item.title === action)!.callback!();
      await vi.waitFor(() => expect(action === "Cut selected cells" ? write : readText).toHaveBeenCalledOnce());
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      if (kind === "changed") { editor.select(); typeDraftText(editor, "Late AlphaX"); }
      else editor.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      release("NEW"); await pending; await Promise.resolve(); await Promise.resolve();
      expect(view.state.doc.toString()).toBe(source);
      expect(editor.isConnected).toBe(true); expect(editor.value).toBe(kind === "changed" ? "Late AlphaX" : "A");
      expect(undo(view)).toBe(false);
    } finally { view.destroy(); Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined }); }
  });

  it.each([
    { callout: false, cancel: "none" }, { callout: true, cancel: "none" },
    { callout: true, cancel: "source" }, { callout: true, cancel: "pointer" }, { callout: true, cancel: "menu" }, { callout: true, cancel: "wheel" },
  ])("opens the axis menu after committing a draft unless superseded; callout=$callout cancel=$cancel", async ({ callout, cancel }) => {
    const table = "| H | V |\n| --- || --- |\n| A | KEEP |";
    const source = `Before\n\n${callout ? "> [!note]\n" + table.split("\n").map((line) => "> " + line).join("\n") : table}\n\nEnd`;
    const extensions: Extension[] = [history()];
    if (callout) {
      vi.stubGlobal("createDiv", (options: { cls: string }) => {
        const element = document.createElement("div"); element.className = options.cls; return element;
      });
      vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, markdown, target) => {
        const native = nativeTableForSource(markdown);
        if (native !== null) target.appendChild(native);
      });
      const nativeFor = (text: string) => Decoration.set([
        Decoration.replace({ widget: new SourceCalloutWidget(text), block: true })
          .range(text.indexOf("> [!note]"), text.indexOf("\n\nEnd")),
      ]);
      extensions.push(StateField.define({
        create: (state) => nativeFor(state.doc.toString()),
        update: (value, transaction) => transaction.docChanged ? nativeFor(transaction.newDoc.toString()) : value,
        provide: (field) => EditorView.decorations.from(field),
      }));
    }
    const { app, parent, view } = mountEditor(source, { anchor: 0 }, extensions);
    try {
      await vi.waitFor(() => expect(parent.querySelector("[data-structural-row='1'][data-structural-column='0']")).not.toBeNull());
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, "AlphaX");
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const oldMenu = lastMenu;
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      if (cancel !== "none") {
        const show = vi.spyOn(Menu.prototype, "showAtPosition");
        if (cancel === "source") view.dispatch({ changes: { from: 0, insert: "Changed prefix\n" } });
        else if (cancel === "pointer") dispatchPointerDown(document.body, "mouse");
        else if (cancel === "wheel") document.body.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        else new TableMenuOwner(app, document).open(new Menu() as unknown as import("obsidian").Menu);
        await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull());
        await Promise.resolve(); await Promise.resolve();
        expect(show).not.toHaveBeenCalled(); expect(lastMenu).toBe(oldMenu);
        expect(view.state.doc.toString()).toContain("AlphaX");
        return;
      }
      await vi.waitFor(() => expect(lastMenu!.items.some((item) => item.title === "Delete table")).toBe(true));
      const committed = view.state.doc.toString();
      expect(committed).toContain("AlphaX");
      expect(parent.querySelector("textarea")).toBeNull();
      clickCurrentMenuItem("Delete table", true);
      await Promise.resolve();
      expect(parseEditableTables(view.state.doc.toString()).tables).toHaveLength(0);
      expect(view.hasFocus).toBe(true);
      expect(undoDepth(view.state)).toBe(2);
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(committed);
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull());
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
      await vi.waitFor(() => expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull());
      expect(undo(view)).toBe(false);
    } finally { view.destroy(); }
  });

  it.each(["Cut selected cells", "Paste as plain text"] as const)("revokes a pending grid %s when the same cell menu reopens", async (action) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    let release!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { release = resolve; });
    const write = vi.fn(() => pending.then(() => {}));
    const readText = vi.fn(() => pending);
    class MockClipboardItem { constructor(readonly data: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { write, readText } });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      clickCurrentMenuItem(action, true);
      await vi.waitFor(() => expect(action === "Cut selected cells" ? write : readText).toHaveBeenCalledOnce());
      cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      release("NEW"); await pending; await Promise.resolve(); await Promise.resolve();
      expect(view.state.doc.toString()).toBe(source);
      expect(undo(view)).toBe(false);
    } finally { view.destroy(); Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined }); }
  });

  it("uses the same literal HTML classifier for native and menu paste", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | B |\n\nEnd";
    const rich = "<table><tr><td>[[Plan]] &lt;!--VISIBLE--&gt; &amp;copy;</td></tr></table>";
    const read = vi.fn(async () => [{ types: ["text/html", "text/plain"], getType: async (type: string) => new Blob([type === "text/html" ? rich : "[[Plan]] <!--VISIBLE--> &copy;"]) }]);
    vi.stubGlobal("navigator", { clipboard: { read, readText: vi.fn(async () => "[[Plan]] <!--VISIBLE--> &copy;") } });
    for (const menu of [false, true]) {
      const { parent, view } = mountEditor(source, { anchor: 0 });
      try {
        const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
        mouseGesture(cell);
        const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
        editor.select();
        if (menu) {
          editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
          lastMenu!.items.find((entry) => entry.title === "Paste")!.callback!();
          await vi.waitFor(() => expect(editor.value).toContain("&#91;"));
        } else {
          const transfer = new DataTransfer(); transfer.setData("text/html", rich); transfer.setData("text/plain", "[[Plan]] <!--VISIBLE--> &copy;");
          editor.dispatchEvent(gridClipboardEvent("paste", transfer));
        }
        expect(editor.value).toContain("&#91;");
        expect(editor.value).toContain("&#60;");
        expect(editor.value).toContain("&#38;copy");
        lastMenu?.hide(); await new Promise((resolve) => setTimeout(resolve, 1));
        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(view.state.doc.toString()).toContain("&#91;");
        expect(parseEditableTables(view.state.doc.toString()).tables[0]!.columnCount).toBe(2);
      } finally { view.destroy(); }
    }
    vi.unstubAllGlobals();
  });

  it.each([
    { name: "ordinary span text", html: `<span>${TABLE_RANGE_HTML_ATTRIBUTE}</span>`, plain: TABLE_RANGE_HTML_ATTRIBUTE,
      expected: "data&#45;structural&#45;tables&#45;range", fallback: true },
    { name: "neighboring span text", html: "<span>data-structural-tables-other</span>", plain: "data-structural-tables-other",
      expected: "data&#45;structural&#45;tables&#45;other", fallback: true },
    { name: "plain text", html: "", plain: TABLE_RANGE_HTML_ATTRIBUTE, expected: TABLE_RANGE_HTML_ATTRIBUTE, fallback: false },
    { name: "ordinary attribute value", html: `<span title="${TABLE_RANGE_HTML_ATTRIBUTE}">Safe</span>`, plain: "Safe", expected: "Safe", fallback: true },
    { name: "table-cell fragment text", html: `<td>${TABLE_RANGE_HTML_ATTRIBUTE}</td>`, plain: TABLE_RANGE_HTML_ATTRIBUTE,
      expected: "data&#45;structural&#45;tables&#45;range", fallback: false },
    { name: "table-row fragment attribute value", html: `<tr><td title="${TABLE_RANGE_HTML_ATTRIBUTE}">Safe</td></tr>`, plain: "Safe",
      expected: "Safe", fallback: false },
  ].flatMap((sample) => ["native", "menu"].map((route) => ({ ...sample, route }))))(
    "pastes $name containing a range-marker string through $route without claiming a range", async ({ html, plain, expected, fallback, route }) => {
      const source = "Before\n\n| H | V |\n| --- || --- |\n| A | Alpha |\n\nEnd";
      const transfer = new DataTransfer();
      transfer.setData("text/plain", plain);
      if (html !== "") transfer.setData("text/html", html);
      const read = vi.fn(async () => [{ types: transfer.types, getType: async (type: string) => new Blob([transfer.getData(type)]) }]);
      vi.stubGlobal("navigator", { clipboard: { read } });
      const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
      const noticeStart = notices.length;
      try {
        const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
        mouseGesture(cell);
        const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
        editor.select();
        if (route === "menu") {
          editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
          clickCurrentMenuItem("Paste", true);
          await vi.waitFor(() => expect(editor.value).toBe(expected));
          await new Promise((resolve) => setTimeout(resolve, 1));
        } else {
          const event = gridClipboardEvent("paste", transfer);
          editor.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
        }
        expect(editor.value).toBe(expected);
        expect(notices.slice(noticeStart)).toEqual(fallback ? [createTranslator("en")("notice.clipboardPlainFallback")] : []);
        expect(view.state.doc.toString()).toBe(source);
        expect(undoDepth(view.state)).toBe(0);

        dispatchDraftShortcut(editor, "z");
        expect(editor.value).toBe("Alpha");
        dispatchDraftShortcut(editor, "z", "ctrl", true);
        expect(editor.value).toBe(expected);
        expect(view.state.doc.toString()).toBe(source);
        expect(undoDepth(view.state)).toBe(0);

        editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells[1]!.raw.trim()).toBe(expected);
        expect(undoDepth(view.state)).toBe(1);
        expect(undo(view)).toBe(true);
        expect(view.state.doc.toString()).toBe(source);
      } finally { view.destroy(); }
    },
  );

  it.each([
    { name: "malformed HTML carrier", html: `<table ${TABLE_RANGE_HTML_ATTRIBUTE}="bad"><tr><td>Fallback</td></tr></table>`, type: "", value: "" },
    { name: "non-table carrier attribute", html: `<span ${TABLE_RANGE_HTML_ATTRIBUTE}="bad">Fallback</span>`, type: "", value: "" },
    { name: "document body carrier attribute", html: `<body ${TABLE_RANGE_HTML_ATTRIBUTE}="bad">Fallback</body>`, type: "", value: "" },
    { name: "document html carrier attribute", html: `<html ${TABLE_RANGE_HTML_ATTRIBUTE}="bad"><body>Fallback</body></html>`, type: "", value: "" },
    { name: "malformed custom MIME", html: "<span>Fallback</span>", type: TABLE_RANGE_CLIPBOARD_MIME, value: "bad" },
    { name: "empty web custom MIME", html: "<span>Fallback</span>", type: TABLE_RANGE_CLIPBOARD_WEB_MIME, value: "" },
  ].flatMap((sample) => ["native", "menu"].map((route) => ({ ...sample, route }))))(
    "keeps $name from falling back to draft text through $route", async ({ html, type, value, route }) => {
      const source = "Before\n\n| H | V |\n| --- || --- |\n| A | Alpha |\n\nEnd";
      const transfer = new DataTransfer();
      transfer.setData("text/plain", "Fallback");
      transfer.setData("text/html", html);
      if (type !== "") transfer.setData(type, value);
      const read = vi.fn(async () => [{ types: transfer.types, getType: async (format: string) => new Blob([transfer.getData(format)]) }]);
      vi.stubGlobal("navigator", { clipboard: { read } });
      const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
      const noticeStart = notices.length;
      try {
        mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
        const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
        editor.select();
        if (route === "menu") {
          editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
          clickCurrentMenuItem("Paste", true);
          await vi.waitFor(() => expect(notices).toHaveLength(noticeStart + 1));
        } else {
          const event = gridClipboardEvent("paste", transfer);
          editor.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
        }
        expect(notices.slice(noticeStart)).toEqual([createTranslator("en")("notice.rangeClipboardUnsupported")]);
        expect(editor.value).toBe("Alpha");
        expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 5]);
        expect(editor.isConnected).toBe(true);
        expect(view.state.doc.toString()).toBe(source);
        expect(undoDepth(view.state)).toBe(0);
      } finally { view.destroy(); }
    },
  );

  it.each([false, true])("combines a draft and submenu command atomically; rejected=%s", (rejected) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, rejected ? "$x|y$" : "Changed");
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(view.state.doc.toString()).toBe(source);
      const submenu = lastMenu!.items.find((entry) => entry.title === "Table operations")!.submenu!;
      submenu.items.find((entry) => entry.title === "Insert row below")!.callback!();
      if (rejected) {
        expect(view.state.doc.toString()).toBe(source);
        expect(editor.isConnected).toBe(true);
        expect(editor.value).toBe("$x|y$");
        expect(undo(view)).toBe(false);
      } else {
        expect(view.state.doc.toString()).toContain("Changed");
        expect(parseEditableTables(view.state.doc.toString()).tables[0]!.rows).toHaveLength(3);
        expect(view.state.doc.toString()).toContain("KEEP");
        expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
        expect(undo(view)).toBe(false);
      }
    } finally { view.destroy(); }
  });

  it.each(["success", "denied", "context"] as const)("keeps plain-text menu paste bounded: %s", async (mode) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n\nEnd";
    const readText = vi.fn(async () => { if (mode === "denied") throw new Error("denied"); return "甲 | 乙\n[[Plan]] <br>"; });
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();
      if (mode === "context") { editor.value = "`code`"; editor.setSelectionRange(2, 2); }
      const before = editor.value;
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu!.items.find((entry) => entry.title === "Paste as plain text")!.callback!();
      await vi.waitFor(() => expect(readText).toHaveBeenCalledOnce());
      await Promise.resolve(); await Promise.resolve();
      if (mode !== "success") { expect(editor.value).toBe(before); expect(view.state.doc.toString()).toBe(source); return; }
      expect(editor.value).toContain("&#124;"); expect(editor.value).toContain("<br>");
      lastMenu!.hide(); await new Promise((resolve) => setTimeout(resolve, 1));
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(parseEditableTables(view.state.doc.toString()).tables[0]!.columnCount).toBe(2);
      expect(view.state.doc.toString()).toContain("KEEP");
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); vi.unstubAllGlobals(); }
  });

  it("allows one merged owner for plain-text grid paste and disables multiple owners", async () => {
    const source = "Before\n\n| H | V | X |\n| --- || --- | --- |\n| KEEP | Merged | < |\n| A | B | C |\n\nEnd";
    const readText = vi.fn(async () => "< ^ | literal");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    const { parent, view } = mountEditor(source, { anchor: 0 });
    try {
      const merged = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      merged.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const entry = lastMenu!.items.find((item) => item.title === "Paste as plain text")!;
      expect(entry.disabled).toBe(false);
      entry.callback!(); await vi.waitFor(() => expect(view.state.doc.toString()).toContain("&#124;"));
      const table = parseEditableTables(view.state.doc.toString()).tables[0]!;
      expect(table.rows[1]!.cells[1]!.columnSpan).toBe(2);
      expect(table.rows[1]!.cells[0]!.content).toBe("KEEP");
      const first = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='0']")!;
      dispatchPointerDown(first, "mouse");
      parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!
        .dispatchEvent(new Event("pointerover", { bubbles: true, cancelable: true }));
      window.dispatchEvent(new Event("pointerup"));
      first.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(lastMenu!.items.find((item) => item.title === "Paste as plain text")!.disabled).toBe(true);
    } finally { view.destroy(); vi.unstubAllGlobals(); }
  });

  it.each(["valid", "invalid", "ime"] as const)("safely transfers a cross-table right click: %s", async (kind) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n\nBetween\n\n| H | V |\n| --- || --- |\n| B | OTHER |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      const hosts = parent.querySelectorAll<HTMLElement>(".structural-tables-live-preview");
      mouseGesture(hosts[0]!.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, kind === "invalid" ? "$x|y$" : "Changed A");
      if (kind === "ime") editor.dispatchEvent(new Event("compositionstart", { bubbles: true }));
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      hosts[1]!.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!.dispatchEvent(event);
      await Promise.resolve();
      if (kind !== "valid") { expect(editor.isConnected).toBe(true); expect(view.state.doc.toString()).toBe(source); return; }
      expect(parent.querySelector("textarea")).toBeNull();
      expect(lastMenu?.items.some((entry) => entry.title === "Copy selected cells")).toBe(true);
      expect(parseEditableTables(view.state.doc.toString()).tables[1]!.rows[1]!.cells[0]!.content).toBe("B");
      expect(view.state.doc.toString()).toContain("Changed A");
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source); expect(undo(view)).toBe(false);
    } finally { view.destroy(); }
  });

  it.each((["ltr", "rtl"] as const).flatMap((direction) => (["insert", "move"] as const).map((action) => ({ direction, action }))))("uses table direction for submenu $action: $direction", ({ direction, action }) => {
    const source = "Before\n\n| H | V | X |\n| --- || --- | --- |\n| A | B | C |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    try {
      parent.querySelector<HTMLElement>(".structural-tables-table")!.style.direction = direction;
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!);
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, "Changed B");
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu!.items.find((entry) => entry.title === "Table operations")!.submenu!.items
        .find((entry) => entry.title === (action === "insert" ? "Insert column left" : "Move selected columns left"))!.callback!();
      if (action === "move" && direction === "ltr") {
        expect(view.state.doc.toString()).toBe(source); expect(editor.isConnected).toBe(true);
        expect(editor.value).toBe("Changed B"); expect(undo(view)).toBe(false); return;
      }
      const values = parseEditableTables(view.state.doc.toString()).tables[0]!.rows[1]!.cells.map((cell) => cell.content);
      expect(values).toEqual(action === "move" ? ["A", "C", "Changed B"]
        : direction === "rtl" ? ["A", "Changed B", "", "C"] : ["A", "", "Changed B", "C"]);
      expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("uses committed history from the fresh unchanged draft menu", async () => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | KEEP |\n| Next | Other |\n\nEnd";
    const { parent, view } = mountEditor(source, { anchor: 0 }, [history()]);
    Object.assign(view.state.field(editorInfoField).editor!, { undo: () => undo(view), redo: () => redo(view) });
    try {
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!);
      let editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select(); typeDraftText(editor, "Changed A");
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
      editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      expect(editor.value).toBe("Next");
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu!.items.find((entry) => entry.title === "Undo")!.callback!();
      expect(view.state.doc.toString()).toBe(source);
      await Promise.resolve();
      mouseGesture(parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='0']")!);
      editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      lastMenu!.items.find((entry) => entry.title === "Redo")!.callback!();
      expect(view.state.doc.toString()).toContain("Changed A");
    } finally { view.destroy(); }
  });

});
