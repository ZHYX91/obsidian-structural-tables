import MarkdownIt from "markdown-it";
import { historyKeymap, undoDepth } from "@codemirror/commands";
import { StateEffect } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { Component, MarkdownRenderer, Modal } from "obsidian";

import { PlainGfmConversionService } from "../../src/app/plain-gfm-modal";
import { createTranslator } from "../../src/config/i18n";
import { DEFAULT_SETTINGS } from "../../src/config/settings";
import { parseEditableTables } from "../../src/core/parser";
import { captureEditorPlainGfmTarget } from "../../src/editor/plain-gfm-target";
import { NativeTableMenuBridge } from "../../src/editor/native-table-menu";
import { StructuralTableEditorController } from "../../src/editor/table-live-preview";
import { installReadingOutputMenu } from "../../src/reading/table-image-menu";
import { renderStructuralTable, tableRenderingComplete } from "../../src/rendering/table-renderer";
import { NativeTableWidget } from "../helpers/native-table-widget";
import { tableCommandEditor } from "../helpers/table-command-editor";
import { lastMenu, notices, TFile } from "../mocks/obsidian";

// Adapter for host helpers and MarkdownRenderer only. Product code constructs
// every action and captured target; Chromium owns layout, input and clipboard.
type ElementOptions = { cls?: string; text?: string; value?: string; attr?: Record<string, string> };
HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(tag: K, options?: ElementOptions): HTMLElementTagNameMap[K] {
  const node = this.ownerDocument.createElement(tag);
  if (options?.cls !== undefined) node.className = options.cls;
  if (options?.text !== undefined) node.textContent = options.text;
  if (options?.value !== undefined) node.setAttribute("value", options.value);
  for (const [key, value] of Object.entries(options?.attr ?? {})) node.setAttribute(key, value);
  this.append(node); return node;
};
HTMLElement.prototype.createDiv = function(options?: ElementOptions): HTMLDivElement { return this.createEl("div", options); };
HTMLElement.prototype.empty = function(): void { this.replaceChildren(); };
HTMLElement.prototype.setCssProps = function(props: Record<string, string>): void {
  for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
};
MarkdownRenderer.render = async (_app, source, target) => { target.innerHTML = new MarkdownIt({ html: true }).render(source); };
Modal.prototype.setTitle = function(title: string) { this.contentEl.createEl("h2", { text: title }); return this; };

const rowHeaders = "| --- || --- | --- |\n| Name | Alice | Bob |\n| Age | 28 | 31 |\n| City | Hangzhou | Shanghai |";
const ordinary = "| Name | Score |\n| --- | --- |\n| Alice | 1 |\n| Bob | 2 |";
type Mode = "source" | "owned" | "native" | "reading" | "ar";
let fixture: ReturnType<typeof tableCommandEditor> | null = null;
let owner: Component | null = null;
let service: PlainGfmConversionService | null = null;
let translator = createTranslator("en");
let initialSource = "";
let targetSource = "";
let pointers = 0;
let currentMode: Mode = "source";
const contextEvents: string[] = [];
const pointerEvents: string[] = [];

document.addEventListener("pointerdown", () => { pointers += 1; }, { capture: true });
for (const type of ["pointerdown", "mousedown", "mouseup"]) document.addEventListener(type, (event) => {
  pointerEvents.push(type + ":" + (event.target as HTMLElement).outerHTML.slice(0, 240));
}, { capture: true });
document.addEventListener("contextmenu", (event) => {
  contextEvents.push((event.target as HTMLElement).outerHTML.slice(0, 350));
  setTimeout(() => {
    document.querySelector("#host-menu")?.remove();
    const menu = lastMenu;
    const item = menu?.items.find((candidate) => candidate.title === translator("menu.previewGfm"));
    if (item === undefined) return;
    const wrapper = document.body.createDiv(); wrapper.id = "host-menu";
    const button = wrapper.createEl("button", { text: item.title }); button.id = "gfm-menu-item";
    button.onclick = () => { item.callback?.(); menu?.hide(); wrapper.remove(); };
  });
}, true);

function reset(mode: Mode = "source"): void {
  service?.close(); owner?.unload(); fixture?.destroy(); document.body.replaceChildren();
  pointers = 0; notices.length = 0; currentMode = mode; contextEvents.length = 0; pointerEvents.length = 0;
  translator = createTranslator(mode === "ar" ? "ar" : "en");
  const tableSource = mode === "native" ? ordinary : rowHeaders;
  initialSource = "Before stays.\n\n" + tableSource + "\n\nBetween stays.\n\n" + tableSource + "\n\nAfter stays.";
  targetSource = tableSource;
  fixture = tableCommandEditor(initialSource, keymap.of(historyKeymap));
  const f = fixture;
  f.containerEl.id = "note"; f.containerEl.dir = "ltr";
  owner = new Component();
  service = new PlainGfmConversionService(f.app, () => translator);
  const open = service.open;
  const tables = parseEditableTables(initialSource).tables;
  const target = tables[1]!;
  if (mode === "owned") {
    const controller = new StructuralTableEditorController(f.app, () => DEFAULT_SETTINGS, undefined, undefined, open);
    f.cm.dispatch({ effects: StateEffect.appendConfig.of(controller.createExtension()) });
  } else if (mode === "native") {
    f.cm.dispatch({ effects: StateEffect.appendConfig.of(EditorView.decorations.of(Decoration.set(tables.map((table) =>
      Decoration.replace({ widget: new NativeTableWidget(table), block: true }).range(table.range.from, table.range.to))))) });
    new NativeTableMenuBridge(f.app, () => DEFAULT_SETTINGS, () => undefined, undefined, open).register(owner);
  } else if (mode === "reading") {
    f.containerEl.style.display = "none";
    const wrapper = document.body.createDiv({ cls: "markdown-preview-view" }); wrapper.id = "reading";
    renderStructuralTable(f.app, target, wrapper, f.file.path, owner);
    installReadingOutputMenu(f.app, wrapper, target, f.file.path, owner, () => translator, undefined, open);
  } else {
    const button = document.body.createEl("button", { text: translator("command.convertGfm") }); button.id = "gfm-source";
    button.onclick = () => {
      const captured = captureEditorPlainGfmTarget(f.app, f.editor, target, f.view);
      if (captured !== null) open(target, captured);
    };
  }
  // Preserve a cursor in the other byte-identical table before every entry.
  f.cm.dispatch({ selection: { anchor: tables[0]!.range.from + 2 } });
}

const actionKeys = { copy: "gfm.copy", replace: "modal.convertGfm.replace", close: "gfm.close", source: "gfm.source", preview: "gfm.preview" } as const;
function action(name: keyof typeof actionKeys): HTMLButtonElement | null {
  return [...document.querySelectorAll<HTMLButtonElement>(".structural-tables-gfm-preview button")]
    .find((button) => button.textContent === translator(actionKeys[name])) ?? null;
}
function state() {
  const modal = document.querySelector<HTMLElement>(".structural-tables-gfm-preview");
  const preview = modal?.querySelector<HTMLElement>(".structural-tables-gfm-rendered");
  const source = modal?.querySelector("pre");
  return {
    mode: currentMode, contextEvents: [...contextEvents], pointerEvents: [...pointerEvents],
    clickTarget: document.body.dataset.clickTarget, menuTitles: lastMenu?.items.map((item) => item.title),
    initialSource, targetSource, source: fixture?.source(), writes: fixture?.writes(), pointers,
    undoDepth: fixture === null ? 0 : undoDepth(fixture.cm.state),
    focused: fixture?.cm.contentDOM === document.activeElement, modal: modal !== null,
    orientation: modal?.querySelector<HTMLSelectElement>("select")?.value,
    headers: [...(preview?.querySelectorAll("th") ?? [])].map((cell) => cell.textContent),
    previewSource: source?.textContent, sourceVisible: source != null && !source.hidden,
    previewVisible: preview != null && !preview.hidden, copyReady: action("copy")?.disabled === false,
    replaceAvailable: action("replace") !== null, interfaceDirection: modal?.dir, previewDirection: preview?.dir,
    sourceDirection: source?.dir, notices: [...notices],
    modalWidth: modal?.getBoundingClientRect().width, viewportWidth: innerWidth,
    controls: modal === null ? [] : [...modal.querySelectorAll("button, select")].map((element) => {
      const bounds = element.getBoundingClientRect(); return { left: bounds.left, right: bounds.right, height: bounds.height };
    }),
  };
}
function switchFile(): void { if (fixture !== null) fixture.view.file = new TFile("Other.md") as never; }
async function rendered(): Promise<void> {
  await Promise.all([...document.querySelectorAll<HTMLTableElement>("table.structural-tables-table")].map(tableRenderingComplete));
}

declare global { interface Window { gfmBrowser: { reset: typeof reset; action: typeof action; state: typeof state; switchFile: typeof switchFile; rendered: typeof rendered } } }
window.gfmBrowser = { reset, action, state, switchFile, rendered };
