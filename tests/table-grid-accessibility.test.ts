import { describe, expect, it } from "vitest";
import { applyTableGridAccessibility } from "../src/editor/table-grid-accessibility";

describe("interactive table accessibility", () => {
  it("exposes row and cell coordinates and an explicit multi-selection state", () => {
    const table = document.createElement("table");
    table.innerHTML = "<tbody><tr><td data-structural-row='0' data-structural-column='0'>A</td><td data-structural-row='0' data-structural-column='1'>B</td></tr><tr><td data-structural-row='1' data-structural-column='0'>C</td><td data-structural-row='1' data-structural-column='1'>D</td></tr></tbody>";
    applyTableGridAccessibility(table);

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
    table.innerHTML = "<tbody><tr><td aria-selected='true'>A</td></tr></tbody>";
    applyTableGridAccessibility(table);
    expect(table.querySelector("td")?.getAttribute("aria-selected")).toBe("true");
  });
});
