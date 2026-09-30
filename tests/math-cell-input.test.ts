import { describe, expect, it } from "vitest";
import { mathCellInputProblem, mathPipeSuggestions, normalizeTableCellText } from "../src/core/table-cell-syntax";
import { editCellAndAppendRow, editCellContent } from "../src/core/operations";
import { parseEditableTables } from "../src/core/parser";
import { serializeStructuralTable } from "../src/core/serializer";
import { importedHtmlTableToStructuralSource } from "../src/core/interchange";

const source = "| H | V |\n| --- || --- |\n| A | B |";
const table = () => parseEditableTables(source).tables[0]!;

describe("math cell input fidelity", () => {
  it.each([
    "$E=mc^2$", String.raw`$\frac{a}{b}$`, String.raw`$\lvert x\rvert$`,
    String.raw`$\lVert x\rVert$`, String.raw`$P(A\mid B)$`, String.raw`$\|x\|$`,
    String.raw`$\begin{matrix}a&b\\c&d\end{matrix}$`,
    String.raw`$$\begin{aligned}a&=b\\c&=d\end{aligned}$$`,
    String.raw`$a\% + b$`, String.raw`$\text{cost \$5}$`,
    String.raw`$\{a\}$`, String.raw`$\\\|x$`,
  ])("preserves safe math through edit, parse, format and no-op commit: %s", (input) => {
    expect(mathCellInputProblem(input)).toBeNull();
    expect(normalizeTableCellText(input)).toBe(input);
    const edited = editCellContent(table(), 1, 1, input);
    expect(edited.changed).toBe(true);
    const parsed = parseEditableTables(edited.source).tables[0]!;
    expect(parsed.columnCount).toBe(2);
    expect(parsed.rows[1]!.cells[1]!.content).toBe(input);
    expect(serializeStructuralTable(parsed)).toBe(edited.source);
    expect(editCellContent(parsed, 1, 1, input)).toMatchObject({ changed: false, code: "cell-edited", source: edited.source });
  });

  it.each([
    ["$|x|$", "math-pipe-unsafe"], ["$P(A|B)$", "math-pipe-unsafe"],
    [String.raw`$\begin{array}{c|c}a&b\end{array}$`, "math-pipe-unsafe"],
    [String.raw`$\\|x$`, "math-pipe-unsafe"], [String.raw`$\\\\|x$`, "math-pipe-unsafe"],
    [String.raw`$\verb|a|$`, "math-syntax-unsafe"], [String.raw`$\verb+a|b+$`, "math-syntax-unsafe"],
    ["$x % comment$", "math-syntax-unsafe"], [String.raw`$x\\% comment$`, "math-syntax-unsafe"],
    ["$x", "math-syntax-unsafe"], ["$$x$", "math-syntax-unsafe"], ["$x} $", "math-syntax-unsafe"],
    ["$x_{a$", "math-syntax-unsafe"], ["$\\text{$x$}$", "math-syntax-unsafe"],
  ])("refuses unsafe input before either a write or an appended row: %s", (input, code) => {
    expect(mathCellInputProblem(input!)).toBe(code);
    expect(() => normalizeTableCellText(input!)).toThrow(code);
    expect(editCellContent(table(), 1, 1, input!)).toMatchObject({ changed: false, code, source });
    expect(editCellAndAppendRow(table(), 1, 1, input!)).toMatchObject({ changed: false, code, source });
  });

  it("offers only bounded, already-safe rewrites for common bare math pipes", () => {
    expect(mathPipeSuggestions("$|x|$")).toEqual([
      { kind: "absolute-value", replacement: String.raw`$\lvert x\rvert$` },
    ]);
    expect(mathPipeSuggestions("$P(A|B)$")).toEqual([
      { kind: "conditional", replacement: String.raw`$P(A\mid B)$` },
    ]);

    for (const input of [
      String.raw`$\begin{array}{c|c}a&b\end{array}$`,
      String.raw`$\verb|a|$`,
      "Text $|x|$",
      "$|a|b|$",
      String.raw`$|x\|$`,
      String.raw`$P(\text{A|B})$`,
      String.raw`$|\foo{x}|$`,
      "$|x$ prose $y|$",
      "$P(A(B|C))$",
      "$|x% comment|$",
      "$|x_{a}|$",
    ]) expect(mathPipeSuggestions(input)).toEqual([]);

    for (const suggestion of [...mathPipeSuggestions("$|x|$"), ...mathPipeSuggestions("$P(A|B)$")]) {
      expect(mathCellInputProblem(suggestion.replacement)).toBeNull();
    }
  });
  it.each(["$|-x + 1|$", "$|α^2|$", "$P((A+B)|C)$"])("offers a safe rewrite for simple operands: %s", (input) => {
    const [suggestion] = mathPipeSuggestions(input);
    expect(suggestion).toBeDefined();
    const result = editCellContent(table(), 1, 1, suggestion!.replacement);
    expect(result.changed).toBe(true);
    expect(parseEditableTables(result.source).tables[0]!.columnCount).toBe(2);
  });
  it.each(["\n", "\r\n", "\r"])("refuses actual math newlines including escaped ones (%j)", (newline) => {
    for (const input of [`$$${newline}a=b${newline}$$`, `$a\\${newline}b$`]) {
      expect(mathCellInputProblem(input)).toBe("math-multiline-unsafe");
      expect(editCellContent(table(), 1, 1, input).source).toBe(source);
    }
  });

  it("keeps code, Wiki aliases, image sizes and ordinary breaks separate from math", () => {
    const input = "Text | `$|x|$` [[Note$|Alias]] ![[Image.png|300]]\n" + String.raw`$\lvert x\rvert$`;
    expect(normalizeTableCellText(input)).toBe(String.raw`Text \| ` + "`$|x|$` " + String.raw`[[Note$\|Alias]] ![[Image.png\|300]]<br>$\lvert x\rvert$`);
    expect(normalizeTableCellText(String.raw`Cost \$5 | item`)).toBe(String.raw`Cost \$5 \| item`);
  });

  it("refuses HTML table import before source-math text can be escaped or flattened", () => {
    expect(importedHtmlTableToStructuralSource([{ section: "body", cells: [
      { text: "$|x|$", rowSpan: 1, columnSpan: 1, header: false },
      { text: "value", rowSpan: 1, columnSpan: 1, header: false },
    ] }])).toBeNull();
  });
});
