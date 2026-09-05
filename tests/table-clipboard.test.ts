// @vitest-environment happy-dom
import { App, Component, MarkdownRenderer } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseEditableTables } from "../src/core/parser";
import { copyHtml } from "../src/editor/table-interchange";
import { renderTableClipboard } from "../src/rendering/table-clipboard";

const source = `| Region | Sales | < |
| ^ | Q1 | Q2 |
| --- || --- | ---: |
| North | Rich | 12 |
| ^ | 8 | 11 |`;

afterEach(() => vi.restoreAllMocks());

describe("portable table clipboard", () => {
  it("keeps semantic spans and rich inline content with a readable plain-text alternative", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => {
      element.innerHTML = text === "Rich"
        ? '<p><strong>Bold</strong> <a href="https://example.com" class="external-link">Link</a><br><code>a|b</code> <a class="internal-link" href="Note">Alias</a><img src="local.png" alt="Diagram"></p>'
        : text;
    });
    const unload = vi.spyOn(Component.prototype, "unload");
    const result = await renderTableClipboard(new App(), parseEditableTables(source).tables[0]!, "Note.md", "grid");
    const document = new DOMParser().parseFromString(result.html, "text/html");
    expect(document.querySelector("thead th")?.getAttribute("rowspan")).toBe("2");
    expect(document.querySelector("thead th[colspan]")?.getAttribute("scope")).toBe("colgroup");
    expect(document.querySelector("tbody th")?.getAttribute("scope")).toBe("rowgroup");
    expect(document.querySelector("strong")?.textContent).toBe("Bold");
    expect(document.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(document.querySelector("code")?.textContent).toBe("a|b");
    expect(document.querySelector("img, [class], [href='Note']")).toBeNull();
    expect(result.text).toBe("Region\tSales / Q1\tSales / Q2\nNorth\tBold Link a|b AliasDiagram\t12\nNorth\t8\t11");
    expect(unload).toHaveBeenCalledOnce();
  });

  it("exports real three-line borders across the complete header group", async () => {
    const result = await renderTableClipboard(new App(), parseEditableTables(source).tables[0]!, "", "three-line");
    const document = new DOMParser().parseFromString(result.html, "text/html");
    const cells = document.querySelectorAll<HTMLTableCellElement>("th, td");
    expect(cells[0]!.style.borderTopWidth).toBe("1.5pt");
    expect(cells[0]!.style.borderBottomWidth).toBe("1pt");
    expect(cells[1]!.style.borderBottomWidth).toBe("0.5pt");
    expect(cells[2]!.style.borderBottomWidth).toBe("1pt");
    expect(document.querySelector<HTMLTableCellElement>("tbody th")!.style.borderBottomWidth).toBe("1.5pt");
    expect(cells[5]!.style.borderBottomStyle).toBe("none");
  });

  it("releases Markdown render components if rendering fails", async () => {
    vi.spyOn(MarkdownRenderer, "render").mockRejectedValue(new Error("render failed"));
    const unload = vi.spyOn(Component.prototype, "unload");
    await expect(renderTableClipboard(new App(), parseEditableTables(source).tables[0]!, "", "theme"))
      .rejects.toThrow("render failed");
    expect(unload).toHaveBeenCalledOnce();
  });

  it("uses readable text when rich clipboard writes are unavailable", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    vi.stubGlobal("ClipboardItem", undefined);
    try {
      await copyHtml("<table><tr><td>A</td><td>B</td></tr></table>", "A\tB");
      expect(writeText).toHaveBeenCalledWith("A\tB");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
