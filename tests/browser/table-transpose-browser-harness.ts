import { history, historyKeymap, redo, undo, undoDepth } from "@codemirror/commands";
import { EditorState, StateEffect, Transaction } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { App, Component, MarkdownRenderer, MarkdownView, Menu, editorInfoField, editorLivePreviewField, type Editor, type EditorPosition, type TFile as HostFile } from "obsidian";

import { DEFAULT_SETTINGS } from "../../src/config/settings";
import { parseEditableTables } from "../../src/core/parser";
import { editCellContent } from "../../src/core/operations";
import { tableRenderingComplete } from "../../src/rendering/table-renderer";
import { NativeTableMenuBridge } from "../../src/editor/native-table-menu";
import { StructuralTableEditorController } from "../../src/editor/table-live-preview";
import { openEditorTableTranspose } from "../../src/editor/table-transpose-target";
import { applyInterfaceLocale, createTranslator } from "../../src/config/i18n";
import { appendDisplayPath, appendDisplayValue } from "../../src/config/interface-bidi";
import { basePropertyMigrationPreviewText, type BasePropertyMigrationLabels } from "../../src/app/base-property-migration-modal";
import type { PreparedBasePropertyMigration } from "../../src/app/base-property-migration-service";
import { structuralTableLogicalCursorSync, structuralTableSourceFocus } from "../../src/editor/table-source-focus";
import { lastMenu, notices, TFile } from "../mocks/obsidian";
import { NativeCellEditorWidget } from "../helpers/native-cell-editor";
import { NativeTableWidget } from "../helpers/native-table-widget";

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
MarkdownRenderer.render = async (_app, source, target) => {
  if (holdCommitRendering && changes > 0) await new Promise<void>((resolve) => heldRenders.push(resolve));
  if (delayedCommitRendering && changes > 0) await new Promise((resolve) => setTimeout(resolve, 60));
  if (alignmentCase === null) target.textContent = source;
  else {
    const paragraph = target.createEl("p", { text: source === alignmentCase.raw ? alignmentCase.visible : source });
    paragraph.dir = "auto"; paragraph.style.unicodeBidi = "plaintext";
  }
};

const original = "Before stays.\n\n| Name | Value |\n| --- | --- |\n| North | 1 |\n\nAfter stays.";
const tall = [
  "Before stays.", "", "| Region | Sales | < | Q3 | Q4 |", "| --- | --- | --- | --- | --- |",
  ...Array.from({ length: 22 }, (_, row) => `| ${row % 2 === 0 ? `Region ${row / 2}` : "^"} | ${row} | value | more | last |`),
  "", "",
].join("\n");
const wrapped = ["Before stays.", "", "| Day | Group | Main | Side | Notes |", "| --- || --- | --- | --- | --- |",
  ...Array.from({ length: 7 }, (_, index) => [`| Day ${index + 1} | Meal A | Long seasonal vegetable and grain combination ${index + 1} | Fresh greens | Reviewed |`,
    `| ^ | Meal B | Roasted vegetables with rice ${index + 1} | Beans | ^ |`, `| ^ | ^ | Stir fried peppers ${index + 1} | ^ | Garden salad |`]).flat(), "", ""].join("\n");
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
const focusTrace: string[] = [];
const commitGeometry: Array<{ height: number; scrollTop: number; empty: boolean }> = [];
let traceFocus = false;
let delayedCommitRendering = false;
let replacementDraft = "last-cell-final-longx";
let holdCommitRendering = false;
const heldRenders: Array<() => void> = [];
let detachedParent: HTMLElement | null = null;
interface AlignmentCase { direction: "ltr" | "rtl"; raw: string; visible: string; alignment: "default" | "left" | "center" | "right"; role: "body" | "column" | "row" }
let alignmentCase: AlignmentCase | null = null;
new MutationObserver(() => {
  if (!traceFocus || changes !== 1 || cm === null) return;
  const host = document.querySelector<HTMLElement>(".structural-tables-live-preview");
  if (host !== null) {
    const sample = { height: host.getBoundingClientRect().height, scrollTop: cm.scrollDOM.scrollTop,
      empty: [...host.querySelectorAll(".structural-tables-cell-content")].every((cell) => cell.textContent === "") };
    if (JSON.stringify(sample) !== JSON.stringify(commitGeometry[commitGeometry.length - 1])) commitGeometry.push(sample);
  }
}).observe(document.body, { childList: true, subtree: true });
for (const type of ["pointerdown", "pointerup", "touchstart", "touchend", "focusin", "mousedown", "click", "dblclick", "selectionchange"]) document.addEventListener(type, (event) => {
  if (traceFocus && cm !== null) focusTrace.push(type + ":" + (event.target as HTMLElement).tagName + ":" + cm.state.selection.main.head
    + ":" + document.querySelectorAll(".structural-tables-live-preview").length + ":detail=" + (event as MouseEvent).detail
    + ":native=" + document.getSelection()?.anchorOffset + "," + document.getSelection()?.focusOffset);
}, true);

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

function reset(mode: "owned" | "source" | "native" | "native-child" | "popout-source" | "popout-draft" | "rtl" | "ltr-arabic" | "rtl-ascii-draft" | "ltr-arabic-draft" | "ltr-mixed-draft" | "focus" | "focus-after" | "focus-canceled" | `focus-wide${string}`): void {
  component?.unload(); cm?.destroy(); other?.destroy();
  document.body.replaceChildren(); notices.length = 0; changes = 0; pointers = 0;
  alignmentCase = null;
  holdCommitRendering = false; heldRenders.splice(0).forEach((resolve) => resolve()); detachedParent = null;
  focusTrace.length = 0; traceFocus = mode.startsWith("focus-wide");
  commitGeometry.length = 0;
  delayedCommitRendering = mode.includes("blank") || mode.includes("mouse");
  replacementDraft = mode.includes("shrink") ? "QA" : delayedCommitRendering ? "Stir fried peppers 7 QA" : "last-cell-final-longx";
  files = new Map(); component = new Component();
  const file = new TFile("A.md"); files.set(file.path, file);
  const frame = mode.startsWith("popout-") ? document.body.appendChild(document.createElement("iframe")) : null;
  const doc = frame?.contentWindow?.document ?? document;
  const containerEl = doc.body.appendChild(doc.createElement("div")); containerEl.id = "target-note";
  const bidi = mode === "rtl" || mode.startsWith("ltr-") || mode === "rtl-ascii-draft";
  containerEl.dir = mode.startsWith("rtl") || mode.endsWith("-rtl") ? "rtl" : "ltr";
  if (mode.startsWith("focus-wide")) containerEl.style.width = "340px";
  if (delayedCommitRendering) containerEl.classList.add("host-box-sizing");
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
  const owned = bidi || mode === "owned" || mode.startsWith("focus");
  const focus = mode.startsWith("focus");
  const settings = { ...DEFAULT_SETTINGS, language: interfaceLanguage, takeOverOrdinaryTables: true };
  const controller = new StructuralTableEditorController(app, () => settings);
  const value = mode === "ltr-arabic-draft" || mode === "ltr-arabic" ? "مرحبا" : mode === "ltr-mixed-draft" ? "ABC مرحبا 123" : "ABC";
  const focusTable = delayedCommitRendering ? wrapped
    : mode.startsWith("focus-wide") ? tall.replace(/more/gu, "middle-value-long").replace(/last/gu, "last-cell-final-long") : tall;
  const source = focus ? focusTable
    + (mode === "focus-after" || mode.startsWith("focus-wide") ? "After the table." : "") : bidi
    ? `Before stays.\n\n| Region | A | B | C |\n| --- || --- | --- | --- |\n| North | ${value} | Two | Three |\n| South | Four | Five | Six |\n\nAfter stays.` : original;
  initialSource = source;
  cm = new EditorView({ parent: containerEl, state: EditorState.create({ doc: source, extensions: [
    ...(delayedCommitRendering ? [EditorView.lineWrapping] : []),
    history(), keymap.of(historyKeymap), editorInfoField.init(() => ({ editor, file: file as unknown as HostFile, app, hoverPopover: null })), editorLivePreviewField.init(() => owned),
    controller.createExtension(), EditorView.updateListener.of((update) => {
      if (update.docChanged) changes += 1;
      if (traceFocus) for (const tr of update.transactions) focusTrace.push("update:" + tr.state.selection.main.head + ":" + tr.effects.map((effect) =>
        effect.is(structuralTableSourceFocus) ? "source=" + effect.value : effect.is(structuralTableLogicalCursorSync) ? "logical" : "other").join(",")
        + ":hosts=" + update.view.dom.querySelectorAll(".structural-tables-live-preview").length);
    }),
  ] }) });
  if (mode.startsWith("focus-wide")) { cm.contentDOM.style.minWidth = "0"; cm.contentDOM.style.width = "100%"; }
  if (delayedCommitRendering) { cm.contentDOM.style.paddingBottom = "100px"; cm.dom.style.setProperty("--table-width", "404px"); }
  if (mode.includes("above")) cm.contentDOM.style.paddingTop = "100px";
  other = new EditorView({ parent: document.body.createDiv(), state: EditorState.create({ doc: "Other file stays.", extensions: [history()] }) });
  other.dom.style.display = "none";
  currentView = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { containerEl, editor, file });
  if (!focus) {
    const offset = source.indexOf("North") + 5;
    cm.dispatch({ changes: { from: offset, insert: "X" }, selection: { anchor: owned ? 0 : offset + 1 }, annotations: Transaction.userEvent.of("input.type") });
  }
  beforeTranspose = cm.state.doc.toString(); changes = 0;
  if (mode === "native-child") {
    const table = parseEditableTables(beforeTranspose).tables[0]!;
    const widget = new NativeCellEditorWidget("NorthX");
    cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set([
      Decoration.replace({ widget, block: true }).range(table.range.from, table.range.to),
    ]))) });
    widget.child!.focus();
  }
  if (mode === "source" || mode === "native-child" || mode.startsWith("popout-")) {
    if (mode === "popout-draft") {
      const draft = containerEl.appendChild(doc.createElement("textarea")); draft.className = "structural-tables-cell-editor"; draft.value = "unsaved";
    }
    const button = document.body.createEl("button", { text: "Transpose source table" }); button.id = "transpose-source";
    button.onclick = () => openEditorTableTranspose(app, editor, parseEditableTables(editor.getValue()).tables[0]!, createTranslator("en"), currentView!);
  } else if (mode === "native") {
    const table = parseEditableTables(beforeTranspose).tables[0]!;
    cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set([
      Decoration.replace({ widget: new NativeTableWidget(table, true), block: true }).range(table.range.from, table.range.to),
    ]))) });
    const native = cm.dom.querySelector<HTMLElement>(".cm-table-widget")!;
    native.addEventListener("contextmenu", (event) => { Menu.forEvent(event).addItem((item) => item.setTitle("Native action")); event.preventDefault(); });
    new NativeTableMenuBridge(app, () => settings, () => {}).register(component);
  }
  if (focus) cm.dispatch({ effects: EditorView.scrollIntoView(cm.state.doc.length, { y: "end" }) });
}

function switchFile(): void {
  const file = new TFile("B.md"); files.set(file.path, file);
  if (currentView !== null) currentView.file = file as unknown as HostFile;
}

function interfaceBidi() {
  const surface = document.body.createDiv(); applyInterfaceLocale(surface, "ar");
  const label = surface.createEl("p"); label.textContent = createTranslator("ar")("menu.useMathAbsoluteSuggestion");
  const text = label.firstChild!;
  const characterLeft = (fragment: string): number => {
    const start = label.textContent!.indexOf(fragment); const range = document.createRange();
    range.setStart(text, start); range.setEnd(text, start + 1); return range.getBoundingClientRect().left;
  };
  const path = appendDisplayPath(surface.createEl("p"), "ملاحظات/تقارير/ملخص-2026.md");
  const mapping = surface.createEl("p", { cls: "structural-tables-bidi-isolate" }); mapping.dir = "ltr";
  const name = appendDisplayValue(mapping, "عنوان عربي"); mapping.append(" → "); const key = appendDisplayValue(mapping, "latinKey");
  const code = surface.createEl("code", { text: String.raw`\lvert … \rvert` });
  const t = createTranslator("ar");
  const labels: BasePropertyMigrationLabels = { language: "ar", title: t("modal.migrateBaseProperties.title"), description: t("modal.migrateBaseProperties.desc"),
    membershipNotes: t("modal.migrateBaseProperties.membershipNotes"), promotedBases: t("modal.migrateBaseProperties.promotedBases"),
    retiredRecordIdCandidates: t("modal.migrateBaseProperties.retiredRecordIdCandidates"), retiredRecordIds: t("modal.migrateBaseProperties.retiredRecordIds"),
    removeRecordIds: t("modal.migrateBaseProperties.removeRecordIds"), removeRecordIdsDescription: t("modal.migrateBaseProperties.removeRecordIdsDesc"),
    cancel: t("modal.cancel"), confirm: t("modal.migrateBaseProperties.confirm") };
  const prepared: PreparedBasePropertyMigration = { membershipNoteCount: 1, legacyBaseCount: 2, legacyRecordIdCount: 1, files: [{
    file: new TFile("ملاحظات/تقارير/ملخص-2026.md") as unknown as HostFile, path: "ملاحظات/تقارير/ملخص-2026.md", originalSource: "Original source",
    migrateMembership: true, legacyBaseCount: 2, hasLegacyRecordId: true, membershipIds: ["stb_people"], currentMembershipPresent: false,
    currentMembershipValue: undefined, legacyMembershipValue: ["stb_people"], legacyRecordIdValue: "str_alice",
  }] };
  const migrationPathLefts = [false, true].map((cleanup) => {
    const preview = surface.createEl("pre", { text: basePropertyMigrationPreviewText(prepared, labels, cleanup) });
    const pathStart = preview.textContent!.lastIndexOf("\n- ") + 3;
    return ["ملاحظات", "تقارير", "ملخص-2026.md"].map((fragment) => {
      const start = preview.textContent!.indexOf(fragment, pathStart); const range = document.createRange();
      range.setStart(preview.firstChild!, start); range.setEnd(preview.firstChild!, start + fragment.length); return range.getBoundingClientRect().left;
    });
  });
  return { technicalLefts: [characterLeft(String.raw`\lvert`), characterLeft(String.raw`\rvert`)],
    pathText: path.textContent, pathLefts: [...path.querySelectorAll("bdi")].map((part) => part.getBoundingClientRect().left),
    mappingLefts: [name.getBoundingClientRect().left, key.getBoundingClientRect().left], mappingIsolation: getComputedStyle(mapping).unicodeBidi,
    codeDirection: getComputedStyle(code).direction, migrationPathLefts };
}

function result() {
  const source = cm!.state.doc.toString();
  const initialTable = parseEditableTables(initialSource).tables[0]!;
  const cellEdit = traceFocus ? editCellContent(initialTable, initialTable.rows.length - 1, delayedCommitRendering ? 2 : 4, replacementDraft) : null;
  const table = document.querySelector<HTMLTableElement>(".structural-tables-live-preview table");
  const draft = document.querySelector<HTMLTextAreaElement>("textarea.structural-tables-cell-editor");
  const active = cm!.dom.ownerDocument.activeElement as HTMLElement | null;
  return {
    source, initialSource, beforeTranspose, changes, pointers, undoDepth: undoDepth(cm!.state), otherSource: other!.state.doc.toString(),
    expectedEditedSource: cellEdit === null ? null : initialSource.slice(0, initialTable.range.from) + cellEdit.source + initialSource.slice(initialTable.range.to),
    lastClickDetail: traceFocus ? Number(focusTrace.filter((entry) => entry.startsWith("click:")).slice(-1)[0]?.match(/:detail=(\d+)/u)?.[1]) : null,
    editorFocused: cm!.dom.contains(cm!.dom.ownerDocument.activeElement),
    contentFocused: cm!.dom.ownerDocument.activeElement === cm!.contentDOM,
    rowHeaders: parseEditableTables(source).tables[0]?.rowHeaderColumnCount ?? -1,
    tableDirection: table === null ? null : getComputedStyle(table).direction,
    rowValues: parseEditableTables(source).tables[0]?.rows[1]?.cells.map((cell) => cell.content),
    lastValue: parseEditableTables(source).tables[0]?.rows.slice(-1)[0]?.cells[delayedCommitRendering ? 2 : 4]?.content,
    cellLefts: [0, 1, 2, 3].map((column) => table?.querySelector(`[data-structural-row="1"][data-structural-column="${column}"]`)?.getBoundingClientRect().left ?? null),
    activeColumn: active?.dataset.structuralColumn ?? active?.closest<HTMLElement>("[data-structural-column]")?.dataset.structuralColumn,
    draftStart: draft?.selectionStart, draftEnd: draft?.selectionEnd, draftValue: draft?.value,
    confirmationVisible: [...document.querySelectorAll("button")].some((button) => button.textContent === "Transpose anyway"),
    selectedCells: document.querySelectorAll(".structural-tables-live-preview [aria-selected='true']").length,
    draft: document.querySelector("textarea.structural-tables-cell-editor") !== null,
    tableHeight: table?.getBoundingClientRect().height ?? 0, spans: table?.querySelectorAll("[rowspan='2']").length ?? 0,
    hostHeight: table?.closest(".structural-tables-live-preview")?.getBoundingClientRect().height ?? 0,
    reservedHeight: table?.closest<HTMLElement>(".structural-tables-live-preview")?.style.minHeight ?? null,
    blockHeight: cm!.lineBlockAt(initialTable.range.from).height,
    tableStyle: table === null ? null : { width: table.getBoundingClientRect().width, layout: getComputedStyle(table).tableLayout,
      whiteSpace: getComputedStyle(table.querySelector(".structural-tables-cell-content")!).whiteSpace, parentClass: table.closest("#target-note")?.className },
    scrollTop: cm!.scrollDOM.scrollTop, anchor: cm!.state.selection.main.anchor, head: cm!.state.selection.main.head,
    horizontalScroll: table?.parentElement?.scrollLeft ?? 0,
    horizontalOverflow: (table?.parentElement?.scrollWidth ?? 0) - (table?.parentElement?.clientWidth ?? 0),
    focusTrace: [...focusTrace],
    commitGeometry: [...commitGeometry],
    notices: [...notices],
  };
}

function setupAlignment(input: AlignmentCase): void {
  reset(input.direction === "rtl" ? "rtl" : "ltr-arabic"); alignmentCase = input;
  const delimiter = { default: "---", left: ":---", center: ":---:", right: "---:" }[input.alignment];
  const header = input.role === "column" ? input.raw : "Column";
  const row = input.role === "row" ? input.raw : "Row";
  const value = input.role === "body" ? input.raw : "Value";
  const source = `Before.\n\n| Header | ${header} |\n| ${delimiter} || ${delimiter} |\n| ${row} | ${value} |\n\nAfter.`;
  initialSource = source;
  cm!.dom.parentElement!.classList.add("alignment-surface"); cm!.dom.parentElement!.style.width = "640px";
  cm!.dom.style.setProperty("--table-width", "560px");
  cm!.dispatch({ changes: { from: 0, to: cm!.state.doc.length, insert: source }, selection: { anchor: 0 }, effects: structuralTableSourceFocus.of(false) });
  changes = 0;
}

function alignmentState() {
  const row = alignmentCase!.role === "column" ? 0 : 1; const column = alignmentCase!.role === "row" ? 0 : 1;
  const cell = cm!.dom.querySelector<HTMLElement>(`[data-structural-row="${row}"][data-structural-column="${column}"]`)!;
  const paragraph = cell.querySelector("p")!; const range = document.createRange(); range.selectNodeContents(paragraph);
  const rect = range.getBoundingClientRect(); const editor = cell.querySelector<HTMLTextAreaElement>("textarea");
  const bounds = editor?.getBoundingClientRect();
  let nativeDirection: string | null = null;
  if (editor !== null) {
    const native = document.body.appendChild(document.createElement("textarea")); native.dir = "auto"; native.value = editor.value;
    nativeDirection = getComputedStyle(native).direction; native.remove();
  }
  return { row, column, source: cm!.state.doc.toString(), changes, rendered: { left: rect.left, right: rect.right, direction: getComputedStyle(paragraph).direction },
    editor: editor === null ? null : { direction: getComputedStyle(editor).direction, nativeDirection, align: getComputedStyle(editor).textAlign, dir: editor.dir, value: editor.value,
      bounds: { x: bounds!.left + 2, y: bounds!.top + 2, width: bounds!.width - 4, height: bounds!.height - 4, scale: 1 } } };
}

(window as typeof window & { transposeBrowser?: unknown }).transposeBrowser = { reset, switchFile, result, interfaceBidi, setupAlignment, alignmentState,
  refresh: () => cm!.dispatch({ effects: structuralTableSourceFocus.of(true) }),
  holdRendering: () => { holdCommitRendering = true; },
  releaseRendering: () => { holdCommitRendering = false; heldRenders.splice(0).forEach((resolve) => resolve()); },
  detach: () => { detachedParent = cm!.dom.parentElement!; detachedParent.remove(); },
  detachedStyle: () => cm!.dom.querySelector<HTMLElement>(".structural-tables-live-preview")?.style.minHeight ?? null,
  reattach: () => { document.body.prepend(detachedParent!); detachedParent = null; },
  rendered: () => { const table = cm!.dom.querySelector<HTMLTableElement>(".structural-tables-live-preview table"); return table === null ? Promise.resolve() : tableRenderingComplete(table); } };
