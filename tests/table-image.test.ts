// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { App, Component, MarkdownRenderer } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { imageWork, renderTableImage, tableImageDimensions, TableImageError } from "../src/rendering/table-image";
import { tableRenderingComplete, tableRenderingFailed, renderStructuralTable } from "../src/rendering/table-renderer";

const raster = vi.hoisted(() => ({ toSvg: vi.fn() }));
vi.mock("html-to-image", () => raster);
const fixture = readFileSync("acceptance/fixtures/Table image export.md", "utf8");
const meal = parseEditableTables(fixture).tables[0]!;

function render(overrides = {}) {
  return renderTableImage(new App(), { table: meal, sourcePath: "Table image export.md",
    settings: DEFAULT_SETTINGS, document, signal: new AbortController().signal, isCurrent: () => true, ...overrides });
}

beforeEach(() => {
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
  HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(tag: K, options?: { cls?: string }): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    this.append(element); return element;
  };
  HTMLElement.prototype.createDiv = function(options?: { cls?: string }): HTMLDivElement { return this.createEl("div", options); };
  raster.toSvg.mockReset().mockResolvedValue("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
  vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => { target.textContent = source; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 640, height: 120,
    x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 120, toJSON: () => ({}) });
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(120);
  vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["PNG"], { type: "image/png" })));
});

afterEach(() => { document.body.replaceChildren(); document.head.replaceChildren(); vi.restoreAllMocks(); });

describe("complete table PNG", () => {
  it("renders the reconstructed five-column owner model, completed rich cells and explicit alignment without controls", async () => {
    expect(meal.columnCount).toBe(5);
    expect(meal.valid).toBe(true);
    raster.toSvg.mockImplementation(async (root: HTMLElement, options) => {
      expect(root.querySelector("thead th:nth-child(2)")?.getAttribute("colspan")).toBe("2");
      expect(root.querySelector("tbody td")?.getAttribute("rowspan")).toBe("3");
      expect(root.querySelectorAll("tbody [data-structural-column='4']")).toHaveLength(3);
      expect(Array.from(root.querySelectorAll("tbody [data-structural-column='4']"), (cell) => cell.getAttribute("data-align")))
        .toEqual(["left", "left", "left"]);
      expect(root.textContent).toContain("清炒青菜");
      expect(root.textContent).toContain("香菇豆腐");
      expect(root.querySelector("button, textarea, caption, .is-selected")).toBeNull();
      expect(options.width).toBe(640);
      expect(options.height).toBe(120);
      return "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E";
    });
    const result = await render();
    expect(result.width).toBe(1280);
    expect(result.height).toBe(240);
    expect(result.blob.type).toBe("image/png");
    expect(fixture).toContain("not the reporter's original Markdown");
    expect(document.querySelector(".structural-tables-image-stage")).toBeNull();
  });

  it("waits for asynchronous Markdown and exposes a failed cell render without changing normal fallback", async () => {
    let finish!: () => void;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => {
      await new Promise<void>((resolve) => { finish = resolve; }); target.textContent = source;
    });
    const source = "| --- |\n| delayed |";
    const owner = new Component();
    const table = renderStructuralTable(new App(), parseEditableTables(source).tables[0]!, document.createElement("div"), "", owner);
    await Promise.resolve();
    expect(table.textContent).toBe("");
    finish();
    await tableRenderingComplete(table);
    expect(table.textContent).toBe("delayed");
    expect(tableRenderingFailed(table)).toBe(false);
    owner.unload();
    vi.spyOn(MarkdownRenderer, "render").mockRejectedValue(new Error("math rendering failed"));
    await expect(render()).rejects.toMatchObject({ code: "resource" });
    expect(raster.toSvg).not.toHaveBeenCalled();
  });

  it("cancels a pending Markdown render and always unloads and removes the stage", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockReturnValue(new Promise(() => undefined));
    const unload = vi.spyOn(Component.prototype, "unload");
    const controller = new AbortController();
    const pending = render({ signal: controller.signal });
    await Promise.resolve();
    controller.abort(new Error("closed"));
    await expect(pending).rejects.toThrow("closed");
    expect(unload).toHaveBeenCalled();
    expect(document.querySelector(".structural-tables-image-stage")).toBeNull();
    expect(raster.toSvg).not.toHaveBeenCalled();
  });

  it("refuses a changed source or theme rather than publishing the pending PNG", async () => {
    let current = true;
    raster.toSvg.mockImplementation(async () => { current = false; return "data:image/svg+xml,%3Csvg%2F%3E"; });
    await expect(render({ isCurrent: () => current })).rejects.toMatchObject({ code: "stale" });
    raster.toSvg.mockImplementation(async () => { document.body.classList.add("theme-dark"); return "data:image/svg+xml,%3Csvg%2F%3E"; });
    await expect(render()).rejects.toMatchObject({ code: "stale" });
  });

  it("uses the full scroll dimensions and refuses excessive dimensions before rasterization", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(5000);
    await expect(render()).rejects.toMatchObject({ code: "too-large" });
    expect(raster.toSvg).not.toHaveBeenCalled();
    expect(tableImageDimensions(4096, 100)).toEqual({ width: 8192, height: 200 });
    for (const [width, height] of [[4097, 1], [3000, 2000], [0, 100], [Infinity, 100]]) {
      expect(() => tableImageDimensions(width!, height!)).toThrow(TableImageError);
    }
  });

  it("rejects interactive embeds and missing CSS resources instead of creating a partial image", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, _source, target) => { target.innerHTML = '<iframe src="about:blank"></iframe>'; });
    await expect(render()).rejects.toMatchObject({ code: "unsupported-content" });
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => { target.textContent = source; });
    raster.toSvg.mockResolvedValue('data:image/svg+xml,%3Csvg%3Ebackground%3Aurl(%26quot%3B%26quot%3B)%3C%2Fsvg%3E');
    await expect(render()).rejects.toMatchObject({ code: "resource" });
  });

  it("handles already-aborted and rejected work without keeping an abort listener", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(imageWork(Promise.reject(new Error("failed")), controller.signal)).rejects.toThrow("failed");
    await Promise.resolve();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort(new Error("cancelled"));
    expect(() => imageWork(Promise.resolve(), controller.signal)).toThrow("cancelled");
  });
});
