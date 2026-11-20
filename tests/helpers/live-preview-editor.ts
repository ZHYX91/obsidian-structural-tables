import type { BaseEditorInfo } from "../../src/app/base-promotion-service";
import type { ExportTableImage } from "../../src/app/table-image-modal";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { App, Platform, editorInfoField, editorLivePreviewField, type Editor } from "obsidian";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { DEFAULT_SETTINGS, type StructuralTablesSettings } from "../../src/config/settings";
import type { StructuralTable } from "../../src/core/model";
import { parseEditableTables } from "../../src/core/parser";
import { StructuralTableEditorController } from "../../src/editor/table-live-preview";
import { dispatchScopeCaptureThenDom, lastMenu, resetMockModKey, setMockModKey, type MockModKey } from "../mocks/obsidian";
import { installSelectionChangeTasks } from "../mocks/selection-events";

interface ObsidianElementOptions {
  cls?: string;
}

export class NativeTableWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "test-native-table";
    return element;
  }
}

export class NativeCalloutWidget extends WidgetType {
  override toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "callout";
    element.innerHTML = "<div class='callout-title'>Note</div><div class='callout-content'><table><thead><tr><th>A</th><th>&lt;</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table></div>";
    return element;
  }
}

export function nativeTableForSource(source: string, ownerDocument = document): HTMLTableElement | null {
  const table = parseEditableTables(source).tables[0];
  if (table === undefined) return null;
  const element = ownerDocument.createElement("table");
  const head = table.headerRowCount > 0 ? element.createTHead() : null;
  const body = element.createTBody();
  table.rows.forEach((row, rowIndex) => {
    const target = rowIndex < table.headerRowCount ? head! : body;
    const tr = target.insertRow();
    row.cells.forEach((cell) => {
      const node = ownerDocument.createElement(rowIndex < table.headerRowCount ? "th" : "td");
      node.textContent = cell.raw.trim();
      tr.appendChild(node);
    });
  });
  return element;
}

export class SourceCalloutWidget extends WidgetType {
  constructor(private readonly source: string) { super(); }

  override toDOM(): HTMLElement {
    const element = document.createElement("div");
    element.className = "callout";
    const title = element.appendChild(document.createElement("div"));
    title.className = "callout-title";
    title.textContent = "Note";
    const content = element.appendChild(document.createElement("div"));
    content.className = "callout-content";
    for (const sourceTable of parseEditableTables(this.source).tables) {
      const table = nativeTableForSource(sourceTable.source, element.ownerDocument);
      if (table !== null) content.appendChild(table);
    }
    return element;
  }
}

export const screenshotTable = [
  "|  |  |  |  |  |",
  "| --- | --- | --- | --- | --- |",
  "|  |  |  |  |  |",
  "|  |  |  |  |  |",
  "|  |  |  |  | < |",
  "|  |  |  | ^ | ^ |",
].join("\n");

beforeAll(() => {
  HTMLElement.prototype.setCssStyles = function setCssStyles(styles: Partial<CSSStyleDeclaration>): void {
    Object.assign(this.style, styles);
  };
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
  HTMLElement.prototype.setCssProps = function setCssProps(props: Record<string, string>): void {
    for (const [name, value] of Object.entries(props)) this.style.setProperty(name, value);
  };
  HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
});

let uninstallSelectionTasks: (() => void) | undefined;

beforeEach(() => {
  uninstallSelectionTasks = installSelectionChangeTasks(document);
});

afterEach(() => {
  uninstallSelectionTasks?.();
  uninstallSelectionTasks = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetMockModKey();
  Platform.isMobileApp = false;
  document.body.replaceChildren();
});

export function mountEditor(
  source: string,
  selection: { anchor: number; head?: number },
  extensions: Extension[] = [],
  promote?: (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable) => void,
  settingsOverride: Partial<StructuralTablesSettings> = {},
  exportImage?: ExportTableImage,
): {
    app: App;
    parent: HTMLElement;
    view: EditorView;
    updateSettings: (update: Partial<StructuralTablesSettings>) => void;
  } {
  let settings = { ...DEFAULT_SETTINGS, ...settingsOverride, enableLivePreview: true };
  const app = new App();
  const controller = new StructuralTableEditorController(
    app,
    () => settings,
    promote,
    exportImage,
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
    app,
    parent,
    view: new EditorView({ state, parent }),
    updateSettings: (update) => {
      settings = { ...settings, ...update };
      controller.refresh();
    },
  };
}

export function draftInputEvent(
  type: "beforeinput" | "input",
  inputType: string,
  data: string | null,
  isComposing = false,
): InputEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: type === "beforeinput",
  }) as InputEvent;
  Object.defineProperties(event, {
    inputType: { value: inputType },
    data: { value: data },
    isComposing: { value: isComposing },
  });
  return event;
}

export function typeDraftText(editor: HTMLTextAreaElement, text: string): void {
  for (const character of text) {
    const before = draftInputEvent("beforeinput", "insertText", character);
    if (!editor.dispatchEvent(before)) continue;
    editor.setRangeText(character, editor.selectionStart, editor.selectionEnd, "end");
    editor.dispatchEvent(draftInputEvent("input", "insertText", character));
  }
}

export function replaceDraftText(editor: HTMLTextAreaElement, text: string): void {
  editor.select();
  typeDraftText(editor, text);
}

export function modEvent(
  key: string,
  platform: MockModKey = "ctrl",
  shiftKey = false,
): KeyboardEvent {
  setMockModKey(platform);
  return new KeyboardEvent("keydown", {
    key,
    ctrlKey: platform === "ctrl",
    metaKey: platform === "meta",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
}

export function dispatchDraftShortcut(
  editor: HTMLTextAreaElement,
  key: string,
  platform: MockModKey = "ctrl",
  shiftKey = false,
): KeyboardEvent {
  const event = modEvent(key, platform, shiftKey);
  dispatchScopeCaptureThenDom(editor, event);
  return event;
}

export function gridClipboardEvent(
  type: "copy" | "cut" | "paste",
  transfer: DataTransfer,
): ClipboardEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: transfer });
  return event;
}

export function clickCurrentMenuItem(title: string, hideBeforeCallback = false): void {
  const menu = lastMenu;
  const item = menu?.items.find((candidate) => candidate.title === title);
  expect(item?.callback).toBeTypeOf("function");
  const button = document.body.appendChild(document.createElement("button"));
  button.addEventListener("click", (event) => {
    if (hideBeforeCallback) menu?.hide();
    (item?.callback as ((event: MouseEvent) => void) | null)?.(event);
    if (!hideBeforeCallback) menu?.hide();
    button.remove();
  });
  dispatchPointerDown(button, "mouse");
  button.focus();
  button.click();
}

export function dispatchOwnedGridKey(
  target: HTMLElement,
  key: "Delete" | "Backspace",
  throughScope = true,
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  if (throughScope) dispatchScopeCaptureThenDom(target, event);
  else target.dispatchEvent(event);
  return event;
}

export function dispatchPointerDown(
  target: HTMLElement,
  pointerType: "mouse" | "touch",
  timeStamp?: number,
): Event {
  const event = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    isPrimary: { value: true },
    button: { value: 0 },
    shiftKey: { value: false },
    ...(timeStamp === undefined ? {} : { timeStamp: { value: timeStamp } }),
  });
  target.dispatchEvent(event);
  return event;
}
