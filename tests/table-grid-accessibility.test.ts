// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createTranslator } from "../src/config/i18n";
import { applyTableGridAccessibility, labelTableGrid } from "../src/editor/table-grid-accessibility";

describe("interactive table accessibility", () => {
  it("names each editable grid in the selected language and updates its position when reused", () => {
    const table = document.createElement("table");
    const t = createTranslator("zh-CN");
    labelTableGrid(table, 0, t);
    expect(table.getAttribute("aria-label")).toBe("可编辑表格 1");
    labelTableGrid(table, 1, t);
    expect(table.getAttribute("aria-label")).toBe("可编辑表格 2");
    labelTableGrid(table, 1, createTranslator("en"));
    expect(table.getAttribute("aria-label")).toBe("Editable table 2");
  });

  it("exposes row and cell coordinates and an explicit multi-selection state", () => {
    const table = document.createElement("table");
    table.innerHTML = "<tbody><tr><td data-structural-row='0' data-structural-column='0'>A</td><td data-structural-row='0' data-structural-column='1'>B</td></tr><tr><td data-structural-row='1' data-structural-column='0'>C</td><td data-structural-row='1' data-structural-column='1'>D</td></tr></tbody>";
    applyTableGridAccessibility(table, 2);

    expect(table.getAttribute("role")).toBe("grid");
    expect(table.getAttribute("aria-multiselectable")).toBe("true");
    expect(table.getAttribute("aria-rowcount")).toBe("2");
    expect(table.getAttribute("aria-colcount")).toBe("2");
    expect(Array.from(table.rows).map((row) => row.getAttribute("role"))).toEqual(["row", "row"]);
    expect(Array.from(table.querySelectorAll("td")).map((cell) => [
      cell.getAttribute("role"), cell.getAttribute("aria-colindex"), cell.getAttribute("aria-selected"),
    ])).toEqual([
      ["gridcell", "1", "false"],
      ["gridcell", "2", "false"],
      ["gridcell", "1", "false"],
      ["gridcell", "2", "false"],
    ]);
  });

  it("preserves the selection state updated by the interaction layer", () => {
    const table = document.createElement("table");
    table.innerHTML = "<tbody><tr><td data-structural-column='0' aria-selected='true'>A</td></tr></tbody>";
    applyTableGridAccessibility(table, 1);
    expect(table.querySelector("td")?.getAttribute("aria-selected")).toBe("true");
  });
});
