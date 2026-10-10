import { toSvg } from "html-to-image";
import { App, Component } from "obsidian";

import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
import { closedCodeSpanEnd } from "../core/table-cell-syntax";
import { renderStructuralTable, tableRenderingComplete, tableRenderingFailed } from "./table-renderer";

export type TableImageErrorCode = "too-large" | "resource" | "unsupported-content" | "stale" | "timeout";
export class TableImageError extends Error {
  constructor(readonly code: TableImageErrorCode, readonly cause?: unknown) { super(code); }
}

// A deterministic 2x image, independent of screen DPI. Never auto-scale or crop.
export const TABLE_IMAGE_LIMITS = { edge: 8192, pixels: 16_000_000, nodes: 20_000,
  resourceBytes: 24_000_000, svgCharacters: 32_000_000, timeoutMs: 20_000, scale: 2 } as const;

export interface TableImage { blob: Blob; width: number; height: number }
export interface TableImageRequest {
  table: StructuralTable;
  sourcePath: string;
  settings: StructuralTablesSettings;
  document: Document;
  signal: AbortSignal;
  isCurrent: () => boolean;
  contextElement?: HTMLElement;
}

export function tableImageDimensions(width: number, height: number): { width: number; height: number } {
  const output = { width: Math.ceil(width) * TABLE_IMAGE_LIMITS.scale,
    height: Math.ceil(height) * TABLE_IMAGE_LIMITS.scale };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
    || output.width > TABLE_IMAGE_LIMITS.edge || output.height > TABLE_IMAGE_LIMITS.edge
    || output.width * output.height > TABLE_IMAGE_LIMITS.pixels) throw new TableImageError("too-large");
  return output;
}

/** Race every external render/load against cancellation, without leaking listeners. */
export function imageWork<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(signal.reason instanceof Error ? signal.reason : new Error("Image export cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function themeIdentity(document: Document): string {
  return `${document.documentElement.className}\n${document.body.className}\n${document.body.getAttribute("style")}\n${document.head.innerHTML}`;
}

function sourcePresentation(staging: HTMLElement, context?: HTMLElement): void {
  if (context === undefined) return;
  const view = staging.ownerDocument.defaultView!;
  const computed = view.getComputedStyle(context);
  for (const property of computed) {
    if (property.startsWith("--")) staging.style.setProperty(property, computed.getPropertyValue(property));
  }
  for (const property of ["font-family", "font-size", "line-height", "color", "direction"]) {
    staging.style.setProperty(property, computed.getPropertyValue(property));
  }
  for (let current: HTMLElement | null = context; current !== null; current = current.parentElement) {
    const background = view.getComputedStyle(current).backgroundColor;
    if (background !== "" && background !== "transparent" && background !== "rgba(0, 0, 0, 0)") {
      staging.style.backgroundColor = background;
      break;
    }
  }
}

function mathCount(source: string): number {
  let count = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") { index += 1; continue; }
    if (source[index] === "`") {
      const end = closedCodeSpanEnd(source, index);
      if (end !== null) { index = end - 1; continue; }
    }
    if (source[index] !== "$") continue;
    const delimiter = source[index + 1] === "$" ? "$$" : "$";
    for (let end = index + delimiter.length; end < source.length; end += 1) {
      if (source[end] === "\\") { end += 1; continue; }
      if (!source.startsWith(delimiter, end)) continue;
      if (source.slice(index + delimiter.length, end).trim() !== "") count += 1;
      index = end + delimiter.length - 1;
      break;
    }
  }
  return count;
}

async function waitForMath(root: HTMLElement, table: StructuralTable, signal: AbortSignal): Promise<void> {
  const expected = table.rows.flatMap((row) => row.cells).filter((cell) => !cell.covered && mathCount(cell.content) > 0);
  if (expected.length === 0) return;
  const complete = (): boolean => expected.every((cell) => {
    const target = root.querySelector(`[data-structural-row="${cell.row}"][data-structural-column="${cell.column}"]`);
    if (target?.querySelector("[data-mjx-error], mjx-merror, .MathJax_Error") !== null) return false;
    const glyphs = target?.querySelectorAll("mjx-container:has(svg path, svg use, mjx-c), .katex").length ?? 0;
    return glyphs >= mathCount(cell.content);
  });
  if (complete()) return;
  const Observer = root.ownerDocument.defaultView!.MutationObserver;
  let finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const observer = new Observer(() => { if (complete()) finish(); });
  observer.observe(root, { subtree: true, childList: true, attributes: true });
  try { await imageWork(pending, signal); } finally { observer.disconnect(); }
}

async function nextFrame(document: Document, signal: AbortSignal): Promise<void> {
  const view = document.defaultView!;
  let frame = 0;
  let timer = 0;
  const pending = new Promise<void>((resolve) => {
    frame = view.requestAnimationFrame(() => resolve());
    // Background windows may pause animation frames; measurement below still
    // forces layout after the font/image barriers have completed.
    timer = view.setTimeout(resolve, 250);
  });
  try { await imageWork(pending, signal); }
  finally { view.cancelAnimationFrame(frame); view.clearTimeout(timer); }
}

async function quietContent(root: HTMLElement, signal: AbortSignal): Promise<void> {
  const Observer = root.ownerDocument.defaultView?.MutationObserver;
  const view = root.ownerDocument.defaultView!;
  let timer: number;
  let done: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => { done = resolve; });
  const settle = (): void => { view.clearTimeout(timer); timer = view.setTimeout(done, 150); };
  const observer = Observer === undefined ? undefined : new Observer(settle);
  observer?.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
  settle();
  try { await imageWork(pending, signal); }
  finally { view.clearTimeout(timer!); observer?.disconnect(); }
}

async function decodeImage(image: HTMLImageElement, signal: AbortSignal): Promise<void> {
  image.loading = "eager";
  if (typeof image.decode === "function") await imageWork(image.decode(), signal);
  else if (!image.complete) {
    let cleanup = (): void => undefined;
    const loaded = new Promise<void>((resolve, reject) => {
      const error = (): void => reject(new TableImageError("resource"));
      const load = (): void => resolve();
      image.addEventListener("load", load, { once: true });
      image.addEventListener("error", error, { once: true });
      cleanup = () => { image.removeEventListener("load", load); image.removeEventListener("error", error); };
    });
    try { await imageWork(loaded, signal); } finally { cleanup(); }
  }
  if (image.naturalWidth === 0 || image.naturalHeight === 0) throw new TableImageError("resource");
}

async function inlineImages(root: HTMLElement, signal: AbortSignal): Promise<void> {
  // Rasterize already-loaded attachments locally. This works with app:// URLs
  // without fetching the Vault again. Cross-origin taint fails explicitly.
  let bytes = 0;
  for (const image of root.querySelectorAll<HTMLImageElement>("img")) {
    await decodeImage(image, signal);
    const bounds = image.getBoundingClientRect();
    const size = tableImageDimensions(Math.max(bounds.width, 1), Math.max(bounds.height, 1));
    const canvas = root.ownerDocument.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new TableImageError("resource");
    context.drawImage(image, 0, 0, size.width, size.height);
    const data = canvas.toDataURL("image/png");
    canvas.width = 0;
    canvas.height = 0;
    bytes += data.length * 0.75;
    if (bytes > TABLE_IMAGE_LIMITS.resourceBytes) throw new TableImageError("too-large");
    image.removeAttribute("srcset");
    image.style.width = `${bounds.width}px`;
    image.style.height = `${bounds.height}px`;
    image.src = data;
    await decodeImage(image, signal);
  }
}

function inlineSvgSymbols(root: HTMLElement): void {
  for (const use of root.querySelectorAll("svg use")) {
    const href = use.getAttribute("href") ?? use.getAttribute("xlink:href");
    if (href === null || !href.startsWith("#")) throw new TableImageError("unsupported-content");
    const svg = use.closest("svg")!;
    const id = href.slice(1);
    if (Array.from(svg.querySelectorAll("[id]")).some((element) => element.id === id)) continue;
    const symbol = root.ownerDocument.getElementById(id);
    if (symbol === null) throw new TableImageError("resource");
    const defs = root.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.append(symbol.cloneNode(true));
    svg.prepend(defs);
  }
}

async function embeddedFonts(root: HTMLElement, signal: AbortSignal): Promise<string> {
  const view = root.ownerDocument.defaultView;
  if (view === null) throw new TableImageError("resource");
  const families = new Set<string>();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const family of view.getComputedStyle(element).fontFamily.split(",")) {
      families.add(family.trim().replace(/["']/gu, "").toLowerCase());
    }
  }
  let bytes = 0;
  const result: string[] = [];
  const visit = async (rules: CSSRuleList, base: string): Promise<void> => {
    for (const rule of rules) {
      if (rule instanceof view.CSSFontFaceRule) {
        const face = rule;
        if (!families.has(face.style.fontFamily.replace(/["']/gu, "").trim().toLowerCase())) continue;
        let css = face.cssText;
        for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/gu)) {
          const url = match[1]!;
          if (url.startsWith("data:")) continue;
          const response = await imageWork(view.fetch(new URL(url, base), { signal }), signal);
          if (!response.ok) throw new TableImageError("resource");
          const blob = await imageWork(response.blob(), signal);
          bytes += blob.size;
          if (bytes > TABLE_IMAGE_LIMITS.resourceBytes) throw new TableImageError("too-large");
          const reader = new view.FileReader();
          const data = await imageWork(new Promise<string>((resolve, reject) => {
            reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new TableImageError("resource"));
            reader.onerror = () => reject(new TableImageError("resource"));
            reader.readAsDataURL(blob);
          }), signal);
          css = css.replace(match[0], `url("${data}")`);
        }
        result.push(css);
      } else if (rule instanceof view.CSSImportRule && rule.styleSheet !== null) {
        await visit(rule.styleSheet.cssRules, rule.styleSheet.href ?? base);
      } else if ("cssRules" in rule) {
        await visit((rule as CSSGroupingRule).cssRules, base);
      }
    }
  };
  // Read only: unlike the library font collector, never insert imported rules
  // into the host stylesheet or fetch unrelated remote stylesheets.
  for (const sheet of root.ownerDocument.styleSheets) {
    await visit(sheet.cssRules, sheet.href ?? root.ownerDocument.baseURI);
  }
  return result.join("\n");
}

export async function renderTableImage(app: App, request: TableImageRequest): Promise<TableImage> {
  const { document, table, settings } = request;
  const owner = new Component();
  const controller = new AbortController();
  const abort = (): void => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  if (request.signal.aborted) abort();
  const signal = controller.signal;
  const timeout = document.defaultView!.setTimeout(() => controller.abort(new TableImageError("timeout")), TABLE_IMAGE_LIMITS.timeoutMs);
  const staging = document.createElement("div");
  staging.className = "markdown-preview-view markdown-rendered structural-tables-image-stage";
  staging.setAttribute("aria-hidden", "true");
  staging.setAttribute("inert", "");
  sourcePresentation(staging, request.contextElement);
  const identity = themeIdentity(document);
  const current = (): void => {
    signal.throwIfAborted();
    if (!request.isCurrent() || identity !== themeIdentity(document)) throw new TableImageError("stale");
  };
  owner.load();
  try {
    current();
    if (!table.valid || table.rows.length * table.columnCount > TABLE_IMAGE_LIMITS.nodes) {
      throw new TableImageError("too-large");
    }
    const rendered = renderStructuralTable(app, table, staging, request.sourcePath, owner);
    const root = rendered.parentElement!;
    root.classList.add("structural-tables-image-snapshot");
    Object.assign(root.dataset, { appearance: table.structural || settings.takeOverOrdinaryTables ? settings.appearance : "theme", density: settings.density,
      zebra: String(settings.zebraRows), layout: "content-left", tableKind: table.structural ? "structural" : "ordinary" });
    document.body.append(staging);
    await imageWork(tableRenderingComplete(rendered), signal);
    if (tableRenderingFailed(rendered)) throw new TableImageError("resource");
    await waitForMath(root, table, signal);
    await quietContent(root, signal);
    if (root.querySelector("iframe, video, audio, canvas, .internal-embed:not(.image-embed), .markdown-embed")) {
      throw new TableImageError("unsupported-content");
    }
    if (root.querySelectorAll("*").length > TABLE_IMAGE_LIMITS.nodes) throw new TableImageError("too-large");
    await imageWork(document.fonts.ready, signal);
    await inlineImages(root, signal);
    inlineSvgSymbols(root);
    const fontEmbedCSS = await embeddedFonts(root, signal);
    await nextFrame(document, signal);
    await nextFrame(document, signal);
    current();
    const width = Math.ceil(Math.max(root.scrollWidth, root.getBoundingClientRect().width));
    const height = Math.ceil(Math.max(root.scrollHeight, root.getBoundingClientRect().height));
    const size = tableImageDimensions(width, height);
    const background = document.defaultView!.getComputedStyle(staging).backgroundColor;
    const svg = await imageWork(toSvg(root, { width, height, fontEmbedCSS, backgroundColor: background,
      includeQueryParams: true, fetchRequestInit: { signal },
      filter: () => { signal.throwIfAborted(); return true; } }), signal);
    if (svg.length > TABLE_IMAGE_LIMITS.svgCharacters) throw new TableImageError("too-large");
    // The dependency can substitute empty URLs on a failed CSS resource fetch.
    // Refuse that result instead of presenting a successful incomplete image.
    const xml = decodeURIComponent(svg.slice(svg.indexOf(",") + 1));
    if (/(?:background(?:-image)?|(?:-webkit-)?mask(?:-image)?):[^;{}]*url\((?:&quot;|["'])?(?:&quot;|["'])?\)/u.test(xml)
      || /src=""/u.test(xml)) throw new TableImageError("resource");
    current();
    const image = document.createElement("img");
    image.src = svg;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    try {
      await decodeImage(image, signal);
      const context = canvas.getContext("2d");
      if (context === null) throw new TableImageError("resource");
      context.drawImage(image, 0, 0, size.width, size.height);
      const blob = await imageWork(new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value === null ? reject(new TableImageError("resource")) : resolve(value), "image/png")), signal);
      current();
      return { blob, ...size };
    } finally { image.removeAttribute("src"); canvas.width = 0; canvas.height = 0; }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof TableImageError) throw error;
    throw new TableImageError("resource", error);
  } finally {
    document.defaultView!.clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    owner.unload();
    staging.remove();
  }
}
