import { App, Component, MarkdownRenderer } from "obsidian";
import MarkdownIt from "markdown-it";
import { DEFAULT_SETTINGS } from "../../src/config/settings";
import { parseEditableTables } from "../../src/core/parser";
import { renderTableImage, TableImageError } from "../../src/rendering/table-image";
import { renderStructuralTable, tableRenderingComplete } from "../../src/rendering/table-renderer";

type Options = { cls?: string; text?: string; attr?: Record<string, string> };
HTMLElement.prototype.createEl = function<K extends keyof HTMLElementTagNameMap>(tag: K, options?: Options): HTMLElementTagNameMap[K] {
  const element = this.ownerDocument.createElement(tag);
  if (options?.cls !== undefined) element.className = options.cls;
  if (options?.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options?.attr ?? {})) element.setAttribute(name, value);
  this.append(element); return element;
};
HTMLElement.prototype.createDiv = function(options?: Options): HTMLDivElement { return this.createEl("div", options); };

// A deterministic asynchronous host substitute. This checks the real parser,
// semantic renderer and PNG pipeline; it does not prove Obsidian or MathJax.
const markdown = new MarkdownIt();
let runtimeStyle = false;
MarkdownRenderer.render = async (_app, source, target) => {
  await Promise.resolve();
  if (runtimeStyle && document.getElementById("render-runtime-style") === null) {
    const style = document.createElement("style"); style.id = "render-runtime-style";
    style.textContent = ".unused-math-runtime{visibility:visible}"; document.head.append(style);
  }
  if (source.startsWith("![[")) target.createEl("img", { attr: { src: "/attachment.svg" } });
  else if (source.startsWith("$")) {
    const container = target.createEl("mjx-container" as "div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "40"); svg.setAttribute("height", "24");
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttribute("href", "#math-glyph"); svg.append(use); container.append(svg);
  } else if (source === "decoration" || source === "regular-decoration" || source === "missing-decoration") {
    target.createDiv({ cls: source, text: "text" });
  } else target.innerHTML = markdown.renderInline(source);
};

async function pixels(result: Awaited<ReturnType<typeof renderTableImage>>) {
    const url = URL.createObjectURL(result.blob);
    const image = document.createElement("img"); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = result.width; canvas.height = result.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, result.width, result.height).data;
    let red = 0; let blue = 0; let green = 0; let dark = 0; let hash = 2166136261;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const [r, g, b] = [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!];
      if (r > 150 && g < 100 && b < 100) red += 1;
      if (b > 140 && r < 70 && g < 140) blue += 1;
      if (g > 100 && r < 70 && b < 70) green += 1;
      if (r < 100 && g < 100 && b < 100) dark += 1;
      for (let channel = 0; channel < 4; channel += 1) hash = Math.imul(hash ^ pixels[offset + channel]!, 16777619) >>> 0;
    }
    const counts = { width: image.naturalWidth, height: image.naturalHeight, red, blue, green, dark, hash };
    URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0;
    return counts;
}

async function run(): Promise<void> {
  const source = JSON.parse(document.getElementById("input")!.textContent!) as string;
  const tables = parseEditableTables(source).tables;
  const results: Awaited<ReturnType<typeof pixels>>[] = [];
  for (const table of tables) {
    results.push(await pixels(await renderTableImage(new App(), { table, sourcePath: "Table image export.md", settings: DEFAULT_SETTINGS,
      document, signal: new AbortController().signal, isCurrent: () => true })));
  }
  if (results.length !== 4 || !results.every((result) => result.dark > 100)
    || results[1]!.red < 100 || results[1]!.blue < 100 || results[1]!.green < 50
    || results[2]!.width <= window.innerWidth * 2 || results[3]!.height <= window.innerHeight * 2
    || document.querySelector(".structural-tables-image-stage") !== null) throw new Error(`Incomplete PNG smoke: ${JSON.stringify(results)}`);

  const regression: Record<string, unknown> = {};
  const cases = async (value: string, cls = "", callout = false, mutate?: (sourceTable: HTMLTableElement) => void) => {
    const table = parseEditableTables(`| Header |\n| --- |\n| ${value} |`).tables[0]!;
    const scope = document.body.createDiv({ cls: `markdown-preview-view ${cls}` });
    const nested = callout ? scope.createDiv({ cls: "callout" }) : scope;
    if (callout) nested.dataset.callout = "warning";
    const content = callout ? nested.createDiv({ cls: "callout-content" }) : nested;
    const owner = new Component();
    const sourceTable = renderStructuralTable(new App(), table, content, "Table image export.md", owner);
    await tableRenderingComplete(sourceTable); await document.fonts.ready;
    const cell = sourceTable.querySelector("th")!;
    const sourceColor = getComputedStyle(cell).backgroundColor;
    const sourceBorder = getComputedStyle(sourceTable.querySelector("td")!).borderLeftColor;
    let changed = false;
    try {
      const result = await renderTableImage(new App(), { table, sourcePath: "Table image export.md", settings: DEFAULT_SETTINGS,
        document, signal: new AbortController().signal, contextElement: sourceTable.parentElement!, isCurrent: () => {
          if (!changed && mutate !== undefined) { changed = true; mutate(sourceTable); }
          return true;
        } });
      return { ...await pixels(result), sourceColor, sourceBorder };
    } finally { owner.unload(); scope.remove(); }
  };
  regression.noteScope = await cases("source styled", "theme-note");
  const note = regression.noteScope as Awaited<ReturnType<typeof cases>>;
  if (note.sourceColor !== "rgb(255, 0, 0)" || note.red < 1000) throw new Error(`Lost cssclass: ${JSON.stringify(note)}`);
  regression.calloutScope = await cases("source styled", "", true);
  const callout = regression.calloutScope as Awaited<ReturnType<typeof cases>>;
  if (callout.sourceBorder !== "rgb(0, 0, 255)" || callout.blue < 1000) throw new Error(`Lost Callout: ${JSON.stringify(callout)}`);
  regression.regular = await cases("regular-decoration");
  regression.pseudos = await cases("decoration");
  const pseudos = regression.pseudos as Awaited<ReturnType<typeof cases>>;
  if (pseudos.red < 5000 || pseudos.blue < 5000) throw new Error(`Lost pseudo resources: ${JSON.stringify(pseudos)}`);
  try { await cases("missing-decoration"); throw new Error("Missing pseudo resource succeeded"); }
  catch (error) { if (!(error instanceof TableImageError) || error.code !== "resource") throw error; regression.missingPseudo = error.code; }
  runtimeStyle = true;
  regression.runtimeStyle = await cases("unrelated head style"); runtimeStyle = false;
  regression.renderChildReplacement = await cases("stable source model", "theme-note", false,
    (table) => { table.parentElement!.replaceWith(document.createElement("div")); });
  regression.literalDollarsAndResources = await cases('[text](https://example.invalid/$x$) `background:url()` src=""');
  try { await cases("theme change", "", false, () => document.body.classList.add("theme-dark")); throw new Error("Theme change succeeded"); }
  catch (error) { if (!(error instanceof TableImageError) || error.code !== "stale") throw error; regression.changedTheme = error.code; }
  finally { document.body.classList.remove("theme-dark"); }
  regression.localFont = await cases("Local font WWW iii", "local-font");
  if (!Array.from(document.fonts).some((face) => face.family === "OnlyLocal" && face.status === "loaded")) throw new Error("Local font did not load in source");
  const localControl = await cases("Local font WWW iii", "local-control");
  if (localControl.hash !== (regression.localFont as typeof localControl).hash) throw new Error(`Local font PNG differs from local-only control: ${JSON.stringify({ local: regression.localFont, control: localControl })}`);
  regression.failedSourceFontFallback = await cases("Fallback font WWW iii", "broken-font");
  if (!Array.from(document.fonts).some((face) => face.family === "BrokenFace" && face.status === "error")) throw new Error("Fallback font did not exercise error face");
  const fallbackControl = await cases("Fallback font WWW iii", "fallback-control");
  if (fallbackControl.hash !== (regression.failedSourceFontFallback as typeof fallbackControl).hash) throw new Error("Source fallback PNG differs from serif control");
  const disabled = document.createElement("style");
  disabled.textContent = "@font-face{font-family:ConditionalFace;src:url('/missing-disabled.woff2')}";
  document.head.append(disabled); disabled.sheet!.disabled = true;
  const descriptorControl = await cases("ASCII only", "local-control");
  for (const [name, cls] of [["unicodeSubset", "subset-font"], ["fontStretch", "stretch-font"],
    ["duplicateDescriptors", "duplicate-font"], ["inactiveConditions", "conditional-font"]]) {
    const result = await cases("ASCII only", cls);
    if (result.hash !== descriptorControl.hash) throw new Error(`${name} font PNG differs from local-only control`);
    regression[name!] = result;
  }
  regression.fontFaces = Array.from(document.fonts).filter((face) => ["SubsetFace", "StretchFace", "DuplicateFace", "ConditionalFace"].includes(face.family))
    .map((face) => ({ family: face.family, unicodeRange: face.unicodeRange, stretch: face.stretch, status: face.status }));
  const requests = await (await window.fetch("/requests.json")).json() as { missingFont: number; fontRequests: Record<string, number> };
  if (requests.missingFont !== 0) throw new Error("Unselected font fallback was fetched");
  if (Object.values(requests.fontRequests).some((count) => count !== 0)) throw new Error(`Unselected font face was fetched: ${JSON.stringify(requests)}`);
  if (document.querySelector(".structural-tables-image-stage") !== null) throw new Error("Stage leaked");
  document.getElementById("result")!.textContent = JSON.stringify({ passed: true, results, regression, requests });
}
void run().catch((error: unknown) => { document.getElementById("result")!.textContent = JSON.stringify({ passed: false,
  error: error instanceof Error ? `${error.message}: ${String((error as { cause?: unknown }).cause ?? "")}` : String(error) }); });
