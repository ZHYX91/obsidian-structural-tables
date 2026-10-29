import { describe, expect, it } from "vitest";

import { validateDocumentReplacement } from "../src/core/document-replacement";

const TABLE = "| H | V |\n| --- | --- |\n| a | b |";
const MARKER = "PLACEHOLDER";

function replace(source: string, replacement = TABLE, whole = true): boolean {
  const from = source.indexOf(MARKER);
  return validateDocumentReplacement(source, { from, to: from + MARKER.length }, replacement, whole);
}

describe("complete-document inserted table ownership", () => {
  it.each(["\n", "\r\n", "\r"])("rejects adjoining prose without changing line endings %j", (ending) => {
    const table = TABLE.replace(/\n/gu, ending);
    for (const neighbor of ["| Later | prose | IMPORTANT THIRD CELL |", "| Later | prose |", "| Later |"])
      expect(replace(`${MARKER}${ending}${neighbor}`, table)).toBe(false);
    expect(replace(`| Above | prose |${ending}${MARKER}`, table)).toBe(false);
    expect(replace(`${MARKER}${ending}${ending}| Later | prose | IMPORTANT THIRD CELL |`, table)).toBe(true);
  });

  it.each([
    "prefix PLACEHOLDER", "PLACEHOLDER suffix", "> PLACEHOLDER", "- Item\n\n    PLACEHOLDER",
    "```text\nPLACEHOLDER\n```", "<div>\nPLACEHOLDER\n</div>", "$$\nPLACEHOLDER\n$$",
  ])("rejects a replacement whose full-document ownership differs in %s", (source) => {
    expect(replace(source)).toBe(false);
  });

  it("preserves identical outside tables and their hidden overflow source", () => {
    const overflow = `${TABLE}\n| extra | cells | KEEP-HIDDEN |`;
    const source = `${overflow}\n\n${MARKER}\n\n${TABLE}`;
    expect(replace(source)).toBe(true);
    const from = source.indexOf(TABLE);
    expect(validateDocumentReplacement(source, { from, to: from + overflow.length }, TABLE, true)).toBe(false);
  });

  it("allows a complete visible table selection but refuses a partial table or internal caret", () => {
    expect(validateDocumentReplacement(TABLE, { from: 0, to: TABLE.length }, TABLE.replace("a", "A"), true)).toBe(true);
    expect(validateDocumentReplacement(TABLE, { from: 2, to: TABLE.length }, TABLE, true)).toBe(false);
    expect(validateDocumentReplacement(TABLE, { from: 2, to: 2 }, TABLE, true)).toBe(false);
    const invalid = "| ^ | H |\n| --- | --- |";
    expect(validateDocumentReplacement(invalid, { from: 0, to: invalid.length }, TABLE, true)).toBe(false);
  });

  it("validates literal fallback tables without requiring or converting plain text", () => {
    const plain = "  first line\nsecond line\n  ";
    expect(replace(`Before\n\n${MARKER}\n\nAfter`, plain, false)).toBe(true);
    expect(replace(`${MARKER}\n| neighbor | prose | KEEP |`, TABLE, false)).toBe(false);
    expect(replace(`${MARKER}\n\nAfter`, `${TABLE}\n\n${TABLE}`, false)).toBe(true);
  });

  it("rejects invalid ranges and non-whole, invalid or hidden imported tables", () => {
    for (const range of [{ from: -1, to: 0 }, { from: 1, to: 0 }, { from: 0, to: 20 }, { from: 0.5, to: 1 }])
      expect(validateDocumentReplacement(MARKER, range, TABLE, true)).toBe(false);
    for (const replacement of ["text", `${TABLE}\n`, `${TABLE}\n| extra | cells | HIDDEN |`, "| ^ | H |\n| --- | --- |"])
      expect(replace(MARKER, replacement)).toBe(false);
  });
});
