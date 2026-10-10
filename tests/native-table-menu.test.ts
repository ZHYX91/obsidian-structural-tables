// @vitest-environment happy-dom

import type { App, Component, Editor } from "obsidian";
import { MarkdownView, Menu } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import type { ExportTableImage } from "../src/app/table-image-modal";
import { NativeTableMenuBridge } from "../src/editor/native-table-menu";
import { lastMenu } from "./mocks/obsidian";

const SOURCE = `| Name | Status |
| --- | --- |
| Alice | Doing |`;
const cleanupCallbacks: (() => void)[] = [];

function openContextMenu(target: HTMLElement): void {
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2, cancelable: true }));
}

function fixture(takeOverOrdinaryTables = false, exportImage?: ExportTableImage): {
  cell: HTMLTableCellElement;
  outside: HTMLElement;
  promote: ReturnType<typeof vi.fn>;
  emitWindow: (event: string, window: Window) => void;
} {
  document.body.innerHTML = `
    <div class="markdown-view">
      <div class="cm-table-widget">
        <table>
          <thead><tr><th>Name</th><th>Status</th></tr></thead>
          <tbody><tr><td>Alice</td><td>Doing</td></tr></tbody>
        </table>
      </div>
    </div>
    <p class="outside">Outside</p>`;
  const container = document.querySelector<HTMLElement>(".markdown-view")!;
  const editor = {
    getValue: () => SOURCE,
    getCursor: () => ({ line: 2, ch: 2 }),
    posToOffset: () => SOURCE.indexOf("Alice"),
  } as unknown as Editor;
  const markdownView = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    containerEl: container,
    editor,
    file: null,
  });
  const windowCallbacks = new Map<string, (workspaceWindow: unknown, window: Window) => void>();
  const app = {
    workspace: {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => callback({ view: markdownView }),
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
    outside: document.querySelector<HTMLElement>(".outside")!,
    promote,
    emitWindow: (event, window) => windowCallbacks.get(event)?.({}, window),
  };
}

afterEach(() => {
  for (const cleanup of cleanupCallbacks.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe("native table menu bridge", () => {
  it("adds Base upgrade to the menu Obsidian builds before stopping the native cell event", () => {
    const { cell, promote } = fixture(false);

    openContextMenu(cell);

    expect(lastMenu?.items.map(({ title }) => title)).toEqual(["Native table action", "Upgrade to Base…"]);
    lastMenu?.items[1]?.callback?.();
    expect(promote).toHaveBeenCalledOnce();
  });

  it("adds exactly one upgrade action whether or not ordinary-table takeover is enabled", () => {
    const { cell } = fixture(true);

    openContextMenu(cell);

    expect(lastMenu?.items.filter(({ title }) => title === "Upgrade to Base…")).toHaveLength(1);
  });

  it("keeps the native action and contributes only export and Base items to an unowned single cell", () => {
    const exportImage = vi.fn<ExportTableImage>();
    const { cell } = fixture(false, exportImage);
    openContextMenu(cell);
    expect(lastMenu?.items.map(({ title }) => title)).toEqual([
      "Native table action", "Export whole table as image…", "Upgrade to Base…",
    ]);
    lastMenu?.items.find(({ title }) => title === "Export whole table as image…")?.callback?.();
    expect(exportImage).toHaveBeenCalledOnce();
    expect(exportImage.mock.calls[0]![0].source).toBe(SOURCE);
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
