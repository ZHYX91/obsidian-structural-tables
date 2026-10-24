// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { App, MarkdownRenderer } from "obsidian";
import { TableAppearancePreview } from "../src/app/table-appearance-preview";
import { createTranslator } from "../src/config/i18n";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { tableRenderingComplete } from "../src/rendering/table-renderer";

beforeAll(() => {
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(
    tag: K, options?: { cls?: string; text?: string },
  ): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    if (options?.text !== undefined) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function(options?: { cls?: string }): HTMLDivElement {
    return this.createEl("div", options);
  };
});

describe("local appearance preview", () => {
  it("renders real spanning table cells, updates only local appearance, and never reads a note", async () => {
    const render = vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => {
      target.textContent = source;
    });
    const read = vi.fn(() => { throw new Error("Preview must not read Vault content"); });
    const modify = vi.fn(() => { throw new Error("Preview must not write Vault content"); });
    const app = Object.assign(new App(), { vault: { read, modify } });
    const host = document.createElement("div");
    const preview = new TableAppearancePreview(app, host, DEFAULT_SETTINGS, createTranslator("en"));
    const table = host.querySelector<HTMLTableElement>("table")!;
    await tableRenderingComplete(table);
    expect(table.querySelector("[colspan='2']")).not.toBeNull();
    expect(table.querySelector("[rowspan='2']")).not.toBeNull();
    expect(table.textContent).toContain("20");
    expect(host.querySelector("textarea, [contenteditable], a, img")).toBeNull();
    const renders = render.mock.calls.length;
    preview.update({ ...DEFAULT_SETTINGS, appearance: "grid", layout: "pane", density: "compact", zebraRows: true });
    expect(table.parentElement?.dataset).toMatchObject({ appearance: "grid", layout: "pane", density: "compact", zebra: "true" });
    expect(render.mock.calls).toHaveLength(renders);
    expect(read).not.toHaveBeenCalled();
    expect(modify).not.toHaveBeenCalled();
    preview.destroy();
    render.mockRestore();
  });

  it("cancels queued Markdown rendering when the tab closes immediately", async () => {
    const render = vi.spyOn(MarkdownRenderer, "render");
    const host = document.createElement("div");
    const preview = new TableAppearancePreview(new App(), host, DEFAULT_SETTINGS, createTranslator("zh-CN"));
    preview.destroy();
    await tableRenderingComplete(host.querySelector("table")!);
    expect(render).not.toHaveBeenCalled();
    render.mockRestore();
  });
});
