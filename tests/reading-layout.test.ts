// @vitest-environment happy-dom
import { Component } from "obsidian";
import { describe, expect, it } from "vitest";
import { ownReadingLayout } from "../src/reading/layout-owner";

describe("reading layout ownership", () => {
  it("keeps a shared native section marked until its last table unloads", () => {
    const sizer = document.createElement("div");
    sizer.className = "markdown-preview-sizer";
    const section = sizer.appendChild(document.createElement("div"));
    const first = section.appendChild(document.createElement("div"));
    const second = section.appendChild(document.createElement("div"));
    const a = new Component();
    const b = new Component();
    ownReadingLayout(first, a);
    ownReadingLayout(second, b);
    a.unload();
    expect(section.classList.contains("structural-tables-reading-section")).toBe(true);
    b.unload();
    expect(section.classList.contains("structural-tables-reading-section")).toBe(false);
  });

  it("leaves nested content and detached staging nodes unmarked", () => {
    const container = document.createElement("div");
    const wrapper = container.appendChild(document.createElement("div"));
    ownReadingLayout(wrapper, new Component());
    ownReadingLayout(document.createElement("div"), new Component());
    expect(container.className).toBe("");
  });
});
