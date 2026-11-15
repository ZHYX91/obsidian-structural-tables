import { describe, expect, it } from "vitest";
import MarkdownIt from "markdown-it";

import { editCellContent, removeTable, transposeTable } from "../src/core/operations";
import { parseEditableTables } from "../src/core/parser";
import { referenceDefinitionEnd } from "../src/core/reference-definition";
import { withSourcePrefix } from "../src/core/source-lines";
import { validateTableOperationInDocument } from "../src/core/table-operation-document";
import { reparseUnchangedTable, TableDocumentSnapshot } from "../src/core/table-snapshot";

const markdown = new MarkdownIt({ html: true });
const fake = "| H | < |\n| --- | --- |\n| a | b |";
const real = "| REAL | < |\n| --- | --- |\n| keep | safe |";
const endings = ["\n", "\r\n", "\r"] as const;
const definitions = [
  "[link]:\n  /url",
  "[link]: /url\n  \"Title\"",
  "[link]: /url \"Title\n  continued\"",
  "[link\n label]: /url",
];

function expectProtected(block: string, ending: string): void {
  const source = (block + "\n\n" + real).replace(/\n/gu, ending);
  const tokens = markdown.parse(source, {});
  expect(tokens.some((token) => ["html_block", "fence"].includes(token.type)
    && token.content.includes("| H | < |"))).toBe(true);
  expect(tokens.filter((token) => token.type === "table_open")).toHaveLength(1);
  const tables = parseEditableTables(source).tables;
  expect(tables.map((table) => table.source)).toEqual([real.replace(/\n/gu, ending)]);
  expect(tables[0]?.valid).toBe(true);
  expect(source.slice(tables[0]!.range.from, tables[0]!.range.to)).toBe(tables[0]!.source);
}

describe("protected Markdown block continuations", () => {
  it.each(["[a]: a\\\tb", "[a]:\n  a\\\tb", "[a\n label]: a\\\tb"].flatMap((definition) =>
    ["", "> ", "> > "].flatMap((prefix) => endings.map((ending) => ({ definition, prefix, ending })))))(
    "preserves escaped tabs in reference content ($definition/$prefix/$ending)", ({ definition, prefix, ending }) => {
      const block = withSourcePrefix(definition + "\n<span>\n" + fake + "\n</span>", prefix);
      const environment: { references?: Record<string, { href: string }> } = {};
      markdown.parse(block.replace(/\n/gu, ending), environment);
      expect(Object.values(environment.references ?? {}).map((reference) => reference.href)).toEqual(["a%5C%09b"]);
      expectProtected(block, ending);
    },
  );

  it.each([
    "- [a]: a\\\tb\n  <span>\n" + withSourcePrefix(fake, "  ") + "\n  </span>",
    "- [a]:\n\ta\\\tb\n  <span>\n" + withSourcePrefix(fake, "  ") + "\n  </span>",
    ">\t[a]: a\\\tb\n> <span>\n" + withSourcePrefix(fake, "> ") + "\n> </span>",
    "- >\t[a]:\n  >\ta\\\tb\n  > <span>\n" + withSourcePrefix(fake, "  > ") + "\n  > </span>",
  ])("uses tab columns only for reference container indentation: %s", (block) => {
    for (const ending of endings) expectProtected(block, ending);
  });

  it.each(["[a]: a\\ b", "[a]:\n  a\\ b", "[a]:\n  a\tb"])(
    "retains ordinary prose after an invalid spaced destination: %s", (definition) => {
      const source = definition + "\n<span>\n" + fake + "\n</span>";
      const environment: { references?: unknown } = {};
      expect(markdown.parse(source, environment).filter((token) => token.type === "table_open")).toHaveLength(1);
      expect(environment.references).toBeUndefined();
      expect(parseEditableTables(source).tables.map((table) => table.source)).toEqual([fake]);
    },
  );

  it.each(definitions.flatMap((definition) => ["", "> ", "> > "].flatMap((prefix) =>
    endings.map((ending) => ({ definition, prefix, ending })))))(
    "finishes a complete reference before standalone HTML ($definition/$prefix/$ending)", ({ definition, prefix, ending }) => {
      expectProtected(withSourcePrefix(definition + "\n<span>\n" + fake + "\n</span>", prefix), ending);
    },
  );

  it.each([
    "- [link]:\n    /url\n  <span>\n" + withSourcePrefix(fake, "  ") + "\n  </span>",
    "- outer\n  - [link]: /url\n      'title'\n    <span>\n" + withSourcePrefix(fake, "    ") + "\n    </span>",
    "> [link]:\n/url\n<span>\n" + fake + "\n</span>",
    "- [link]:\n/url\n<span>\n" + fake + "\n</span>",
    "[link]:\n    /url\n<span>\n" + fake + "\n</span>",
    "[link]: /url\n    (first\n    second)\n<span>\n" + fake + "\n</span>",
    "[link]: /one\n[next]: /two\n  \"title\"\n<span>\n" + fake + "\n</span>",
    "[link]: /url \"<!--\n  title\"\n<span>\n" + fake + "\n</span>",
    "[link]: /url \"%%\n  title\"\n<span>\n" + fake + "\n</span>",
    "[link]: /url \"$$\n  title\"\n<span>\n" + fake + "\n</span>",
  ])("keeps reference continuations in their real container: %s", (block) => {
    for (const ending of endings) expectProtected(block, ending);
  });

  it.each([
    "[link]: /url unexpected text",
    "[link]:\n  /url unexpected text",
    "[link]: /url \"unterminated",
    "[link]: /url\n  \"unterminated",
    "[link]: /url\n  (nested (title))",
    "[link]: /url\n  \"title\" extra",
    "[link]: /url(unclosed",
    "[link]: <unclosed",
    "[link]:\n  javascript:alert(1)",
    "[link]:\n  data:text/html,payload",
    "[link]:\n  javascr&#x69;pt&colon;alert(1)",
    "[link]:\n  <&ThickSpace;javascript\\:alert(1)>",
    "[]:\n  /url",
    "[   ]:\n  /url",
    "[bad[label]:\n  /url",
    "Paragraph\n[link]: /url\n  \"title\"",
  ])("does not end ordinary or malformed reference prose: %s", (head) => {
    const source = head + "\n<span>\n" + fake + "\n</span>\n\n" + real;
    expect(markdown.parse(source, {}).some((token) => token.type === "html_block"
      && token.content.includes("| H | < |"))).toBe(false);
    expect(parseEditableTables(source).tables.map((table) => table.source)).toEqual([fake, real]);
  });

  it.each(["https://example.test", "mailto:user@example.test", "/path", "data:image/png;base64,payload", "data&colon;image&sol;png&semi;payload"])(
    "recognizes allowed multiline reference destinations: %s", (destination) => {
      expectProtected("[link]:\n  " + destination + "\n<span>\n" + fake + "\n</span>", "\n");
    },
  );

  it.each(["[link]: /url \"unfinished", "[unfinished"])(
    "does not consume a real table while looking for a reference terminator: %s", (head) => {
      const source = head + "\n" + fake + "\n\"\n\n" + real;
      expect(markdown.parse(source, {}).filter((token) => token.type === "table_open")).toHaveLength(2);
      expect(parseEditableTables(source).tables.map((table) => table.source)).toEqual([fake, real]);
    },
  );

  it("keeps GFM precedence over a multiline reference-shaped table header", () => {
    const source = "[label | title\n--- | ---\nend]: /url | value\n\n" + real;
    expect(markdown.parse(source, {}).filter((token) => token.type === "table_open")).toHaveLength(2);
    expect(parseEditableTables(source).tables).toHaveLength(2);
  });

  it.each(endings)("keeps table-shaped lazy reference titles inside their quote (%j)", (ending) => {
    const title = "| TITLE | X |\n| --- | --- |\n| p | q |";
    const block = '> [a]: /url "title\n' + title + '\n> end"\n> <span>\n' + withSourcePrefix(fake, "> ") + "\n> </span>";
    expectProtected(block, ending);
    const environment: { references?: Record<string, { title: string }> } = {};
    markdown.parse(block.replace(/\n/gu, ending), environment);
    expect(environment.references?.A?.title).toContain(title);

    // With explicit quote markers, GFM can interrupt the incomplete title;
    // a quoted blank line then starts the protected standalone HTML block.
    const explicit = '> [a]: /url "title\n' + withSourcePrefix(title, "> ")
      + '\n> end"\n>\n> <span>\n' + withSourcePrefix(fake, "> ") + "\n> </span>\n\n" + real;
    const source = explicit.replace(/\n/gu, ending);
    expect(markdown.parse(source, {}).filter((token) => token.type === "table_open")).toHaveLength(2);
    expect(parseEditableTables(source).tables.map((table) => table.source))
      .toEqual([withSourcePrefix(title, "> ").replace(/\n/gu, ending), real.replace(/\n/gu, ending)]);
  });

  it.each([false, true])("scans a long reference title once without consuming later blocks (closed=%s)", (closed) => {
    const lines = Array.from({ length: 10_000 }, (_unused, index) =>
      index === 9_999 && closed ? "last line\"" : "continued title");
    const visited: number[] = [];
    expect(referenceDefinitionEnd('[link]: /url "', (offset) => {
      visited.push(offset);
      return lines[offset - 1] ?? null;
    })).toBe(closed ? 10_000 : null);
    expect(visited).toHaveLength(closed ? 10_000 : 10_001);
    expect(new Set(visited).size).toBe(visited.length);
    const source = '[link]: /url "\n' + lines.join("\n") + "\n\n" + real;
    expect(parseEditableTables(source).tables.map((table) => table.source)).toEqual([real]);
  });

  it.each(["-", "*", "+", "1.", "1)"].flatMap((marker) => ["```", "<pre>"].flatMap((opening) =>
    endings.map((ending) => ({ marker, opening, ending })))))(
    "resolves an empty list item before its protected block ($marker/$opening/$ending)", ({ marker, opening, ending }) => {
      const indent = " ".repeat(marker.length + 1);
      expectProtected(marker + "\n" + indent + "  " + opening + "\n" + withSourcePrefix(fake, indent)
        + "\n" + indent + (opening === "```" ? "```" : "</pre>"), ending);
    },
  );

  it.each(["", " ", "    ", "\t"])("uses one content space after an empty list marker with trailing %j", (tail) => {
    for (const prefix of ["", "> ", "> > "]) {
      expectProtected(withSourcePrefix("-" + tail + "\n    <pre>\n" + withSourcePrefix(fake, "  ") + "\n  </pre>", prefix), "\n");
    }
  });

  it.each(["-", "+", "1.", "1)"])("does not revive an empty list after a blank line: %s", (marker) => {
    const source = marker + "\n\n" + withSourcePrefix(fake, "    ") + "\n\n" + real;
    expect(markdown.parse(source, {}).some((token) => token.type === "code_block"
      && token.content.includes("| H | < |"))).toBe(true);
    expect(parseEditableTables(source).tables.map((table) => table.source)).toEqual([real]);
    const sibling = marker + "\n\n" + marker + " H | <\n--- | ---\na | b";
    expect(markdown.parse(sibling, {}).some((token) => token.type === "table_open")).toBe(false);
    expect(parseEditableTables(sibling).tables).toEqual([]);
  });

  it.each(["+", "*", "1.", "1)"])("does not let an empty list interrupt ordinary prose: %s", (marker) => {
    const source = "Paragraph\n" + marker + "\n<span>\n" + fake + "\n</span>\n\n" + real;
    expect(markdown.parse(source, {}).filter((token) => token.type === "table_open")).toHaveLength(2);
    expect(parseEditableTables(source).tables.map((table) => table.source)).toEqual([fake, real]);
  });

  it.each([4, 5, 6, 7, 8].flatMap((spaces) => ["```", "<pre>"].flatMap((opening) =>
    endings.map((ending) => ({ spaces, opening, ending })))))(
    "continues an already open quote before a protected block ($spaces/$opening/$ending)", ({ spaces, opening, ending }) => {
      expectProtected("> text\n" + " ".repeat(spaces) + "> " + opening + "\n" + withSourcePrefix(fake, "> ")
        + "\n> " + (opening === "```" ? "```" : "</pre>"), ending);
    },
  );

  it.each([
    "> text\nlazy\n    > ```\n" + withSourcePrefix(fake, "> ") + "\n> ```",
    "> > text\n> lazy\n>     > ```\n" + withSourcePrefix(fake, "> > ") + "\n> > ```",
    "- > text\nlazy\n      > ```\n" + withSourcePrefix(fake, "  > ") + "\n  > ```",
    "> - text\nlazy\n    >     ```\n" + withSourcePrefix(fake, ">   ") + "\n>   ```",
  ])("retains quote and list ownership across lazy paragraph continuations: %s", (block) => {
    for (const ending of endings) expectProtected(block, ending);
  });

  it.each(["> text", "- > text", "- item\n  > text", "- item\n> text"].flatMap((head) =>
    ["    > ", "    >   "].flatMap((prefix) => ["<pre>", "```"].flatMap((opening) =>
      endings.map((ending) => ({ head, prefix, opening, ending }))))))(
    "ends a quote before a non-one ordered list opens a protected block ($head/$prefix/$opening/$ending)",
    ({ head, prefix, opening, ending }) => {
      expectProtected(head + "\n12. " + opening + "\n" + withSourcePrefix(fake, prefix)
        + "\n" + prefix + (opening === "<pre>" ? "</pre>" : "```"), ending);
    },
  );

  it.each(["", "> "])("does not let non-one ordered markers interrupt prose at the same quote depth: %j", (prefix) => {
    const block = withSourcePrefix("text\n12. <pre>\n" + fake + "\n</pre>", prefix);
    for (const ending of endings) {
      const source = (block + "\n\n" + real).replace(/\n/gu, ending);
      expect(markdown.parse(source, {}).filter((token) => token.type === "table_open")).toHaveLength(2);
      expect(parseEditableTables(source).tables.map((table) => table.source))
        .toEqual([withSourcePrefix(fake, prefix).replace(/\n/gu, ending), real.replace(/\n/gu, ending)]);
    }
  });

  it.each(["", "> previous\n\n", "-\n\n", "> previous\nlazy\n\n", "> previous\n# Heading\n"])("does not open a new deeply indented quote after %j", (head) => {
    const source = head + "    > <pre>\n" + withSourcePrefix(fake, "> ") + "\n> </pre>\n\n" + real;
    expect(markdown.parse(source, {}).some((token) => token.type === "code_block")).toBe(true);
    expect(parseEditableTables(source).tables.map((table) => table.source)).toEqual([withSourcePrefix(fake, "> "), real]);
  });

  it.each(endings)("refuses unchanged-byte stale targets newly owned by protected blocks (%j)", (ending) => {
    for (const [initialHead, protectedHead, body] of [
      ["[a]: a\\ b", "[a]: a\\\tb", "\n<span>\n" + fake + "\n</span>"],
      ["[a]:\n  a\\ b", "[a]:\n  a\\\tb", "\n<span>\n" + fake + "\n</span>"],
      ["plain :", "[link]:", "\n  /url\n<span>\n" + fake + "\n</span>"],
      ["-x", "- ", "\n    ```\n" + withSourcePrefix(fake, "  ") + "\n  ```"],
      ["x text", "> text", "\n    > ```\n" + withSourcePrefix(fake, "> ") + "\n> ```"],
      ['> [a]  /url "title', '> [a]: /url "title', '\n| TITLE | X |\n| --- | --- |\n| p | q |\n> end"\n> <span>\n'
        + withSourcePrefix(fake, "> ") + "\n> </span>"],
      ["> text\nxx. <pre>", "> text\n12. <pre>", "\n" + withSourcePrefix(fake, "    > ") + "\n    > </pre>"],
      ["> text\nxx. ```", "> text\n12. ```", "\n" + withSourcePrefix(fake, "    > ") + "\n    > ```"],
    ] as const) {
      const initial = (initialHead + body + "\n\n" + real).replace(/\n/gu, ending);
      const protectedSource = (protectedHead + body + "\n\n" + real).replace(/\n/gu, ending);
      const table = parseEditableTables(initial).tables[0]!;
      expect(table?.valid).toBe(true);
      expect(protectedSource.slice(table.range.from, table.range.to)).toBe(table.source);
      const snapshot = new TableDocumentSnapshot(protectedSource);
      expect(reparseUnchangedTable(snapshot, table)).toBeNull();
      for (const operation of [editCellContent(table, 1, 0, "MUTATED"), removeTable(table), transposeTable(table)]) {
        expect(operation.changed).toBe(true);
        for (const document of [protectedSource, snapshot]) {
          expect(validateTableOperationInDocument(document, table, operation)).toMatchObject({ changed: false, source: table.source });
        }
      }
    }
  });
});
