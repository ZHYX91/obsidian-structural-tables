// @vitest-environment happy-dom
import { history, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { parseEditableTables } from "../src/core/parser";
import { lastMenu, notices } from "./mocks/obsidian";
import { clickLikeUser } from "./helpers/host-gestures";
import { createPopoutFrame } from "./helpers/popout-frame";
import {
  mountEditor,
  clickCurrentMenuItem,
} from "./helpers/live-preview-editor";

describe("whole-table transpose from an owned grid", () => {
  it("targets the full table from a row handle and isolates its undo/redo transaction", () => {
    const original = [
      "| Region | Q1 | Q2 |",
      "| --- || --- | --- |",
      "| North | 1 | 2 |",
      "| South | 3 | 4 |",
      "| East | 5 | 6 |",
    ].join("\n");
    const source = "Before\n\n" + original + "\n\nAfter";
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history()]);
    try {
      const handle = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']");
      expect(handle).not.toBeNull();
      handle!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      const transpose = lastMenu?.items.find((item) => item.title === "Transpose whole table (swap rows and columns)");
      expect(transpose?.section).toBe("structural-tables-transform");
      clickCurrentMenuItem("Transpose whole table (swap rows and columns)", true);
      const modified = view.state.doc.toString();
      expect(modified).not.toBe(source);
      const table = parseEditableTables(modified).tables[0]!;
      expect(table.valid).toBe(true);
      expect(table.rows.length).toBe(3);
      expect(table.columnCount).toBe(4);
      expect(table.headerRowCount).toBe(1);
      expect(table.rowHeaderColumnCount).toBe(1);
      expect(table.rows[1]!.cells[2]!.content).toBe("3");
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(modified);
    } finally {
      view.destroy();
    }
  });
});

describe("whole-table transpose confirmation and source revalidation", () => {
  const tableSource = [
    "| Region | Q1 | Q2 |",
    "| :--- || ---: | :---: |",
    "| North | 1 | 2 |",
    "| South | 3 | 4 |",
  ].join("\n");
  const original = "Before\n\n" + tableSource + "\n\nAfter";

  function openConfirmation(parent: HTMLElement): HTMLButtonElement {
    const handle = parent.querySelector<HTMLElement>("[data-structural-row-handle='1']");
    expect(handle).not.toBeNull();
    handle!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    clickCurrentMenuItem("Transpose whole table (swap rows and columns)", true);
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((element) => element.textContent === "Transpose anyway");
    expect(button).toBeDefined();
    return button!;
  }

  it("allows pointerdown on a risk modal without expiring the whole-table write", () => {
    const { parent, view } = mountEditor(original, { anchor: original.length }, [history()]);
    try {
      const button = openConfirmation(parent);
      expect(view.state.doc.toString()).toBe(original);
      clickLikeUser(button);
      const source = view.state.doc.toString();
      expect(source).not.toBe(original);
      expect(source).toContain("Before\n\n");
      expect(source).toContain("\n\nAfter");
      const table = parseEditableTables(source).tables[0]!;
      expect(table.valid).toBe(true);
      expect(table.rows.length).toBe(3);
      expect(table.columnCount).toBe(3);
      expect(table.headerRowCount).toBe(1);
      expect(table.rowHeaderColumnCount).toBe(1);
      expect(table.alignments).toEqual(["default", "default", "default"]);
      expect(undo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(original);
      expect(redo(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(source);
    } finally { view.destroy(); }
  });

  it("refuses the original owned confirmation after its connected editor is adopted into another document", () => {
    let writes = 0;
    const { parent, view } = mountEditor(original, { anchor: original.length }, [history(), EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; })]);
    try {
      const button = openConfirmation(parent);
      const undoBefore = undoDepth(view.state);
      const frame = createPopoutFrame();
      frame.contentDocument!.body.appendChild(parent);
      expect(parent.isConnected).toBe(true); expect(parent.ownerDocument).toBe(frame.contentDocument);
      clickLikeUser(button);
      expect(view.state.doc.toString()).toBe(original); expect(writes).toBe(0); expect(undoDepth(view.state)).toBe(undoBefore);
    } finally { view.destroy(); }
  });

  it("refuses an owned transpose that would consume preceding pipe prose without a transaction", () => {
    const source = "| P | Q | R |\n| H1 | H2 |\n| --- || --- |\n| A | B |\n| C | D |";
    let writes = 0;
    const { parent, view } = mountEditor(source, { anchor: source.length }, [history(), EditorView.updateListener.of((update) => { if (update.docChanged) writes += 1; })]);
    try {
      parent.querySelector<HTMLElement>("[data-structural-row-handle='1']")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
      clickCurrentMenuItem("Transpose whole table (swap rows and columns)", true);
      expect(view.state.doc.toString()).toBe(source); expect(writes).toBe(0); expect(undoDepth(view.state)).toBe(0);
      expect(notices[notices.length - 1]).toContain("blank line");
    } finally { view.destroy(); }
  });

  it("refuses a real source edit made while confirmation was open", () => {
    const { parent, view } = mountEditor(original, { anchor: original.length }, [history()]);
    try {
      const button = openConfirmation(parent);
      const start = view.state.doc.toString().indexOf("North");
      view.dispatch({ changes: { from: start, to: start + "North".length, insert: "East" } });
      const edited = view.state.doc.toString();
      clickLikeUser(button);
      expect(view.state.doc.toString()).toBe(edited);
      expect(view.state.doc.toString()).toContain("East");
      expect(view.state.doc.toString()).toContain("| :--- || ---: | :---: |");
    } finally { view.destroy(); }
  });
});
