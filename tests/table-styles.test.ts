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
  it("requires resolved radius flags and scopes all corner rules to Follow theme", () => {
    const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    const start = styles.indexOf("/* Only repair logical outer corners");
    const end = styles.indexOf('[data-appearance="grid"] .structural-tables-table {', start);
    const rules = styles.slice(start, end);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    for (const corner of ["start-start", "start-end", "end-start", "end-end"]) {
      expect(rules).toContain(`[data-structural-remap-${corner}="true"][data-structural-ready-${corner}="true"]`);
      expect(rules).toContain(`[data-structural-corner-${corner}="true"]`);
      expect(rules).toContain(`border-${corner}-radius: var(--structural-tables-corner-${corner}) !important`);
      expect(rules).toContain(`border-${corner}-radius: 0 !important`);
    }
    expect(rules.match(/\[data-appearance="theme"\]/gu)).toHaveLength(8);
    expect(rules).not.toContain("var(--radius-s");
  });
});
