// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

const styles = readFileSync("styles.css", "utf8");

afterEach(() => {
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
