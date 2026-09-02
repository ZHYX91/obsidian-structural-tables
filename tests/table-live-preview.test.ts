// @vitest-environment happy-dom

import { EditorState, Prec, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, type App, type Editor, type TFile } from "obsidian";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, type StructuralTablesSettings } from "../src/config/settings";
import type { StructuralTable } from "../src/core/model";
import { StructuralTableEditorController } from "../src/editor/table-live-preview";
import { lastMenu } from "./mocks/obsidian";

interface ObsidianElementOptions {
  cls?: string;
}

class NativeTableWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "test-native-table";
    return element;
  }
}

const screenshotTable = [
  "|  |  |  |  |  |",
  "| --- | --- | --- | --- | --- |",
  "|  |  |  |  |  |",
  "|  |  |  |  |  |",
  "|  |  |  |  | < |",
  "|  |  |  | ^ | ^ |",
].join("\n");

beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: ObsidianElementOptions,
  ): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function createDiv(options?: ObsidianElementOptions): HTMLDivElement {
    return this.createEl("div", options);
  };
});

afterEach(() => {
  document.body.replaceChildren();
});

function mountEditor(
  source: string,
  selection: { anchor: number; head?: number },
  extensions: Extension[] = [],
  promote?: (editor: Editor, sourceFile: TFile | null, table: StructuralTable) => void,
  settingsOverride: Partial<StructuralTablesSettings> = {},
): {
    parent: HTMLElement;
    view: EditorView;
    updateSettings: (update: Partial<StructuralTablesSettings>) => void;
  } {
  let settings = { ...DEFAULT_SETTINGS, ...settingsOverride, enableLivePreview: true };
  const controller = new StructuralTableEditorController(
    {} as App,
    () => settings,
    promote,
  );
  const state = EditorState.create({
    doc: source,
    selection,
    extensions: [
      editorLivePreviewField,
      editorInfoField,
      ...extensions,
      controller.createExtension(),
    ],
  });
  const parent = document.body.appendChild(document.createElement("div"));
  return {
    parent,
    view: new EditorView({ state, parent }),
    updateSettings: (update) => {
      settings = { ...settings, ...update };
      controller.refresh();
    },
  };
}

function dispatchPointerDown(target: HTMLElement, pointerType: "mouse" | "touch"): Event {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    isPrimary: { value: true },
    button: { value: 0 },
    shiftKey: { value: false },
  });
  target.dispatchEvent(event);
  return event;
}

describe("StructuralTableEditorController", () => {
  it("provides block replacements through editor state so opening a Markdown view succeeds", () => {
    const source = [
      "Introduction",
      "",
      "| Region | Sales | < |",
      "| Quarter | Q1 | Q2 |",
      "| --- | --- | --- |",
      "| North | 10 | 12 |",
    ].join("\n");
    const { parent, view } = mountEditor(source, { anchor: 0 });
    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();

    view.destroy();
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

  it("wins an exact-range replacement conflict with an earlier high-priority native decoration", () => {
    const prefix = "Before\n\n";
    const source = `${prefix}${screenshotTable}`;
    const nativeTableField = StateField.define({
      create: () => Decoration.set([
        Decoration.replace({ widget: new NativeTableWidget(), block: true })
          .range(prefix.length, source.length),
      ]),
      update: (value) => value,
      provide: (field) => Prec.high(EditorView.decorations.from(field)),
    });
    const { parent, view } = mountEditor(source, { anchor: 0 }, [nativeTableField]);

    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
    expect(parent.querySelector(".test-native-table")).toBeNull();

    view.destroy();
  });

  it("takes over ordinary GFM tables only while the opt-in setting is enabled", () => {
    const source = "| Name | Status |\n| --- | --- |\n| Alice | Doing |";
    const disabled = mountEditor(source, { anchor: source.length });
    expect(disabled.parent.querySelector(".structural-tables-live-preview")).toBeNull();
    disabled.view.destroy();

    const requested: StructuralTable[] = [];
    const enabled = mountEditor(
      source,
      { anchor: source.length },
      [],
      (_editor, _sourceFile, table) => { requested.push(table); },
      { takeOverOrdinaryTables: true },
    );
    const host = enabled.parent.querySelector<HTMLElement>(".structural-tables-live-preview");
    expect(host?.dataset.tableKind).toBe("ordinary");
    const cell = host?.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']");
    cell?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(lastMenu?.items.map((item) => item.title)).toContain("Upgrade to Base…");
    expect(lastMenu?.items.map((item) => item.title)).toContain("Insert row above");
    lastMenu?.items.find((item) => item.title === "Upgrade to Base…")?.callback?.();
    expect(requested[0]?.structural).toBe(false);

    enabled.updateSettings({ takeOverOrdinaryTables: false });
    expect(enabled.parent.querySelector(".structural-tables-live-preview")).toBeNull();
    expect(enabled.view.state.doc.toString()).toBe(source);
    enabled.view.destroy();
  });

  it("provides row and column handles with the full structural-table menu", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const rows = parent.querySelectorAll<HTMLElement>("[data-structural-row-handle]");
    const columns = parent.querySelectorAll<HTMLElement>("[data-structural-column-handle]");
    expect(rows).toHaveLength(5);
    expect(columns).toHaveLength(5);

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

  it("does not select every handle when a structural cell is selected", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;
    cell.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));

    expect(parent.querySelector(".structural-tables-row-handle.is-selected")).toBeNull();
    expect(parent.querySelector(".structural-tables-column-handle.is-selected")).toBeNull();
    view.destroy();
  });

  it("uses two touch taps for a rectangular selection without suppressing native long press", () => {
    const source = "| A | B |\n| --- || --- |\n| C | D |\n| E | F |";
    const { parent, view } = mountEditor(source, { anchor: source.length });
    const first = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='0']")!;
    const last = parent.querySelector<HTMLElement>("[data-structural-row='2'][data-structural-column='1']")!;

    const firstTap = dispatchPointerDown(first, "touch");
    first.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(firstTap.defaultPrevented).toBe(false);
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.querySelector(".structural-tables-cell-editor")).toBeNull();

    const secondTap = dispatchPointerDown(last, "touch");
    last.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(secondTap.defaultPrevented).toBe(false);
    expect(parent.querySelectorAll("[aria-selected='true']")).toHaveLength(4);

    last.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(lastMenu?.items.map((item) => item.title)).toContain("Merge selected cells");
    view.destroy();
  });

  it("keeps desktop pointer drag ownership separate from touch selection", () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;

    const pointerDown = dispatchPointerDown(cell, "mouse");
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(cell.getAttribute("aria-selected")).toBe("true");
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

  it("edits a Live Preview cell on a desktop click and escapes a pasted Wiki-link pipe", async () => {
    const { parent, view } = mountEditor(screenshotTable, { anchor: screenshotTable.length });
    const cell = parent.querySelector<HTMLElement>("[data-structural-row='0'][data-structural-column='0']")!;
    dispatchPointerDown(cell, "mouse");
    cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const editor = cell.querySelector<HTMLTextAreaElement>(".structural-tables-cell-editor")!;
    expect(editor).not.toBeNull();

    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "[[Target|Alias]]" },
    });
    editor.dispatchEvent(paste);
    expect(editor.value).toBe(String.raw`[[Target\|Alias]]`);
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();

    expect(view.state.doc.toString()).toContain(String.raw`[[Target\|Alias]]`);
    expect(parent.querySelector(".structural-tables-live-preview")).not.toBeNull();
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
