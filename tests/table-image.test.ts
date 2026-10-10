// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { App, Component, MarkdownRenderer } from "obsidian";
import * as host from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { imageWork, renderTableImage, tableImageDimensions, TableImageError } from "../src/rendering/table-image";
import { tableRenderingComplete, tableRenderingFailed, renderStructuralTable } from "../src/rendering/table-renderer";

const raster = vi.hoisted(() => ({ toSvg: vi.fn() }));
vi.mock("html-to-image", () => raster);
const fixture = readFileSync("acceptance/fixtures/Table image export.md", "utf8");
const meal = parseEditableTables(fixture).tables[0]!;
const originalFontFace = window.FontFace;

function render(overrides = {}) {
  return renderTableImage(new App(), { table: meal, sourcePath: "Table image export.md",
    settings: DEFAULT_SETTINGS, document, signal: new AbortController().signal, isCurrent: () => true, ...overrides });
}

function serializedContent(value: string, inline = false): string {
  const xml = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml");
  if (inline) {
    const element = xml.createElementNS("http://www.w3.org/1999/xhtml", "div");
    element.setAttribute("style", `content:${value}`); xml.documentElement.append(element);
  } else {
    const style = xml.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `.content::before{content:${value}}`; xml.documentElement.append(style);
  }
  return `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(xml))}`;
}

beforeEach(() => {
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve(), [Symbol.iterator]: () => [][Symbol.iterator]() }, configurable: true });
  Object.defineProperty(window, "FontFace", { configurable: true, value: class {
    style = "normal"; weight = "normal"; stretch = "normal"; unicodeRange = "U+0-10FFFF";
    featureSettings = "normal"; variationSettings = "normal"; display = "auto";
    ascentOverride = "normal"; descentOverride = "normal"; lineGapOverride = "normal";
    constructor(readonly family: string, readonly source: string, descriptors: FontFaceDescriptors = {}) { Object.assign(this, descriptors); }
    load() { return Promise.resolve(this); }
  } });
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

afterEach(() => { document.body.replaceChildren(); document.body.removeAttribute("class"); document.body.removeAttribute("style"); document.head.replaceChildren();
  Object.defineProperty(window, "FontFace", { configurable: true, value: originalFontFace }); vi.restoreAllMocks(); });

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
    raster.toSvg.mockResolvedValue(`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="background-image:url(\'\')"/></foreignObject></svg>')}`);
    await expect(render()).rejects.toMatchObject({ code: "resource" });
  });

  it.each(['"url()"', "'url(\"/missing.svg\")'", String.raw`"quote \" url() \\ url('/missing.svg')"`,
    String.raw`'quote \' url() \\ url("/missing.svg")'`, String.raw`"\75rl()"`, '"not-url()"'])("preserves CSS string content %s without inventing image resources", async (value) => {
    const fetch = vi.spyOn(window, "fetch").mockRejectedValue(new Error("CSS string is not an image"));
    const src = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    for (const inline of [false, true]) {
      raster.toSvg.mockResolvedValue(serializedContent(value, inline));
      await expect(render()).resolves.toMatchObject({ width: 1280 });
      const svg = decodeURIComponent(src.mock.calls[src.mock.calls.length - 1]![0].split(",").slice(1).join(","));
      expect(svg).not.toContain("data:image/");
      const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
      const expected = document.createElement("div").style; expected.setProperty("content", value);
      if (inline) {
        const actual = document.createElement("div").style; actual.cssText = xml.querySelector("div")!.getAttribute("style")!;
        expect(actual.getPropertyValue("content")).toBe(expected.getPropertyValue("content"));
      } else {
        const sheet = new CSSStyleSheet(); sheet.replaceSync(xml.querySelector("style")!.textContent!);
        expect((sheet.cssRules[0] as CSSStyleRule).style.getPropertyValue("content")).toBe(expected.getPropertyValue("content"));
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([String.raw`url("https://example.invalid/r\65 d\(1\).svg")`,
    String.raw`u\72l(https://example.invalid/r\65 d\(1\).svg)`])("embeds real escaped content URLs %s alongside literal URL text", async (url) => {
    const fetch = vi.spyOn(window, "fetch").mockResolvedValue(new Response('<svg xmlns="http://www.w3.org/2000/svg"/>',
      { headers: { "Content-Type": "image/svg+xml" } }));
    const src = vi.spyOn(HTMLImageElement.prototype, "src", "set");
    raster.toSvg.mockResolvedValue(serializedContent(`${url} "url()" 'url("/missing.svg")'`));
    await render();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]![0]).toBe("https://example.invalid/red(1).svg");
    const svg = decodeURIComponent(src.mock.calls[src.mock.calls.length - 1]![0].split(",").slice(1).join(","));
    expect(svg).toContain("data:image/svg+xml;base64,");
    expect(svg).toContain("url()");
    expect(svg).toContain("/missing.svg");
  });

  it("refuses missing real CSS content images even when followed by URL-like strings", async () => {
    const fetch = vi.spyOn(window, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
    raster.toSvg.mockResolvedValue(serializedContent('url("https://example.invalid/missing.svg") "url()"'));
    await expect(render()).rejects.toMatchObject({ code: "resource" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(document.querySelector(".structural-tables-image-stage")).toBeNull();
  });

  it("allows unrelated renderer head updates but refuses changed source presentation", async () => {
    const context = document.body.appendChild(document.createElement("div"));
    context.style.setProperty("--background-primary", "white");
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => {
      target.textContent = source;
      if (document.getElementById("render-runtime-style") === null) {
        const style = document.createElement("style"); style.id = "render-runtime-style";
        style.textContent = ".unused-math-runtime{visibility:visible}"; document.head.append(style);
      }
    });
    await expect(render({ contextElement: context })).resolves.toMatchObject({ width: 1280 });
    raster.toSvg.mockImplementation(async () => {
      context.style.setProperty("--background-primary", "black"); return "data:image/svg+xml,%3Csvg%2F%3E";
    });
    await expect(render({ contextElement: context })).rejects.toMatchObject({ code: "stale" });
  });

  it("uses the public math barrier and actual host DOM, including dollars in links/code and empty-resource text", async () => {
    const barrier = vi.spyOn(host, "finishRenderMath").mockResolvedValue();
    const table = parseEditableTables('| A |\n| --- |\n| [text](https://example.invalid/$x$) `background:url()` src="" |').tables[0]!;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, source, target) => {
      target.textContent = source;
      target.createEl("a").href = "https://example.invalid/$x$";
    });
    raster.toSvg.mockResolvedValue(`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><text>background:url() src=""</text></svg>')}`);
    await expect(render({ table })).resolves.toMatchObject({ width: 1280 });
    expect(barrier).toHaveBeenCalledOnce();
    barrier.mockRejectedValue(new Error("math flush failed"));
    await expect(render({ table })).rejects.toMatchObject({ code: "resource" });
  });

  it("keeps source cssclasses and Callout attributes in a shallow scope without copying controls", async () => {
    const context = document.body.appendChild(document.createElement("div"));
    context.className = "theme-note markdown-preview-view";
    const callout = context.createDiv({ cls: "callout" }); callout.dataset.callout = "warning";
    const wrapper = callout.createDiv({ cls: "structural-tables-container" });
    wrapper.createEl("button");
    raster.toSvg.mockImplementation(async (root: HTMLElement) => {
      expect(root.closest(".theme-note")).not.toBeNull();
      expect(root.closest(".callout")?.getAttribute("data-callout")).toBe("warning");
      expect(root.parentElement?.querySelector("button")).toBeNull();
      return "data:image/svg+xml,%3Csvg%2F%3E";
    });
    await render({ contextElement: wrapper });
    expect(document.querySelector(".structural-tables-image-stage")).toBeNull();
  });

  it("refuses an unavailable URL needed to embed a loaded font, while leaving source fallback alone", async () => {
    const style = document.createElement("style");
    style.textContent = '@font-face{font-family:NeededRemote;src:url("https://example.invalid/font.woff2")} .structural-tables-table{font-family:NeededRemote,serif}';
    document.head.append(style);
    const faces = [{ family: "NeededRemote", status: "loaded", weight: "normal", style: "normal" }];
    Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve(), [Symbol.iterator]: () => faces[Symbol.iterator]() }, configurable: true });
    const fetch = vi.spyOn(window, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(render()).rejects.toMatchObject({ code: "resource" });
    expect(fetch).toHaveBeenCalledOnce();
    faces[0]!.status = "error";
    await expect(render()).resolves.toMatchObject({ width: 1280 });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("associates actual loaded subsets, widths and repeated descriptors without reading unused sources", async () => {
    const style = document.createElement("style");
    style.textContent = '@font-face{font-family:Subset;src:local("Arial");unicode-range:U+0-FF}'
      + '@font-face{font-family:Subset;src:url("https://example.invalid/cjk.woff2");unicode-range:U+4E00-9FFF}'
      + '@font-face{font-family:Width;src:local("Arial");font-stretch:normal}'
      + '@font-face{font-family:Width;src:url("https://example.invalid/narrow.woff2");font-stretch:condensed}'
      + '@font-face{font-family:Repeat;src:url("https://example.invalid/unused.woff2")}'
      + '@font-face{font-family:Repeat;src:local("Arial")}'
      + '.structural-tables-table{font-family:Subset,Width,Repeat,serif}';
    document.head.append(style);
    const faces = [
      { family: "Subset", unicodeRange: "U+0-FF", status: "loaded" },
      { family: "Subset", unicodeRange: "U+4E00-9FFF", status: "unloaded" },
      { family: "Width", stretch: "normal", status: "loaded" },
      { family: "Width", stretch: "condensed", status: "unloaded" },
      { family: "Repeat", status: "unloaded" }, { family: "Repeat", status: "loaded" },
    ];
    Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve(), [Symbol.iterator]: () => faces[Symbol.iterator]() }, configurable: true });
    const fetch = vi.spyOn(window, "fetch").mockRejectedValue(new Error("Unused URL must not be read"));
    raster.toSvg.mockImplementation(async (_root, options) => {
      expect(options.fontEmbedCSS).toContain("Subset"); expect(options.fontEmbedCSS).toContain("Width"); expect(options.fontEmbedCSS).toContain("Repeat");
      expect(options.fontEmbedCSS).not.toContain("url(");
      return "data:image/svg+xml,%3Csvg%2F%3E";
    });
    await expect(render()).resolves.toMatchObject({ width: 1280 });
    expect(fetch).not.toHaveBeenCalled();
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
