export interface ParsedTablePipeRow {
  cells: string[];
}

function backtickRunLength(source: string, start: number): number {
  let length = 0;
  while (source[start + length] === "`") length += 1;
  return length;
}

function matchingBacktickRun(source: string, start: number, length: number): number {
  for (let index = start; index < source.length;) {
    if (source[index] !== "`") {
      index += 1;
      continue;
    }
    const run = backtickRunLength(source, index);
    if (run === length) return index;
    index += run;
  }
  return -1;
}

/** Split a Markdown pipe row while treating only closed code spans as opaque. */
export function splitTablePipeRow(line: string): ParsedTablePipeRow | null {
  if (!line.includes("|")) return null;
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === "`") {
      const run = backtickRunLength(line, index);
      const close = matchingBacktickRun(line, index + run, run);
      if (close >= 0) {
        current += line.slice(index, close + run);
        index = close + run - 1;
        continue;
      }
      current += "`".repeat(run);
      index += run - 1;
      continue;
    }
    if (character === "|") {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current);
  if (cells.length < 2) return null;
  if ((cells[0] ?? "").trim() === "") cells.shift();
  if ((cells[cells.length - 1] ?? "").trim() === "") cells.pop();
  return cells.length === 0 ? null : { cells };
}

/** Escape table separators outside closed code spans. */
export function normalizeTableCellText(input: string): string {
  const withBreaks = input.replace(/\r\n|\r|\n/gu, "<br>");
  const source = withBreaks.trim();
  let output = "";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (escaped) {
      output += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      output += character;
      escaped = true;
      continue;
    }
    if (character === "`") {
      const run = backtickRunLength(source, index);
      const close = matchingBacktickRun(source, index + run, run);
      if (close >= 0) {
        output += source.slice(index, close + run);
        index = close + run - 1;
        continue;
      }
      output += "`".repeat(run);
      index += run - 1;
      continue;
    }
    output += character === "|" ? "\\|" : character;
  }
  return (output === "<" || output === "^") ? `\\${output}` : output;
}
