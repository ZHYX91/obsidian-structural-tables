import { decodeLiteralTableEntity } from "./literal-cell-text";

// Only punctuation and whitespace that can affect a reference URL's scheme
// need named-entity decoding here; numeric entities use the shared decoder.
const SCHEME_ENTITIES: Readonly<Record<string, string>> = {
  colon: ":", sol: "/", semi: ";", Tab: "\t", NewLine: "\n", NonBreakingSpace: "\u00a0",
  ensp: "\u2002", emsp: "\u2003", emsp13: "\u2004", emsp14: "\u2005", numsp: "\u2007", puncsp: "\u2008",
  thinsp: "\u2009", ThinSpace: "\u2009", hairsp: "\u200a", VeryThinSpace: "\u200a",
  MediumSpace: "\u205f", ThickSpace: "\u205f\u200a",
};

function acceptedDestination(source: string): boolean {
  const normalized = source.replace(/\\(.)|&(?:#[xX]?[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/gu, (value: string) => {
    if (value[0] === "\\") {
      const code = value.charCodeAt(1);
      return (code >= 33 && code <= 47) || (code >= 58 && code <= 64)
        || (code >= 91 && code <= 96) || (code >= 123 && code <= 126) ? value.slice(1) : value;
    }
    const name = value.slice(1, -1);
    return Object.prototype.hasOwnProperty.call(SCHEME_ENTITIES, name) ? SCHEME_ENTITIES[name]!
      : decodeLiteralTableEntity(value) ?? value;
  }).trim().toLowerCase();
  // Rejected destinations remain ordinary Markdown prose; claiming their
  // following standalone HTML would otherwise hide a genuine GFM table.
  return !/^(?:javascript|vbscript|file|data):/u.test(normalized)
    || /^data:image\/(?:gif|png|jpeg|webp);/u.test(normalized);
}

/**
 * Return the last owned line of a complete reference definition. The caller
 * supplies only continuations that remain in the current Markdown block.
 * Scan once without accumulating an unbounded, potentially incomplete title.
 */
export function referenceDefinitionEnd(first: string, continuation: (offset: number) => string | null): number | null {
  const opening = /^ {0,3}\[/u.exec(first);
  if (opening === null) return null;
  let line = first;
  let row = 0;
  let column = opening[0].length;
  const next = (): boolean => {
    const value = continuation(row + 1);
    if (value === null) return false;
    row += 1;
    line = value.replace(/^[\t ]*/u, "");
    column = 0;
    return true;
  };
  let label = "";
  for (;;) {
    if (label.length > 1998) return null;
    if (column >= line.length) {
      if (!next()) return null;
      label += "\n";
      continue;
    }
    const character = line[column++]!;
    if (character === "[") return null;
    if (character === "]") break;
    label += character;
    if (character === "\\" && column < line.length) label += line[column++];
  }
  if (line[column++] !== ":" || label.trim() === "" || Array.from(label).length > 999) return null;
  for (;;) {
    while (/[\t ]/u.test(line[column] ?? "")) column += 1;
    if (column < line.length) break;
    if (!next()) return null;
  }

  const destinationStart = column;
  const angleDestination = line[column] === "<";
  if (angleDestination) {
    column += 1;
    while (column < line.length && line[column] !== ">") {
      if (line[column] === "<") return null;
      column += line[column] === "\\" && column + 1 < line.length ? 2 : 1;
    }
    if (line[column++] !== ">") return null;
  } else {
    const start = column;
    let parentheses = 0;
    while (column < line.length) {
      const character = line[column]!;
      if (character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127) break;
      if (character === "\\" && column + 1 < line.length) {
        column += line[column + 1] === " " ? 1 : 2;
        continue;
      }
      if (character === "(" && ++parentheses > 32) return null;
      if (character === ")") {
        if (parentheses === 0) break;
        parentheses -= 1;
      }
      column += 1;
    }
    if (column === start || parentheses !== 0) return null;
  }
  if (!acceptedDestination(line.slice(destinationStart + (angleDestination ? 1 : 0), column - (angleDestination ? 1 : 0)))) return null;

  const destinationRow = row;
  const destinationEnd = column;
  while (/[\t ]/u.test(line[column] ?? "")) column += 1;
  const destinationOnly = column === line.length;
  if (destinationOnly && !next()) return destinationRow;
  if (!destinationOnly && column === destinationEnd) return null;
  const opener = line[column++];
  if (opener !== '"' && opener !== "'" && opener !== "(") return destinationOnly ? destinationRow : null;
  const closer = opener === "(" ? ")" : opener;
  for (;;) {
    if (column >= line.length) {
      if (!next()) return destinationOnly ? destinationRow : null;
      continue;
    }
    const character = line[column++]!;
    if (character === "\\") { column += 1; continue; }
    if (character === "(" && closer === ")") return destinationOnly ? destinationRow : null;
    if (character !== closer) continue;
    return /^[\t ]*$/u.test(line.slice(column)) ? row : destinationOnly ? destinationRow : null;
  }
}
