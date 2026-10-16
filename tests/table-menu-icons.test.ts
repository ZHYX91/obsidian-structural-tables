// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";

import { physicalTableMenuIcon, registerTableMenuIcons } from "../src/editor/table-menu-icons";
import { Component } from "./mocks/obsidian";

afterEach(() => vi.restoreAllMocks());

describe("physical table menu icons", () => {
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
