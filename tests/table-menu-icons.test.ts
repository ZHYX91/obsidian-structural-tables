// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";

import { physicalTableMenuIcon, registerTableMenuIcons } from "../src/editor/table-menu-icons";
import { Component } from "./mocks/obsidian";

afterEach(() => vi.restoreAllMocks());

describe("physical table menu icons", () => {
  it("keeps physical menu directions while preserving native RTL icon mirroring", () => {
    const style = document.createElement("style");
    style.textContent = ".mod-rtl svg.svg-icon:not(.check-small, .lucide-check) { transform: scale(-1, 1); }"
      + readFileSync("styles.css", "utf8");
    document.head.appendChild(style);
    const root = document.createElement("div");
    root.className = "mod-rtl";
    const menu = document.createElement("div");
    menu.className = "menu";
    root.appendChild(menu);
    document.body.appendChild(root);
    try {
      for (const name of ["arrow-left-to-line", "arrow-right-to-line", "arrow-left", "arrow-right", "align-left", "align-right"]) {
        for (const owned of [false, true]) {
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          icon.setAttribute("class", `svg-icon ${owned ? "structural-tables-physical" : "lucide"}-${name}`);
          menu.appendChild(icon);
          expect(getComputedStyle(icon).transform).toBe(owned ? "none" : "scale(-1, 1)");
        }
      }
    } finally {
      root.remove();
      style.remove();
    }
  });

  it("preserves native geometry without the host's RTL icon class and releases owned icons", () => {
    const source = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    source.setAttribute("class", "svg-icon lucide-arrow-left");
    source.setAttribute("viewBox", "0 0 24 24");
    source.setAttribute("stroke", "currentColor");
    const path = document.createElementNS(source.namespaceURI, "path");
    path.setAttribute("d", "M19 12H5");
    source.appendChild(path);
    const original = source.outerHTML;
    vi.spyOn(obsidian, "getIcon").mockImplementation(name => name === "arrow-left" ? source : null);
    const add = vi.spyOn(obsidian, "addIcon");
    const remove = vi.spyOn(obsidian, "removeIcon");
    const owner = new Component();
    registerTableMenuIcons(owner as unknown as obsidian.Component);
    const [id, markup] = add.mock.calls[0]!;
    const parsed = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    expect(parsed.getAttribute("class")).toBeNull();
    expect(parsed.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(parsed.getAttribute("width")).toBe("100");
    expect(parsed.getAttribute("height")).toBe("100");
    expect(parsed.getAttribute("stroke")).toBe("currentColor");
    expect(parsed.querySelector("path")?.getAttribute("d")).toBe("M19 12H5");
    expect(source.outerHTML).toBe(original);
    expect(physicalTableMenuIcon("arrow-left")).toBe(id);
    expect(physicalTableMenuIcon("align-right")).toBe("align-right");
    owner.unload();
    expect(remove).toHaveBeenCalledWith(id);
    expect(physicalTableMenuIcon("arrow-left")).toBe("arrow-left");
  });
});
