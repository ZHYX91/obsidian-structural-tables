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

function tablePipeSeparators(line: string): number[] {
  const separators: number[] = [];
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === "`") {
      const run = backtickRunLength(line, index);
      const close = matchingBacktickRun(line, index + run, run);
      if (close >= 0) {
        index = close + run - 1;
        continue;
      }
      index += run - 1;
      continue;
    }
    if (character === "|") separators.push(index);
  }
  return separators;
}

/** Split a Markdown pipe row while treating only closed code spans as opaque. */
export function splitTablePipeRow(line: string): ParsedTablePipeRow | null {
  const separators = tablePipeSeparators(line);
  if (separators.length === 0) return null;
  const cells: string[] = [];
  let from = 0;
  for (const separator of separators) {
    cells.push(line.slice(from, separator));
    from = separator + 1;
  }
  cells.push(line.slice(from));
  if (cells.length < 2) return null;
  if ((cells[0] ?? "").trim() === "") cells.shift();
  if ((cells[cells.length - 1] ?? "").trim() === "") cells.pop();
  return cells.length === 0 ? null : { cells };
}

/** Map a source offset to the same pipe cell boundaries used by the row parser. */
export function tableColumnAt(line: string, character: number): number {
  const leadingPipe = line.trimStart().startsWith("|");
  const separatorsBefore = tablePipeSeparators(line).filter((offset) => offset < character).length;
  return Math.max(0, separatorsBefore - (leadingPipe ? 1 : 0));
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
