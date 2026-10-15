import { history, historyKeymap, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { App, Component, MarkdownRenderer, MarkdownView, Menu, editorInfoField, editorLivePreviewField, type Editor, type EditorPosition, type TFile as HostFile } from "obsidian";

import { DEFAULT_SETTINGS } from "../../src/config/settings";
import { parseEditableTables } from "../../src/core/parser";
import { NativeTableMenuBridge } from "../../src/editor/native-table-menu";
import { StructuralTableEditorController } from "../../src/editor/table-live-preview";
import { openEditorTableTranspose } from "../../src/editor/table-transpose-target";
import { createTranslator } from "../../src/config/i18n";
import { lastMenu, notices, TFile } from "../mocks/obsidian";

type ElementOptions = { cls?: string; text?: string };
HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ElementOptions): HTMLElementTagNameMap[K] {
  const node = this.ownerDocument.createElement(tag);
  if (options?.text !== undefined) node.textContent = options.text;
  if (options?.cls !== undefined) node.className = options.cls;
  this.appendChild(node);
  return node;
};
HTMLElement.prototype.createDiv = function createDiv(options?: ElementOptions): HTMLDivElement { return this.createEl("div", options); };
HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
HTMLElement.prototype.setCssProps = function setCssProps(props: Record<string, string>): void {
  for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
};
MarkdownRenderer.render = async (_app, source, target) => { target.textContent = source; };

const original = "Before stays.\n\n| Name | Value |\n| --- | --- |\n| North | 1 |\n\nAfter stays.";
const tall = [
  "Before stays.", "", "| Region | Sales | < | Q3 | Q4 |", "| --- | --- | --- | --- | --- |",
  ...Array.from({ length: 22 }, (_, row) => `| ${row % 2 === 0 ? `Region ${row / 2}` : "^"} | ${row} | value | more | last |`),
  "", "",
].join("\n");
let cm: EditorView | null = null;
let other: EditorView | null = null;
let component: Component | null = null;
let changes = 0;
let pointers = 0;
let beforeTranspose = "";
let initialSource = "";
let interfaceLanguage: "en" | "ar" = "en";
let currentView: MarkdownView | null = null;
let files = new Map<string, TFile>();

document.addEventListener("pointerdown", () => { pointers += 1; }, { capture: true });
// The host mock contributes real menu buttons while product code still builds
// and validates its public menu. Chromium supplies pointer/focus/click ordering.
document.addEventListener("contextmenu", () => {
  setTimeout(() => {
    document.querySelector("#host-menu")?.remove();
    const menu = lastMenu;
    const t = createTranslator(interfaceLanguage);
    const actions = [["transpose-menu-item", "menu.transposeTable"], ["menu-insert-left", "menu.insertColumnLeft"],
      ["menu-insert-right", "menu.insertColumnRight"], ["menu-move-left", "menu.moveColumnsLeft"], ["menu-move-right", "menu.moveColumnsRight"]] as const;
    const wrapper = document.body.createDiv(); wrapper.id = "host-menu";
    for (const [id, key] of actions) {
      const item = menu?.items.find((candidate) => candidate.title === t(key));
      if (item === undefined) continue;
      const button = wrapper.createEl("button", { text: item.title }); button.id = id; button.style.display = "block";
      button.onclick = () => { item.callback?.(); menu?.hide(); wrapper.remove(); };
    }
  });
}, true);

function reset(mode: "owned" | "source" | "native" | "popout-source" | "popout-draft" | "rtl" | "ltr-arabic" | "rtl-ascii-draft" | "ltr-arabic-draft" | "ltr-mixed-draft" | "focus" | "focus-after" | "focus-canceled"): void {
  component?.unload(); cm?.destroy(); other?.destroy();
  document.body.replaceChildren(); notices.length = 0; changes = 0; pointers = 0;
  files = new Map(); component = new Component();
  const file = new TFile("A.md"); files.set(file.path, file);
  const frame = mode.startsWith("popout-") ? document.body.appendChild(document.createElement("iframe")) : null;
  const doc = frame?.contentWindow?.document ?? document;
  const containerEl = doc.body.appendChild(doc.createElement("div")); containerEl.id = "target-note";
  const bidi = mode === "rtl" || mode.startsWith("ltr-") || mode === "rtl-ascii-draft";
  containerEl.dir = mode.startsWith("rtl") ? "rtl" : "ltr";
  interfaceLanguage = mode.startsWith("ltr-") ? "ar" : "en";
  const posToOffset = (position: EditorPosition): number => cm!.state.doc.line(position.line + 1).from + position.ch;
  const offsetToPos = (offset: number): EditorPosition => {
    const line = cm!.state.doc.lineAt(offset); return { line: line.number - 1, ch: offset - line.from };
  };
  const editor = {
    getValue: () => cm!.state.doc.toString(), getCursor: () => offsetToPos(cm!.state.selection.main.head),
    getLine: (line: number) => cm!.state.doc.line(line + 1).text,
    posToOffset, offsetToPos,
    replaceRange: (insert: string, from: EditorPosition, to: EditorPosition) => cm!.dispatch({ changes: { from: posToOffset(from), to: posToOffset(to), insert } }),
    setCursor: (position: EditorPosition) => cm!.dispatch({ selection: { anchor: posToOffset(position) } }),
    undo: () => undo(cm!), redo: () => redo(cm!),
  } as unknown as Editor;
  const app = Object.assign(new App(), {
    vault: { getFileByPath: (path: string) => files.get(path) ?? null },
    workspace: {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => { if (currentView !== null) callback({ view: currentView }); },
      on: () => ({}),
    },
  }) as unknown as App;
  const owned = bidi || ["owned", "focus", "focus-after", "focus-canceled"].includes(mode);
  const focus = mode.startsWith("focus");
  const settings = { ...DEFAULT_SETTINGS, language: interfaceLanguage, takeOverOrdinaryTables: true };
  const controller = new StructuralTableEditorController(app, () => settings);
  const value = mode === "ltr-arabic-draft" || mode === "ltr-arabic" ? "مرحبا" : mode === "ltr-mixed-draft" ? "ABC مرحبا 123" : "ABC";
  const source = focus ? tall + (mode === "focus-after" ? "After the table." : "") : bidi
    ? `Before stays.\n\n| Region | A | B | C |\n| --- || --- | --- | --- |\n| North | ${value} | Two | Three |\n| South | Four | Five | Six |\n\nAfter stays.` : original;
  initialSource = source;
  cm = new EditorView({ parent: containerEl, state: EditorState.create({ doc: source, extensions: [
    history(), keymap.of(historyKeymap), editorInfoField.init(() => ({ editor, file: file as unknown as HostFile, app, hoverPopover: null })), editorLivePreviewField.init(() => owned),
    controller.createExtension(), EditorView.updateListener.of((update) => { if (update.docChanged) changes += 1; }),
  ] }) });
  other = new EditorView({ parent: document.body.createDiv(), state: EditorState.create({ doc: "Other file stays.", extensions: [history()] }) });
  other.dom.style.display = "none";
  currentView = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { containerEl, editor, file });
  if (!focus) {
    const offset = source.indexOf("North") + 5;
    cm.dispatch({ changes: { from: offset, insert: "X" }, selection: { anchor: owned ? 0 : offset + 1 }, annotations: Transaction.userEvent.of("input.type") });
  }
  beforeTranspose = cm.state.doc.toString(); changes = 0;
  if (mode === "source" || mode.startsWith("popout-")) {
    if (mode === "popout-draft") {
      const draft = containerEl.appendChild(doc.createElement("textarea")); draft.className = "structural-tables-cell-editor"; draft.value = "unsaved";
    }
    const button = document.body.createEl("button", { text: "Transpose source table" }); button.id = "transpose-source";
    button.onclick = () => openEditorTableTranspose(app, editor, parseEditableTables(editor.getValue()).tables[0]!, createTranslator("en"), currentView!);
  } else if (mode === "native") {
    const native = containerEl.createDiv({ cls: "cm-table-widget" });
    native.innerHTML = "<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>NorthX</td><td>1</td></tr></tbody></table>";
    native.addEventListener("contextmenu", (event) => { Menu.forEvent(event).addItem((item) => item.setTitle("Native action")); event.preventDefault(); });
    new NativeTableMenuBridge(app, () => settings, () => {}).register(component);
  }
  if (focus) cm.dispatch({ effects: EditorView.scrollIntoView(cm.state.doc.length, { y: "end" }) });
}

function switchFile(): void {
  const file = new TFile("B.md"); files.set(file.path, file);
  if (currentView !== null) currentView.file = file as unknown as HostFile;
}

function result() {
  const source = cm!.state.doc.toString();
  const table = document.querySelector<HTMLTableElement>(".structural-tables-live-preview table");
  const draft = document.querySelector<HTMLTextAreaElement>("textarea.structural-tables-cell-editor");
  const active = cm!.dom.ownerDocument.activeElement as HTMLElement | null;
  return {
    source, initialSource, beforeTranspose, changes, pointers, undoDepth: undoDepth(cm!.state), otherSource: other!.state.doc.toString(),
    editorFocused: cm!.dom.contains(cm!.dom.ownerDocument.activeElement),
    contentFocused: cm!.dom.ownerDocument.activeElement === cm!.contentDOM,
    rowHeaders: parseEditableTables(source).tables[0]?.rowHeaderColumnCount ?? -1,
    tableDirection: table === null ? null : getComputedStyle(table).direction,
    rowValues: parseEditableTables(source).tables[0]?.rows[1]?.cells.map((cell) => cell.content),
    cellLefts: [0, 1, 2, 3].map((column) => table?.querySelector(`[data-structural-row="1"][data-structural-column="${column}"]`)?.getBoundingClientRect().left ?? null),
    activeColumn: active?.dataset.structuralColumn ?? active?.closest<HTMLElement>("[data-structural-column]")?.dataset.structuralColumn,
    draftStart: draft?.selectionStart, draftEnd: draft?.selectionEnd, draftValue: draft?.value,
    confirmationVisible: [...document.querySelectorAll("button")].some((button) => button.textContent === "Transpose anyway"),
    selectedCells: document.querySelectorAll(".structural-tables-live-preview [aria-selected='true']").length,
    draft: document.querySelector("textarea.structural-tables-cell-editor") !== null,
    tableHeight: table?.getBoundingClientRect().height ?? 0, spans: table?.querySelectorAll("[rowspan='2']").length ?? 0,
    scrollTop: cm!.scrollDOM.scrollTop, anchor: cm!.state.selection.main.anchor, head: cm!.state.selection.main.head,
    notices: [...notices],
  };
}

(window as typeof window & { transposeBrowser?: unknown }).transposeBrowser = { reset, switchFile, result };
