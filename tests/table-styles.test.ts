import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("table editing styles", () => {
  it("keeps the editor inside its cell with one outer focus border", () => {
    const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    const editorRule = /\.structural-tables-cell-editor\s*\{(?<body>[^}]*)\}/u.exec(styles)?.groups?.body ?? "";

    expect(editorRule).toContain("appearance: none");
    expect(editorRule).toContain("position: absolute");
    expect(editorRule).toContain("inset: 0");
    expect(editorRule).toContain("height: 100%");
    expect(editorRule).toContain("padding: inherit");
    expect(editorRule).toContain("min-inline-size: 0");
    expect(editorRule).toContain("resize: none");
    expect(editorRule).toContain("border: 0 !important");
    expect(editorRule).toContain("outline: 0 !important");
    expect(editorRule).toContain("box-shadow: none !important");
    expect(editorRule).toContain("background: transparent !important");
    expect(editorRule).toContain("background: transparent");
  });
});


describe("theme corner remapping stylesheet", () => {
  it("respects theme radius tokens and excludes Grid, Three-line and unowned tables", () => {
    const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    const remap = styles.slice(styles.indexOf("/* Theme-only corner remap:"), styles.indexOf('[data-appearance="grid"] .structural-tables-table {'));
    expect(remap).toContain('--structural-tables-corner-radius: var(--table-radius, var(--table-border-radius))');
    expect(remap).not.toContain("var(--radius-s");
    for (const corner of ["start-start", "start-end", "end-start", "end-end"]) {
      const segment = corner.replace(/-([a-z])/gu, (_part, letter: string) => letter.toUpperCase());
      expect(remap).toContain(`[data-structural-remap-${corner}="true"]`);
      expect(remap).toContain(`[data-structural-corner-${corner}="true"]`);
      expect(remap).toContain(`border-${corner}-radius: var(--structural-tables-corner-radius) !important`);
      expect(remap).toContain(`border-${corner}-radius: calc(var(--structural-tables-corner-radius) * 0) !important`);
      expect(segment).not.toBe("");
    }
    expect(remap.match(/\[data-appearance="theme"\]/gu)).toHaveLength(9);
  });
});