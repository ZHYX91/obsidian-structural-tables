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

/** Exclusive end of a closed code span; an unmatched opener is ordinary text. */
export function closedCodeSpanEnd(source: string, start: number): number | null {
  if (source[start] !== "`") return null;
  const length = backtickRunLength(source, start);
  const close = matchingBacktickRun(source, start + length, length);
  return close < 0 ? null : close + length;
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

export type MathCellInputProblem = "math-pipe-unsafe" | "math-multiline-unsafe" | "math-syntax-unsafe";

/** Validate the complete draft before any table escaping or newline conversion. */
export function mathCellInputProblem(source: string): MathCellInputProblem | null {
  let delimiter = 0;
  let braces = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") {
      if (delimiter !== 0 && /^\\(?:verb|lstinline)(?:\b|\*)/u.test(source.slice(index))) return "math-syntax-unsafe";
      if (delimiter !== 0 && /[\r\n]/u.test(source[index + 1] ?? "")) return "math-multiline-unsafe";
      // Consume a TeX control symbol (or an ordinary Markdown escape). In
      // particular, \\| is a norm but \\\\ followed by | is an unsafe bare pipe.
      index += 1;
      continue;
    }
    if (delimiter === 0 && character === "`") {
      const end = closedCodeSpanEnd(source, index);
      if (end !== null) { index = end - 1; continue; }
      while (source[index + 1] === "`") index += 1;
      continue;
    }
    if (delimiter === 0 && source.startsWith("[[", index)) {
      const end = source.indexOf("]]", index + 2);
      if (end >= 0) { index = end + 1; continue; }
    }
    if (character === "$") {
      let run = 1;
      while (source[index + run] === "$") run += 1;
      if (run > 2 || (delimiter !== 0 && (run !== delimiter || braces !== 0))) return "math-syntax-unsafe";
      delimiter = delimiter === 0 ? run : 0;
      index += run - 1;
      continue;
    }
    if (delimiter === 0) continue;
    if (character === "\r" || character === "\n") return "math-multiline-unsafe";
    if (character === "|") return "math-pipe-unsafe";
    if (character === "%") return "math-syntax-unsafe";
    if (character === "{") braces += 1;
    if (character === "}" && --braces < 0) return "math-syntax-unsafe";
  }
  return delimiter === 0 ? null : "math-syntax-unsafe";
}

function escapedTableCellText(input: string): string {
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

/** Preserve an already accepted Markdown cell without reclassifying legacy content as a new draft. */
export function existingTableCellText(input: string): string {
  return escapedTableCellText(input);
}

/** Escape table separators only after proving a newly edited draft will keep its math source unchanged. */
export function normalizeTableCellText(input: string): string {
  const problem = mathCellInputProblem(input);
  if (problem !== null) throw new Error(problem);
  return escapedTableCellText(input);
}
