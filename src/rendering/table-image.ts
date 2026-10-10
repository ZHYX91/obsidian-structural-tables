import { toSvg } from "html-to-image";
import { App, Component, finishRenderMath } from "obsidian";

import type { StructuralTablesSettings } from "../config/settings";
import type { StructuralTable } from "../core/model";
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

const presentationProperties = ["color", "background-color", "background-image", "font-family", "font-size",
  "font-weight", "font-style", "line-height", "text-align", "border-top-color", "border-top-style", "border-top-width",
  "border-right-color", "border-right-style", "border-right-width", "border-bottom-color", "border-bottom-style", "border-bottom-width",
  "border-left-color", "border-left-style", "border-left-width", "padding", "content", "mask-image", "-webkit-mask-image"];

/** Observe the source's presentation, not renderer-owned styles/meta in head. */
function themeWitness(document: Document, context?: HTMLElement): () => string {
  const view = document.defaultView!;
  const elements: Element[] = [document.body];
  for (let element: HTMLElement | null = context ?? null; element !== null && element !== document.body; element = element.parentElement) {
    elements.push(element);
  }
  if (context !== undefined) elements.push(...context.querySelectorAll("th, td"));
  const last = new Map<Element, string>();
  return () => {
    const parts = [String(document.body.classList.contains("theme-dark")), String(document.body.classList.contains("theme-light")),
      document.getElementById("theme")?.textContent ?? ""];
    for (const element of elements) {
      // A host render-child replacement is not a theme change. Its surviving
      // note scopes/body remain observed; the replaced child's style is frozen.
      if (!element.isConnected && last.has(element)) { parts.push(last.get(element)!); continue; }
      const values: string[] = [];
      const style = view.getComputedStyle(element);
      values.push(...presentationProperties.map((property) => style.getPropertyValue(property)));
      if (element === document.body || element === context) {
        for (const property of Array.from(style)) if (property.startsWith("--")) values.push(property, style.getPropertyValue(property));
      }
      for (const pseudo of ["::before", "::after"]) {
        const computed = view.getComputedStyle(element, pseudo);
        if (computed.content !== "none" && computed.content !== "") {
          values.push(pseudo, ...presentationProperties.map((property) => computed.getPropertyValue(property)));
        }
      }
      const value = values.join("\n"); last.set(element, value); parts.push(value);
    }
    return parts.join("\n");
  };
}

/** Shallow source scopes retain cssclasses/Callout selectors, without controls. */
function sourceScope(staging: HTMLElement, context?: HTMLElement): HTMLElement {
  if (context === undefined) { staging.classList.add("markdown-preview-view", "markdown-rendered"); return staging; }
  const ancestors: HTMLElement[] = [];
  for (let element: HTMLElement | null = context; element !== null && element !== staging.ownerDocument.body; element = element.parentElement) {
    if (!element.matches("table, thead, tbody, tfoot, tr, th, td, .structural-tables-container")) ancestors.unshift(element);
  }
  let parent = staging;
  for (const ancestor of ancestors) {
    const scope = staging.ownerDocument.createElement(ancestor.tagName.toLowerCase());
    for (const { name, value } of ancestor.attributes) {
      if (name === "class" || name === "style" || name === "dir" || name === "lang" || name.startsWith("data-")) scope.setAttribute(name, value);
    }
    scope.classList.add("structural-tables-image-scope");
    parent.append(scope); parent = scope;
  }
  return parent;
}

function sourcePresentation(staging: HTMLElement, context?: HTMLElement): void {
  if (context === undefined) return;
  const view = staging.ownerDocument.defaultView!;
  const computed = view.getComputedStyle(context);
  for (const property of Array.from(computed)) {
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

async function waitForMath(root: HTMLElement, signal: AbortSignal): Promise<void> {
  // The host owns Markdown/math syntax. Flush its public completion barrier,
  // then inspect only actual rendered math nodes, never dollars in raw links.
  await imageWork(finishRenderMath(), signal);
  if (root.querySelector("[data-mjx-error], mjx-merror, .MathJax_Error, .katex-error") !== null) throw new TableImageError("resource");
  const expected = Array.from(root.querySelectorAll("mjx-container, .math, .katex")).filter((node) => node.parentElement?.closest("mjx-container, .math, .katex") === null);
  const complete = (): boolean => expected.every((cell) => cell.matches(".katex")
    || cell.querySelector("svg path, svg use, svg rect, svg line, mjx-c") !== null);
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

async function inlineImages(root: HTMLElement, signal: AbortSignal, budget: ResourceBudget): Promise<void> {
  // Rasterize already-loaded attachments locally. This works with app:// URLs
  // without fetching the Vault again. Cross-origin taint fails explicitly.
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
    budget.bytes += data.length * 0.75;
    if (budget.bytes > TABLE_IMAGE_LIMITS.resourceBytes) throw new TableImageError("too-large");
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

interface ResourceBudget { bytes: number; urls: Map<string, Promise<string>> }

async function resourceData(url: string, document: Document, signal: AbortSignal, budget: ResourceBudget): Promise<string> {
  if (url.startsWith("data:")) return url;
  const absolute = new URL(url, document.baseURI).href;
  let pending = budget.urls.get(absolute);
  if (pending === undefined) {
    pending = (async () => {
      const view = document.defaultView!;
      const response = await imageWork(view.fetch(absolute, { signal }), signal);
      if (!response.ok) throw new TableImageError("resource");
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length + budget.bytes > TABLE_IMAGE_LIMITS.resourceBytes) throw new TableImageError("too-large");
      const blob = await imageWork(response.blob(), signal);
      budget.bytes += blob.size;
      if (budget.bytes > TABLE_IMAGE_LIMITS.resourceBytes) throw new TableImageError("too-large");
      const reader = new view.FileReader();
      try {
        return await imageWork(new Promise<string>((resolve, reject) => {
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new TableImageError("resource"));
          reader.onerror = () => reject(new TableImageError("resource"));
          reader.readAsDataURL(blob);
        }), signal);
      } finally { if (reader.readyState === reader.LOADING) reader.abort(); }
    })();
    budget.urls.set(absolute, pending);
  }
  return imageWork(pending, signal);
}

const cssURL = /url\(\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^)]*?))\s*\)/giu;
async function embedCSSURLs(value: string, document: Document, signal: AbortSignal, budget: ResourceBudget,
  images: boolean): Promise<string> {
  let output = "";
  let cursor = 0;
  for (const match of value.matchAll(cssURL)) {
    const url = (match[1] ?? match[2] ?? match[3] ?? "").trim().replace(/\\(["'\\() ])/gu, "$1");
    if (url === "") throw new TableImageError("resource");
    if (url.startsWith("#")) continue;
    const data = await resourceData(url, document, signal, budget);
    if (images) {
      const image = document.createElement("img");
      image.src = data;
      try { await decodeImage(image, signal); } finally { image.removeAttribute("src"); }
    }
    output += value.slice(cursor, match.index) + `url("${data}")`;
    cursor = match.index + match[0].length;
  }
  return output + value.slice(cursor);
}

function fontSources(value: string): string[] {
  // Split the browser-normalized src descriptor at top-level commas.
  const sources: string[] = [];
  let depth = 0; let quote = ""; let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "\\") { index += 1; continue; }
    if (quote !== "") { if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) { sources.push(value.slice(start, index).trim()); start = index + 1; }
  }
  sources.push(value.slice(start).trim());
  return sources;
}

const fontDescriptors = [
  ["style", "font-style", "normal"], ["weight", "font-weight", "normal"], ["stretch", "font-stretch", "normal"],
  ["unicodeRange", "unicode-range", "U+0-10FFFF"], ["featureSettings", "font-feature-settings", "normal"],
  ["variationSettings", "font-variation-settings", "normal"], ["display", "font-display", "auto"],
  ["ascentOverride", "ascent-override", "normal"], ["descentOverride", "descent-override", "normal"],
  ["lineGapOverride", "line-gap-override", "normal"],
] as const;

function faceDescriptors(face: CSSFontFaceRule): FontFaceDescriptors {
  const descriptors: FontFaceDescriptors = {};
  for (const [key, property] of fontDescriptors) {
    const value = face.style.getPropertyValue(property);
    if (value !== "") Object.assign(descriptors, { [key]: value });
  }
  return descriptors;
}

function fontIdentity(font: FontFace): string {
  return [font.family.replace(/["']/gu, "").trim().toLowerCase(),
    ...fontDescriptors.map(([key, , fallback]) => (font[key] || fallback).replace(/\s+/gu, " ").trim().toLowerCase())].join("\n");
}

async function embeddedFonts(root: HTMLElement, signal: AbortSignal, budget: ResourceBudget): Promise<string> {
  const view = root.ownerDocument.defaultView;
  if (view === null) throw new TableImageError("resource");
  const families = new Set<string>();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const pseudo of [null, "::before", "::after"]) {
      const style = view.getComputedStyle(element, pseudo);
      if (pseudo !== null && (style.content === "none" || style.content === "")) continue;
      for (const family of style.fontFamily.split(",")) families.add(family.trim().replace(/["']/gu, "").toLowerCase());
    }
  }
  const result: string[] = [];
  const connected = new Map<string, FontFace[]>();
  for (const font of root.ownerDocument.fonts) {
    const identity = fontIdentity(font);
    const group = connected.get(identity) ?? []; group.push(font); connected.set(identity, group);
  }
  const visit = async (rules: CSSRuleList, base: string): Promise<void> => {
    for (const rule of rules) {
      if (rule instanceof view.CSSFontFaceRule) {
        const face = rule;
        if (face.style.fontFamily === "" || face.style.getPropertyValue("src") === "") continue;
        if (!families.has(face.style.fontFamily.replace(/["']/gu, "").trim().toLowerCase())) continue;
        const descriptors = faceDescriptors(face);
        // CSS-connected faces iterate in their rule's document order. Consume
        // one corresponding face per rule, including unloaded rules. Complete
        // normalized descriptors distinguish subsets/widths; occurrence order
        // distinguishes identical descriptors with different src. Never let a
        // different loaded face sponsor an unloaded rule's resource fetch.
        // https://www.w3.org/TR/css-font-loading-3/#fontfaceset
        const identity = fontIdentity(new view.FontFace(face.style.fontFamily, face.style.getPropertyValue("src"), descriptors));
        const font = connected.get(identity)?.shift();
        // A failed/unselected face already falls back in the source. Retain that
        // visible fallback instead of introducing a new required network load.
        if (font?.status !== "loaded") continue;
        let selected: string | undefined;
        for (const source of fontSources(face.style.getPropertyValue("src"))) {
          try {
            // Probe src in its actual priority order. local() success needs no
            // URL fallback; URL sources are made self-contained and validated.
            const resolved = source.replace(cssURL, (_raw, quoted: string | undefined, single: string | undefined, plain: string | undefined) =>
              `url("${new URL(quoted ?? single ?? plain ?? "", base).href}")`);
            const embedded = await embedCSSURLs(resolved, root.ownerDocument, signal, budget, false);
            const probe = new view.FontFace(face.style.fontFamily, embedded, descriptors);
            await imageWork(probe.load(), signal);
            selected = embedded; break;
          } catch (error) {
            signal.throwIfAborted();
            if (error instanceof TableImageError && error.code === "too-large") throw error;
          }
        }
        if (selected === undefined) throw new TableImageError("resource");
        const sheet = new view.CSSStyleSheet(); sheet.replaceSync(face.cssText);
        const copy = sheet.cssRules[0] as CSSFontFaceRule;
        copy.style.setProperty("src", selected);
        result.push(copy.cssText);
      } else if ("styleSheet" in rule && (rule as CSSImportRule).styleSheet !== null) {
        const imported = (rule as CSSImportRule).styleSheet!;
        const media = imported.media.mediaText || "";
        if (!imported.disabled && (media === "" || view.matchMedia(media).matches)) {
          await visit(imported.cssRules, imported.href ?? base);
        }
      } else if ("cssRules" in rule) {
        if (typeof view.CSSMediaRule === "function" && rule instanceof view.CSSMediaRule && !view.matchMedia(rule.conditionText).matches) continue;
        if (typeof view.CSSSupportsRule === "function" && rule instanceof view.CSSSupportsRule && !view.CSS.supports(rule.conditionText)) continue;
        await visit((rule as CSSGroupingRule).cssRules, base);
      }
    }
  };
  // Read only: unlike the library font collector, never insert imported rules
  // into the host stylesheet or fetch unrelated remote stylesheets.
  for (const sheet of root.ownerDocument.styleSheets) {
    const media = sheet.media.mediaText || "";
    if (sheet.disabled || (media !== "" && !view.matchMedia(media).matches)) continue;
    await visit(sheet.cssRules, sheet.href ?? root.ownerDocument.baseURI);
  }
  return result.join("\n");
}

/** Inspect actual attributes/declarations, including library-generated pseudos. */
async function embedSerializedResources(svg: string, document: Document, signal: AbortSignal, budget: ResourceBudget): Promise<string> {
  const view = document.defaultView!;
  const xml = new view.DOMParser().parseFromString(decodeURIComponent(svg.slice(svg.indexOf(",") + 1)), "image/svg+xml");
  if (xml.querySelector("parsererror") !== null) throw new TableImageError("resource");
  const declarations = async (style: CSSStyleDeclaration, images: boolean): Promise<void> => {
    for (const property of Array.from(style)) {
      // Unused custom variables are not resources. Computed visible properties
      // already have var() resolved by the browser before serialization.
      if (property.startsWith("--") || property === "cursor") continue;
      const value = style.getPropertyValue(property);
      if (!value.toLowerCase().includes("url(")) continue;
      style.setProperty(property, await embedCSSURLs(value, document, signal, budget, images), style.getPropertyPriority(property));
    }
  };
  for (const element of xml.querySelectorAll("[style]")) {
    const declaration = document.createElement("div").style;
    declaration.cssText = element.getAttribute("style")!;
    await declarations(declaration, true);
    element.setAttribute("style", declaration.cssText);
  }
  const rules = async (list: CSSRuleList): Promise<void> => {
    for (const rule of list) {
      if ("styleSheet" in rule) throw new TableImageError("resource");
      if ("style" in rule) await declarations((rule as CSSStyleRule).style, !(rule instanceof view.CSSFontFaceRule));
      if ("cssRules" in rule) await rules((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const element of xml.querySelectorAll("style")) {
    const sheet = new view.CSSStyleSheet(); sheet.replaceSync(element.textContent ?? "");
    await rules(sheet.cssRules);
    element.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n");
  }
  for (const element of xml.querySelectorAll("img, image")) {
    const attribute = element.localName === "img" ? "src" : element.hasAttribute("href") ? "href" : "xlink:href";
    const url = element.getAttribute(attribute);
    if (url === null || url === "") throw new TableImageError("resource");
    const data = await resourceData(url, document, signal, budget);
    const image = document.createElement("img"); image.src = data;
    try { await decodeImage(image, signal); } finally { image.removeAttribute("src"); }
    element.setAttribute(attribute, data);
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new view.XMLSerializer().serializeToString(xml))}`;
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
  staging.className = "structural-tables-image-stage";
  staging.setAttribute("aria-hidden", "true");
  staging.setAttribute("inert", "");
  try {
    owner.load();
    if (!table.valid || table.rows.length * table.columnCount > TABLE_IMAGE_LIMITS.nodes) {
      throw new TableImageError("too-large");
    }
    sourcePresentation(staging, request.contextElement);
    const scope = sourceScope(staging, request.contextElement);
    const presentation = themeWitness(document, request.contextElement);
    const identity = presentation();
    const current = (): void => {
      signal.throwIfAborted();
      if (!request.isCurrent() || identity !== presentation()) throw new TableImageError("stale");
    };
    current();
    const rendered = renderStructuralTable(app, table, scope, request.sourcePath, owner);
    const root = rendered.parentElement!;
    root.classList.add("structural-tables-image-snapshot");
    Object.assign(root.dataset, { appearance: table.structural || settings.takeOverOrdinaryTables ? settings.appearance : "theme", density: settings.density,
      zebra: String(settings.zebraRows), layout: "content-left", tableKind: table.structural ? "structural" : "ordinary" });
    document.body.append(staging);
    await imageWork(tableRenderingComplete(rendered), signal);
    if (tableRenderingFailed(rendered)) throw new TableImageError("resource");
    await waitForMath(root, signal);
    await quietContent(root, signal);
    if (root.querySelector("iframe, video, audio, canvas, .internal-embed:not(.image-embed), .markdown-embed")) {
      throw new TableImageError("unsupported-content");
    }
    if (root.querySelectorAll("*").length > TABLE_IMAGE_LIMITS.nodes) throw new TableImageError("too-large");
    await imageWork(document.fonts.ready, signal);
    const budget: ResourceBudget = { bytes: 0, urls: new Map() };
    await inlineImages(root, signal, budget);
    inlineSvgSymbols(root);
    const fontEmbedCSS = await embeddedFonts(root, signal, budget);
    await nextFrame(document, signal);
    await nextFrame(document, signal);
    current();
    const width = Math.ceil(Math.max(root.scrollWidth, root.getBoundingClientRect().width));
    const height = Math.ceil(Math.max(root.scrollHeight, root.getBoundingClientRect().height));
    const size = tableImageDimensions(width, height);
    const background = document.defaultView!.getComputedStyle(staging).backgroundColor;
    let svg = await imageWork(toSvg(root, { width, height, fontEmbedCSS, backgroundColor: background,
      includeQueryParams: true, fetchRequestInit: { signal },
      filter: () => { signal.throwIfAborted(); return true; } }), signal);
    if (svg.length > TABLE_IMAGE_LIMITS.svgCharacters) throw new TableImageError("too-large");
    svg = await embedSerializedResources(svg, document, signal, budget);
    if (svg.length > TABLE_IMAGE_LIMITS.svgCharacters) throw new TableImageError("too-large");
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
