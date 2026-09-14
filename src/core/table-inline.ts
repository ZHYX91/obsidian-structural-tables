function backtickRunLength(source: string, start: number): number {
  let length = 1;
  while (source[start + length] === "`") length += 1;
  return length;
}

function codeSpanEnd(source: string, start: number, openingLength: number): number | null {
  let index = start + openingLength;
  while (index < source.length) {
    const next = source.indexOf("`", index);
    if (next < 0) return null;
    const length = backtickRunLength(source, next);
    if (length === openingLength) return next + length;
    index = next + length;
  }
  return null;
}

/** Splits a Markdown pipe row without treating escaped pipes or pipes in closed code spans as separators. */
export function splitTablePipeRow(line: string): string[] | null {
  if (!line.includes("|")) return null;
  const segments: string[] = [];
  let current = "";
  let index = 0;
  while (index < line.length) {
    const character = line[index] ?? "";
    if (character === "\\") {
      current += character;
      if (index + 1 < line.length) {
        current += line[index + 1] ?? "";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (character === "`") {
      const length = backtickRunLength(line, index);
      const end = codeSpanEnd(line, index, length);
      if (end !== null) {
        current += line.slice(index, end);
        index = end;
        continue;
      }
      current += "`".repeat(length);
      index += length;
      continue;
    }
    if (character === "|") {
      segments.push(current);
      current = "";
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  segments.push(current);
  if (segments.length < 2) return null;
  if ((segments[0] ?? "").trim() === "") segments.shift();
  if ((segments[segments.length - 1] ?? "").trim() === "") segments.pop();
  return segments.length === 0 ? null : segments;
}

/** Escapes structural pipes in a cell fragment while preserving valid escapes and closed code spans. */
export function escapeTableCellPipes(input: string): string {
  let output = "";
  let index = 0;
  while (index < input.length) {
    const character = input[index] ?? "";
    if (character === "\\") {
      let length = 1;
      while (input[index + length] === "\\") length += 1;
      output += "\\".repeat(length);
      const next = input[index + length];
      if (length % 2 === 1 && (next === "|" || next === "`")) {
        output += next;
        index += length + 1;
      } else {
        index += length;
      }
      continue;
    }
    if (character === "`") {
      const length = backtickRunLength(input, index);
      const end = codeSpanEnd(input, index, length);
      if (end !== null) {
        output += input.slice(index, end);
        index = end;
        continue;
      }
      output += "`".repeat(length);
      index += length;
      continue;
    }
    output += character === "|" ? "\\|" : character;
    index += 1;
  }
  return output;
}
