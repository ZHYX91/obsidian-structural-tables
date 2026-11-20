// @vitest-environment jsdom
// HappyDOM drops td/tr attributes in Range.createContextualFragment even with
// a template context. These production paste paths require HTML fragment parsing.
import { history, undoDepth } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { App, editorInfoField, editorLivePreviewField } from "obsidian";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

import { createTranslator } from "../src/config/i18n";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { TABLE_RANGE_HTML_ATTRIBUTE } from "../src/core/table-range-clipboard";
import { StructuralTableEditorController } from "../src/editor/table-live-preview";
import { lastMenu, notices } from "./mocks/obsidian";

beforeAll(() => {
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { cls?: string }): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function(options?: { cls?: string }): HTMLDivElement { return this.createEl("div", options); };
  HTMLElement.prototype.setCssStyles = function(styles: Partial<CSSStyleDeclaration>): void { Object.assign(this.style, styles); };
  HTMLElement.prototype.setCssProps = function(props: Record<string, string>): void {
    for (const [key, value] of Object.entries(props)) this.style.setProperty(key, value);
  };
  HTMLElement.prototype.empty = function(): void { this.replaceChildren(); };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it.each([
  { name: "table cell", html: `<td ${TABLE_RANGE_HTML_ATTRIBUTE}="bad">Fallback</td>` },
  { name: "table row", html: `<tr ${TABLE_RANGE_HTML_ATTRIBUTE}="bad"><td>Fallback</td></tr>` },
  { name: "uppercase table cell", html: `<TD ${TABLE_RANGE_HTML_ATTRIBUTE.toUpperCase()}="bad">Fallback</TD>` },
  { name: "cell after a closing template", html: `</template><td ${TABLE_RANGE_HTML_ATTRIBUTE}="bad">Fallback</td>` },
].flatMap((sample) => ["native", "menu"].map((route) => ({ ...sample, route }))))(
  "refuses the real range attribute in a $name fragment through $route paste", async ({ html, route }) => {
    const source = "Before\n\n| H | V |\n| --- || --- |\n| A | Alpha |\n\nEnd";
    const data = new Map([["text/html", html], ["text/plain", "Fallback"]]);
    const transfer = { types: [...data.keys()], getData: (type: string) => data.get(type) ?? "" };
    const read = vi.fn(async () => [{ types: transfer.types, getType: async (type: string) => ({ text: async () => transfer.getData(type) }) }]);
    vi.stubGlobal("navigator", { clipboard: { read } });
    const parent = document.body.appendChild(document.createElement("div"));
    const controller = new StructuralTableEditorController(new App(), () => DEFAULT_SETTINGS);
    const state = EditorState.create({ doc: source, selection: { anchor: 0 },
      extensions: [history(), editorInfoField, editorLivePreviewField, controller.createExtension()] });
    const view = new EditorView({ state, parent });
    const noticeStart = notices.length;
    try {
      const cell = parent.querySelector<HTMLElement>("[data-structural-row='1'][data-structural-column='1']")!;
      cell.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      const editor = parent.querySelector<HTMLTextAreaElement>("textarea")!;
      editor.select();
      if (route === "menu") {
        editor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        lastMenu!.items.find((item) => item.title === "Paste")!.callback!();
        await vi.waitFor(() => expect(notices).toHaveLength(noticeStart + 1));
      } else {
        const event = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: transfer });
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
