import { App, MarkdownRenderer } from "obsidian";
import { DEFAULT_SETTINGS } from "../../src/config/settings";
import { parseEditableTables } from "../../src/core/parser";
import { renderTableImage } from "../../src/rendering/table-image";

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
MarkdownRenderer.render = async (_app, source, target) => {
  await Promise.resolve();
  if (source.startsWith("![[")) target.createEl("img", { attr: { src: "/attachment.svg" } });
  else if (source.startsWith("$")) {
    const container = target.createEl("mjx-container" as "div");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "40"); svg.setAttribute("height", "24");
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttribute("href", "#math-glyph"); svg.append(use); container.append(svg);
  } else target.textContent = source;
};

async function run(): Promise<void> {
  const source = JSON.parse(document.getElementById("input")!.textContent!) as string;
  const tables = parseEditableTables(source).tables;
  const results: Array<{ width: number; height: number; red: number; blue: number; green: number; dark: number }> = [];
  for (const table of tables) {
    const result = await renderTableImage(new App(), { table, sourcePath: "Table image export.md", settings: DEFAULT_SETTINGS,
      document, signal: new AbortController().signal, isCurrent: () => true });
    const url = URL.createObjectURL(result.blob);
    const image = document.createElement("img"); image.src = url; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = result.width; canvas.height = result.height;
    const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, result.width, result.height).data;
    let red = 0; let blue = 0; let green = 0; let dark = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const [r, g, b] = [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!];
      if (r > 150 && g < 100 && b < 100) red += 1;
      if (b > 140 && r < 70 && g < 140) blue += 1;
      if (g > 100 && r < 70 && b < 70) green += 1;
      if (r < 100 && g < 100 && b < 100) dark += 1;
    }
    results.push({ width: image.naturalWidth, height: image.naturalHeight, red, blue, green, dark });
    URL.revokeObjectURL(url); canvas.width = 0; canvas.height = 0;
  }
  if (results.length !== 4 || !results.every((result) => result.dark > 100)
    || results[1]!.red < 100 || results[1]!.blue < 100 || results[1]!.green < 50
    || results[2]!.width <= window.innerWidth * 2 || results[3]!.height <= window.innerHeight * 2
    || document.querySelector(".structural-tables-image-stage") !== null) throw new Error(`Incomplete PNG smoke: ${JSON.stringify(results)}`);
  document.getElementById("result")!.textContent = JSON.stringify({ passed: true, results });
}
void run().catch((error: unknown) => { document.getElementById("result")!.textContent = JSON.stringify({ passed: false,
  error: error instanceof Error ? `${error.message}: ${String((error as { cause?: unknown }).cause ?? "")}` : String(error) }); });
