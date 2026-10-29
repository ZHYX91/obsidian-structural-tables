import { closedCodeSpanEnd } from "./table-cell-syntax";

function closingToken(source: string, token: string, from: number): number {
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === "\\") { index += 1; continue; }
    if (source.startsWith(token, index)) return index;
  }
  return -1;
}

function closingBracket(source: string, from: number, html: boolean): number {
  let depth = 1;
  let quote = "";
  for (let index = from; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === "\\") { index += 1; continue; }
    if (quote !== "") { if (character === quote) quote = ""; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (html && character === ">") return index;
    if (!html && character === "(") depth += 1;
    if (!html && character === ")" && --depth === 0) return index;
  }
  return -1;
}

function closingLabel(source: string, from: number): number {
  let depth = 1;
  for (let index = from; index < source.length; index += 1) {
    if (source[index] === "\\") { index += 1; continue; }
    if (source[index] === "`") {
      const end = closedCodeSpanEnd(source, index);
      if (end === null) return -1;
      index = end - 1;
      continue;
    }
    if (source[index] === "[") depth += 1;
    if (source[index] === "]" && --depth === 0) return index;
  }
  return -1;
}

/** Encode text once, before Markdown sees it. Newlines alone become owned breaks. */
export function literalTableCellText(text: string): string | null {
  if ([...text].some((character) => {
    const code = character.codePointAt(0)!;
    return code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
  })) return null;
  let result = "";
  const source = text.replace(/\r\n|\r/gu, "\n");
  const leading = /^ */u.exec(source)![0].length;
  const trailing = source.length - / *$/u.exec(source)![0].length;
  let index = 0;
  for (const character of source) {
    const code = character.codePointAt(0)!;
    if (character === "\n") result += "<br>";
    else if ((/\s/u.test(character) && (character !== " " || index < leading || index >= trailing)) || (code >= 33 && code <= 47)
      || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)) result += `&#${code};`;
    else result += character;
    index += character.length;
  }
  return result;
}

/** Entity text is not literal inside code, math, HTML or link source. Refuse uncertainty. */
export function pasteLiteralCellText(raw: string, from: number, to: number, text: string): string | null {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > raw.length) return null;
  if (from === 0 && to === raw.length) return literalTableCellText(text);
  const entities = /&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/giu;
  for (const match of raw.matchAll(entities)) {
    const start = match.index; const end = start + match[0].length;
    if ((from > start && from < end) || (to > start && to < end)) return null;
  }
  const inside = (start: number, end: number): boolean =>
    (from > start && from < end) || (to > start && to < end)
      || (from === to && from === start && start > 0 && raw[start - 1] === "\\");
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "\\") { index += 1; continue; }
    let end: number | null = null;
    if (raw[index] === "`") {
      end = closedCodeSpanEnd(raw, index);
      if (end === null) return null;
    }
    else if (raw.startsWith("%%", index)) {
      const close = closingToken(raw, "%%", index + 2);
      end = close < 0 ? raw.length + 1 : close + 2;
    }
    else if (raw.startsWith("[[", index)) {
      const close = closingToken(raw, "]]", index + 2);
      end = close < 0 ? raw.length + 1 : close + 2;
    } else if (raw[index] === "[") {
      const label = closingLabel(raw, index + 1);
      if (label < 0) return null;
      if (label >= 0 && raw[label + 1] === "(") {
        const close = closingBracket(raw, label + 2, false);
        end = close < 0 ? raw.length + 1 : close + 1;
      } else end = label + 1;
    } else if (raw[index] === "$") {
      const delimiter = raw[index + 1] === "$" ? "$$" : "$";
      const close = closingToken(raw, delimiter, index + delimiter.length);
      if (close >= 0) end = close + delimiter.length;
    } else if (raw[index] === "<" && /[a-z/!?]/iu.test(raw[index + 1] ?? "")) {
      const comment = raw.startsWith("<!--", index);
      const token = comment ? "-->" : raw.startsWith("<![CDATA[", index) ? "]]>" : raw.startsWith("<?", index) ? "?>" : null;
      const close = token === null ? closingBracket(raw, index + 1, true) : raw.indexOf(token, index + 2);
      end = close < 0 ? raw.length + 1 : close + (token?.length ?? 1);
    }
    if (end !== null) {
      if (inside(index, end)) return null;
      index = end - 1;
    }
  }
  // An insertion after an escape would reinterpret the new entity's ampersand.
  let slashes = 0;
  for (let index = from - 1; index >= 0 && raw[index] === "\\"; index -= 1) slashes += 1;
  if (slashes % 2 === 1) return null;
  const encoded = literalTableCellText(text);
  return encoded === null ? null : raw.slice(0, from) + encoded + raw.slice(to);
}
