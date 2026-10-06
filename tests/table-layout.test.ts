// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const styles = readFileSync("styles.css", "utf8");

afterEach(() => {
  vi.restoreAllMocks();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("table appearance", () => {
  function mount(appearance: string): HTMLTableElement {
    const theme = document.head.appendChild(document.createElement("style"));
    theme.textContent = `
      body { --table-cell-padding: 4px 10px; --table-border-width: 1px;
        --table-column-first-border-width: 0px; --table-column-last-border-width: 0px;
        --table-row-last-border-width: 0px; --table-edge-cell-padding-first: 0px;
        --table-edge-cell-padding-last: 0px; --text-normal: black; --table-border-color: gray; }
      .markdown-rendered td { border: 1px solid gray; padding: 4px 10px; }
      .markdown-rendered tbody tr td:first-child { padding-left: 0px; border-left-width: 0px; }
    `;
    document.head.appendChild(document.createElement("style")).textContent = styles;
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "structural-tables-container markdown-rendered";
    host.dataset.appearance = appearance;
    host.innerHTML = `<table class="structural-tables-table">
      <thead><tr><th colspan="2">Group</th></tr><tr><th>H1</th><th>H2</th></tr></thead>
      <tbody><tr><td rowspan="2" data-structural-column="0" data-structural-block-end="true">A</td>
      <td data-structural-column="1" data-structural-inline-end="true">B</td></tr>
      <tr><td data-structural-column="1" data-structural-inline-end="true" data-structural-block-end="true">C</td></tr></tbody>
    </table>`;
    return host.querySelector("table")!;
  }

  it("uses logical edges when a rowspan makes an interior cell the first DOM child", () => {
    const table = mount("theme");
    const cell = getComputedStyle(table.rows[3]!.cells[0]!);
    expect(cell.getPropertyValue("border-inline-start-width")).toBe("1px");
    expect(cell.getPropertyValue("border-inline-end-width")).toBe("0px");
    expect(getComputedStyle(table.rows[2]!.cells[0]!).getPropertyValue("border-block-end-width")).toBe("0px");
  });

  it("keeps full cell borders in grid style", () => {
    const table = mount("grid");
    expect(getComputedStyle(table.rows[3]!.cells[0]!).borderTopWidth).toBe("1px");
    expect(getComputedStyle(table).borderCollapse).toBe("collapse");
  });

  it.each(["structural-tables-container", "structural-tables-live-preview"])(
    "uses the Callout border color for owned headers in %s without changing native tables",
    (wrapperClass) => {
      document.head.appendChild(document.createElement("style")).textContent = `
        body { --table-border-color: rgb(100, 100, 100);
          --table-header-border-color: rgb(100, 100, 100); }
        .callout { --table-border-color: rgb(80, 140, 200); }
        .markdown-rendered :is(th, td) { border: 1px solid var(--table-border-color); }
        .markdown-rendered thead th { border-color: var(--table-header-border-color);
          border-top-width: 2px; }
      `;
      document.head.appendChild(document.createElement("style")).textContent = styles;
      const cells = "<thead><tr><th>Case</th><th>Value</th></tr></thead>"
        + "<tbody><tr><th scope='row'>Absolute</th><td>x</td></tr></tbody>";
      document.body.innerHTML = `<div class="callout markdown-rendered">
        <div class="${wrapperClass}" data-appearance="theme">
          <table class="structural-tables-table">${cells}</table>
        </div><table class="native-reference">${cells}</table>
      </div><div class="markdown-rendered"><table class="structural-tables-table outside-reference">${cells}</table></div>`;
      const owned = document.querySelector(".callout .structural-tables-table")!;
      for (const cell of owned.querySelectorAll("th, td")) {
        expect(getComputedStyle(cell).borderTopColor).toBe("rgb(80, 140, 200)");
      }
      expect(getComputedStyle(owned.querySelector("thead th")!).borderTopWidth).toBe("2px");
      for (const selector of [".native-reference thead th", ".outside-reference thead th"]) {
        expect(getComputedStyle(document.querySelector(selector)!).borderTopColor).toBe("rgb(100, 100, 100)");
      }
    },
  );

  it.each(["grid", "three-line"])("gives column and row headers a stable hierarchy in %s style", (appearance) => {
    document.head.appendChild(document.createElement("style")).textContent = `
      body {
        --table-border-width: 1px;
        --table-border-color: rgb(100, 100, 100);
        --table-header-background: rgb(230, 230, 230);
        --background-secondary: rgb(240, 240, 240);
        --font-semibold: 600;
        --text-normal: black;
      }
    `;
    document.head.appendChild(document.createElement("style")).textContent = styles;
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "structural-tables-container markdown-rendered";
    host.dataset.appearance = appearance;
    host.innerHTML = `<table class="structural-tables-table">
      <thead><tr><th data-structural-column="0">Region</th><th data-structural-column="1">Value</th></tr></thead>
      <tbody><tr><th scope="row" data-structural-column="0">North</th><td data-structural-column="1">10</td></tr></tbody>
    </table>`;
    const columnHeader = host.querySelector("thead th")!;
    const rowHeader = host.querySelector("tbody th")!;
    const data = host.querySelector("tbody td")!;

    expect(getComputedStyle(columnHeader).fontWeight).toBe("600");
    expect(getComputedStyle(rowHeader).fontWeight).toBe("600");
    expect(getComputedStyle(rowHeader).textAlign).toBe("start");
    if (appearance === "grid") {
      expect(getComputedStyle(columnHeader).backgroundColor).toBe("rgb(230, 230, 230)");
      expect(getComputedStyle(rowHeader).backgroundColor).toBe("rgb(230, 230, 230)");
      expect(getComputedStyle(data).backgroundColor).not.toBe("rgb(230, 230, 230)");
    } else {
      expect(getComputedStyle(columnHeader).backgroundColor).toBe("transparent");
      expect(getComputedStyle(rowHeader).backgroundColor).toBe("transparent");
      expect(Number.parseFloat(getComputedStyle(rowHeader).borderLeftWidth)).toBe(0);
    }
  });

  it.each(["grid", "three-line"])("lets explicit column alignment override row-header defaults in %s style", (appearance) => {
    document.head.appendChild(document.createElement("style")).textContent = styles;
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "structural-tables-container markdown-rendered";
    host.dataset.appearance = appearance;
    host.innerHTML = `<table class="structural-tables-table"><tbody><tr>
      <th scope="row" data-align="center">Centered</th>
      <th scope="row" data-align="right">Right</th>
      <th scope="rowgroup">Default</th>
    </tr></tbody></table>`;

    const headers = host.querySelectorAll("th");
    expect(getComputedStyle(headers[0]!).textAlign).toBe("center");
    expect(getComputedStyle(headers[1]!).textAlign).toBe("right");
    expect(getComputedStyle(headers[2]!).textAlign).toBe("start");
  });

  it.each(["grid", "three-line"])("keeps selected header cells visually selected in %s style", (appearance) => {
    document.head.appendChild(document.createElement("style")).textContent = `
      body {
        --table-header-background: rgb(230, 230, 230);
        --background-secondary: rgb(240, 240, 240);
        --table-selection: rgb(120, 160, 220);
        --table-selection-border-color: rgb(20, 80, 180);
        --table-selection-border-width: 1px;
        --interactive-accent: rgb(20, 80, 180);
        --text-normal: black;
      }
    `;
    document.head.appendChild(document.createElement("style")).textContent = styles;
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "structural-tables-live-preview markdown-rendered";
    host.dataset.appearance = appearance;
    host.innerHTML = `<table class="structural-tables-table"><tbody><tr>
      <th scope="row" class="is-selected">North</th><td>10</td>
    </tr></tbody></table>`;

    expect(getComputedStyle(host.querySelector("th")!).backgroundColor).toBe("rgb(120, 160, 220)");
  });

  it.each(["grid", "three-line"])("does not apply range fill to an actively edited selected header in %s", (appearance) => {
    document.head.appendChild(document.createElement("style")).textContent = `
      body {
        --table-header-background: rgb(230, 230, 230);
        --table-selection: rgb(120, 160, 220);
        --table-selection-border-color: rgb(20, 80, 180);
        --text-normal: black;
      }
    `;
    document.head.appendChild(document.createElement("style")).textContent = styles;
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "structural-tables-live-preview markdown-rendered";
    host.dataset.appearance = appearance;
    host.innerHTML = `<table class="structural-tables-table"><thead><tr>
      <th class="is-selected is-editing">North</th><th>Value</th>
    </tr></thead></table>`;
    const edited = getComputedStyle(host.querySelector("th")!);
    expect(edited.backgroundColor).not.toBe("rgb(120, 160, 220)");
    if (appearance === "grid") expect(edited.backgroundColor).toBe("rgb(230, 230, 230)");
  });

  it("leaves header fill and weight to the active theme in Follow theme mode", () => {
    document.head.appendChild(document.createElement("style")).textContent = `
      .markdown-rendered .structural-tables-table th {
        background: rgb(12, 34, 56);
        font-weight: 500;
      }
    `;
    document.head.appendChild(document.createElement("style")).textContent = styles;
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "structural-tables-container markdown-rendered";
    host.dataset.appearance = "theme";
    host.innerHTML = `<table class="structural-tables-table"><tbody><tr>
      <th scope="row">North</th><td>10</td>
    </tr></tbody></table>`;

    const header = getComputedStyle(host.querySelector("th")!);
    expect(header.backgroundColor).toBe("rgb(12, 34, 56)");
    expect(header.fontWeight).toBe("500");
  });

  it("places one rule under the whole header group and removes body cell borders", () => {
    const table = mount("three-line");
    expect(getComputedStyle(table).getPropertyValue("border-block")).toBe("2px solid black");
    expect(getComputedStyle(table.tHead!).getPropertyValue("border-block-end")).toBe("1px solid black");
    for (const cell of table.querySelectorAll("th, td")) {
      expect(Number.parseFloat(getComputedStyle(cell).borderTopWidth)).toBe(0);
    }
  });
});

describe("explicit table layouts", () => {
  it.each([0, 5])("reserves column-handle space after preceding content for touch input (%i touch points)", (touchPoints) => {
    vi.spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(touchPoints);
    document.head.appendChild(document.createElement("style")).textContent = styles;
    document.body.innerHTML = `<div class="structural-tables-live-preview">
      <div class="structural-tables-container"><p class="caption">Table caption</p>
        <table class="structural-tables-table"><tbody><tr><td>Value</td></tr></tbody></table>
      </div>
      <button class="structural-tables-column-handle"></button>
    </div><div class="structural-tables-container"></div>`;
    const host = getComputedStyle(document.querySelector(".structural-tables-live-preview")!);
    const handle = getComputedStyle(document.querySelector("button")!);
    const table = getComputedStyle(document.querySelector("table")!);
    if (touchPoints > 0) {
      const gutter = document.body.appendChild(document.createElement("div"));
      gutter.style.height = table.getPropertyValue("margin-block-start");
      expect(Number.parseFloat(getComputedStyle(gutter).height)).toBeGreaterThanOrEqual(Number.parseFloat(handle.height));
    } else {
      expect(Number.parseFloat(table.getPropertyValue("margin-block-start")) || 0).toBe(0);
    }
    expect(Number.parseFloat(host.getPropertyValue("padding-block-start")) || 0).toBe(0);
    expect(Number.parseFloat(getComputedStyle(document.querySelector(".structural-tables-container")!)
      .getPropertyValue("padding-block-start")) || 0).toBe(0);
  });

  it.each(["", "callout"])("keeps full touch row targets inside %s hosts without changing reading or native tables", (parentClass) => {
    vi.spyOn(navigator, "maxTouchPoints", "get").mockReturnValue(5);
    document.head.appendChild(document.createElement("style")).textContent = styles;
    document.body.innerHTML = `<div class="${parentClass}"><div class="structural-tables-live-preview">
      <div class="structural-tables-container"><p>Caption</p><table class="structural-tables-table"></table></div>
      <button class="structural-tables-row-handle"></button>
    </div></div><div class="structural-tables-container reading"><table class="structural-tables-table"></table></div>
      <table class="native-reference"></table>`;
    const host = getComputedStyle(document.querySelector(".structural-tables-live-preview")!);
    const rowHandle = getComputedStyle(document.querySelector("button")!);
    const inset = document.body.appendChild(document.createElement("div"));
    inset.style.width = host.getPropertyValue("padding-inline-start");
    expect(Number.parseFloat(getComputedStyle(inset).width)).toBeGreaterThanOrEqual(Number.parseFloat(rowHandle.width));
    expect(host.boxSizing).toBe("border-box");
    expect(Number.parseFloat(host.getPropertyValue("padding-block-start")) || 0).toBe(0);
    for (const selector of [".reading table", ".native-reference"]) {
      expect(Number.parseFloat(getComputedStyle(document.querySelector(selector)!).getPropertyValue("margin-block-start")) || 0).toBe(0);
    }
    // The important editor-width layer must retain the touch inset rather than reset it.
    expect(styles).toMatch(/@layer structural-tables-layout\s*\{[^}]*padding-inline:\s*var\(--structural-table-control-inset, 0\) 0 !important/u);
  });

  it("keeps the owned handle gutter paintable without changing other editor widgets", () => {
    document.head.appendChild(document.createElement("style")).textContent = styles;
    document.head.appendChild(document.createElement("style")).textContent =
      '.markdown-source-view.mod-cm6 .cm-content > [contenteditable="false"] { contain: paint !important; }';
    document.body.innerHTML = `<div class="markdown-source-view mod-cm6"><div class="cm-content">
      <div class="structural-tables-live-preview" contenteditable="false"><div class="structural-tables-container"></div></div>
      <div class="other-widget" contenteditable="false"></div>
    </div></div>`;
    expect(getComputedStyle(document.querySelector(".structural-tables-live-preview")!).contain).toBe("layout style");
    expect(getComputedStyle(document.querySelector(".other-widget")!).contain).toBe("paint");
    expect(getComputedStyle(document.querySelector(".structural-tables-container")!).overflowX).toBe("auto");
  });

  it.each(["content-left", "content-center", "pane"])("keeps %s sizing despite more specific theme rules", (layout) => {
    const plugin = document.head.appendChild(document.createElement("style"));
    plugin.textContent = styles;
    const theme = document.head.appendChild(document.createElement("style"));
    theme.textContent = ".markdown-source-view.mod-cm6 .cm-content .structural-tables-table { width: 100%; min-width: 900px; margin-inline: auto; }";
    const root = document.body.appendChild(document.createElement("div"));
    root.className = "markdown-source-view mod-cm6";
    const content = root.appendChild(document.createElement("div"));
    content.className = "cm-content";
    const host = content.appendChild(document.createElement("div"));
    host.className = "structural-tables-live-preview";
    host.dataset.layout = layout;
    const table = host.appendChild(document.createElement("table"));
    table.className = "structural-tables-table";
    const computed = getComputedStyle(table);
    expect(computed.width).toBe(layout === "pane" ? "100%" : "auto");
    expect(Number.parseFloat(computed.minWidth)).toBe(0);
    if (layout === "content-left") expect(Number.parseFloat(computed.getPropertyValue("margin-inline"))).toBe(0);
    if (layout === "content-center") expect(computed.getPropertyValue("margin-inline")).toBe("auto");
  });
});
