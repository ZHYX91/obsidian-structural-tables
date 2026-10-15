// @vitest-environment happy-dom

import type { App, Component, Editor } from "obsidian";
import { MarkdownView, Menu } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { editorInfoField, type TFile as HostFile } from "obsidian";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import type { ExportTableImage } from "../src/app/table-image-modal";
import { NativeTableMenuBridge } from "../src/editor/native-table-menu";
import { lastMenu, TFile } from "./mocks/obsidian";
import { parseEditableTables } from "../src/core/parser";
import { NativeTableWidget } from "./helpers/native-table-widget";

const SOURCE = `| Name | Status |
| --- | --- |
| Alice | Doing |`;
const cleanupCallbacks: (() => void)[] = [];
const editors: EditorView[] = [];

function nativeView(containerEl: HTMLElement): MarkdownView {
  const file = new TFile(`Note${editors.length}.md`);
  const editor = { getValue: () => SOURCE } as unknown as Editor;
  const cm = new EditorView({ parent: containerEl, state: EditorState.create({ doc: SOURCE, extensions: [
    editorInfoField.init(() => ({ editor, file: file as unknown as HostFile, app: {} as App, hoverPopover: null })),
    EditorView.decorations.of(Decoration.set([Decoration.replace({ widget: new NativeTableWidget(parseEditableTables(SOURCE).tables[0]!), block: true }).range(0, SOURCE.length)])),
  ] }) });
  editors.push(cm);
  return Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { containerEl, editor, file });
}

function openContextMenu(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, cancelable: true }));
}

function fixture(takeOverOrdinaryTables = false, exportImage?: ExportTableImage, existingPopout = false): {
  cell: HTMLTableCellElement;
  popoutCell: HTMLTableCellElement | null;
  popoutWindow: Window | null;
  outside: HTMLElement;
  promote: ReturnType<typeof vi.fn>;
  emitWindow: (event: string, window: Window) => void;
} {
  document.body.innerHTML = `
    <div class="markdown-view"></div>
    <p class="outside">Outside</p>`;
  const container = document.querySelector<HTMLElement>(".markdown-view")!;
  const iframe = existingPopout ? document.body.appendChild(document.createElement("iframe")) : null;
  const popoutWindow = iframe?.contentWindow ?? null;
  if (popoutWindow !== null) popoutWindow.document.body.innerHTML = `
    <div class="markdown-view"></div>`;
  const markdownView = nativeView(container);
  const popoutView = popoutWindow === null ? null : nativeView(popoutWindow.document.querySelector<HTMLElement>(".markdown-view")!);
  const popoutCell = popoutWindow?.document.querySelector<HTMLTableCellElement>("tbody td") ?? null;
  const windowCallbacks = new Map<string, (workspaceWindow: unknown, window: Window) => void>();
  const app = {
    vault: { getFileByPath: (path: string) => [markdownView, popoutView].find((view) => view?.file?.path === path)?.file ?? null },
    workspace: {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => {
        callback({ view: markdownView });
        if (popoutView !== null) callback({ view: popoutView });
      },
      on: (event: string, callback: (workspaceWindow: unknown, window: Window) => void) => {
        windowCallbacks.set(event, callback);
        return {};
      },
    },
  } as unknown as App;
  const component = {
    registerEvent: () => {},
    register: (cleanup: () => void) => cleanupCallbacks.push(cleanup),
    registerDomEvent: (
      target: Document | HTMLElement,
      type: string,
      callback: EventListener,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, callback, options);
      cleanupCallbacks.push(() => target.removeEventListener(type, callback, options));
    },
  } as unknown as Component;
  const promote = vi.fn();
  const cell = document.querySelector<HTMLTableCellElement>("tbody td")!;
  cell.addEventListener("contextmenu", (event) => {
    const menu = Menu.forEvent(event);
    menu.addItem((item) => item.setTitle("Native table action"));
    event.preventDefault();
    event.stopPropagation();
  });
  new NativeTableMenuBridge(
    app,
    () => ({ ...DEFAULT_SETTINGS, language: "en", takeOverOrdinaryTables }),
    promote,
    exportImage,
  ).register(component);
  return {
    cell,
    popoutCell,
    popoutWindow,
    outside: document.querySelector<HTMLElement>(".outside")!,
    promote,
    emitWindow: (event, window) => windowCallbacks.get(event)?.({}, window),
  };
}

afterEach(() => {
  for (const cleanup of cleanupCallbacks.splice(0)) cleanup();
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});

describe("native table menu bridge", () => {
  it("observes independent existing non-Markdown windows before their later Markdown transition", async () => {
    const realms = [new JSDOM("<body><div class='view'></div></body>"), new JSDOM("<body><div class='view'></div></body>")];
    const leaves = realms.map((realm) => ({ view: { containerEl: realm.window.document.querySelector<HTMLElement>(".view")! } }));
    const callbacks = new Map<string, (workspaceWindow: unknown, window: Window) => void>();
    const app = { workspace: {
      iterateAllLeaves: (callback: (leaf: typeof leaves[number]) => void) => leaves.forEach(callback),
      on: (event: string, callback: (workspaceWindow: unknown, window: Window) => void) => { callbacks.set(event, callback); return {}; },
    } } as unknown as App;
    const cleanups: Array<() => void> = [];
    const component = { register: (cleanup: () => void) => cleanups.push(cleanup), registerEvent: () => {} } as unknown as Component;
    const bridge = new NativeTableMenuBridge(app, () => ({ ...DEFAULT_SETTINGS, language: "en" }), vi.fn());
    bridge.register(component);
    try {
      const addListeners: Array<{ mock: { calls: unknown[][] } }> = [];
      const cells = realms.map((realm, index) => {
        const containerEl = leaves[index]!.view.containerEl;
        const editor = { getValue: () => SOURCE, getCursor: () => ({ line: 2, ch: 2 }), posToOffset: () => SOURCE.indexOf("Alice") };
        leaves[index]!.view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, { containerEl, editor, file: null });
        containerEl.innerHTML = "<div class='cm-table-widget'><table><thead><tr><th>Name</th><th>Status</th></tr></thead><tbody><tr><td>Alice</td><td>Doing</td></tr></tbody></table></div>";
        const cell = containerEl.querySelector<HTMLTableCellElement>("td")!;
        addListeners.push(vi.spyOn(cell, "addEventListener"));
        expect(cell).toBeInstanceOf(realm.window.HTMLTableCellElement);
        return cell;
      });
      await vi.waitFor(() => {
        for (const add of addListeners) expect(add.mock.calls.filter(([type]) => type === "contextmenu")).toHaveLength(1);
      });
      for (const index of cells.keys()) {
        callbacks.get("window-open")?.({}, realms[index]!.window as unknown as Window);
        expect(addListeners[index]!.mock.calls.filter(([type]) => type === "contextmenu")).toHaveLength(1);
      }
      const remove = cells.map((cell) => vi.spyOn(cell, "removeEventListener"));
      callbacks.get("window-close")?.({}, realms[0]!.window as unknown as Window);
      expect(remove[0]!.mock.calls.filter(([type]) => type === "contextmenu")).toHaveLength(1);
      expect(remove[1]!.mock.calls).toHaveLength(0);
      cleanups.splice(0).forEach((cleanup) => cleanup());
      expect(remove[1]!.mock.calls.filter(([type]) => type === "contextmenu")).toHaveLength(1);
      const late = realms[1]!.window.document.createElement("td");
      const add = vi.spyOn(late, "addEventListener");
      leaves[1]!.view.containerEl.append(late);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(add).not.toHaveBeenCalled();
    } finally {
      cleanups.splice(0).forEach((cleanup) => cleanup());
      realms.forEach((realm) => realm.window.close());
    }
  });

  it("adds Base upgrade to the menu Obsidian builds before stopping the native cell event", () => {
    const { cell, promote } = fixture(false);

    openContextMenu(cell);

    expect(lastMenu?.items.map(({ title }) => title)).toEqual([
      "Native table action", "Transpose whole table (swap rows and columns)", "Upgrade to Base…",
    ]);
    lastMenu?.items.find(({ title }) => title === "Upgrade to Base…")?.callback?.();
    expect(promote).toHaveBeenCalledOnce();
  });

  it("adds exactly one upgrade action whether or not ordinary-table takeover is enabled", () => {
    const { cell } = fixture(true);

    openContextMenu(cell);

    expect(lastMenu?.items.filter(({ title }) => title === "Upgrade to Base…")).toHaveLength(1);
  });

  it("keeps the native action and contributes transpose, export and Base to an unowned single cell", () => {
    const exportImage = vi.fn<ExportTableImage>();
    const { cell } = fixture(false, exportImage);
    openContextMenu(cell);
    expect(lastMenu?.items.map(({ title }) => title)).toEqual([
      "Native table action", "Transpose whole table (swap rows and columns)",
      "Export whole table as image…", "Upgrade to Base…",
    ]);
    lastMenu?.items.find(({ title }) => title === "Export whole table as image…")?.callback?.();
    expect(exportImage).toHaveBeenCalledOnce();
    expect(exportImage.mock.calls[0]![0].source).toBe(SOURCE);
  });

  it("installs native table actions in a popout that already existed when the plugin was enabled", () => {
    const { popoutCell, popoutWindow, emitWindow } = fixture(false, undefined, true);
    expect(popoutCell).not.toBeNull();
    expect(popoutWindow).not.toBeNull();
    openContextMenu(popoutCell!);
    expect(lastMenu?.items.filter(({ title }) => title === "Transpose whole table (swap rows and columns)")).toHaveLength(1);
    expect(lastMenu?.items.filter(({ title }) => title === "Upgrade to Base…")).toHaveLength(1);
    emitWindow("window-open", popoutWindow!);
    openContextMenu(popoutCell!);
    expect(lastMenu?.items.filter(({ title }) => title === "Transpose whole table (swap rows and columns)")).toHaveLength(1);
  });

  it("releases a native cell listener when the host removes that cell", async () => {
    const { cell } = fixture(false);
    const remove = vi.spyOn(cell, "removeEventListener");

    cell.remove();

    await vi.waitFor(() => {
      expect(remove.mock.calls.some(([type]) => type === "contextmenu")).toBe(true);
    });
  });

  it("releases listeners when a popout window closes without removing its cells", () => {
    const { emitWindow } = fixture(false);
    const iframe = document.body.appendChild(document.createElement("iframe"));
    const popout = iframe.contentWindow!;
    popout.document.body.innerHTML = '<div class="cm-table-widget"><table><tr><td>Popout</td></tr></table></div>';
    const cell = popout.document.querySelector<HTMLElement>("td")!;
    emitWindow("window-open", popout);
    const remove = vi.spyOn(cell, "removeEventListener");

    emitWindow("window-close", popout);

    expect(remove.mock.calls.some(([type]) => type === "contextmenu")).toBe(true);
  });

  it("registers a removed cell again after reattachment without duplicate menu contributions", async () => {
    const { cell } = fixture(false);
    const row = cell.parentElement!;
    cell.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    row.prepend(cell);
    await new Promise((resolve) => setTimeout(resolve, 0));
    openContextMenu(cell);
    expect(lastMenu?.items.filter(({ title }) => title === "Upgrade to Base…")).toHaveLength(1);
  });

  it("does not contribute outside a native table widget", () => {
    const { cell, outside } = fixture(false);
    openContextMenu(cell);
    const tableMenu = lastMenu;

    openContextMenu(outside);

    expect(lastMenu).toBe(tableMenu);
  });
});
