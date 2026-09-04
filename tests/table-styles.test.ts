import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("table editing styles", () => {
  it("keeps the editor inside its cell with one outer focus border", () => {
    const styles = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    const editorRule = /\.structural-tables-cell-editor\s*\{(?<body>[^}]*)\}/u.exec(styles)?.groups?.body ?? "";

    expect(editorRule).toContain("appearance: none");
    expect(editorRule).toContain("min-inline-size: 0");
    expect(editorRule).toContain("resize: none");
    expect(editorRule).toContain("border: 0 !important");
    expect(editorRule).toContain("outline: 0 !important");
    expect(editorRule).toContain("box-shadow: none !important");
    expect(editorRule).toContain("background: transparent !important");
    expect(editorRule).toContain("background: transparent");
  });
});
