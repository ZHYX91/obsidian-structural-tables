/** Source lines exclude their terminators; offsets always address the original text. */
export function sourceLines(source: string): { lines: string[]; offsets: number[] } {
  const lines: string[] = [];
  const offsets: number[] = [];
  let from = 0;
  for (const match of source.matchAll(/\r\n|\r|\n/gu)) {
    offsets.push(from);
    lines.push(source.slice(from, match.index));
    from = match.index + match[0].length;
  }
  offsets.push(from);
  lines.push(source.slice(from));
  return { lines, offsets };
}

export function sourcePrefix(line: string): string {
  return /^(?:[ \t]*>[ \t]?)*[ \t]*/u.exec(line)?.[0] ?? "";
}

export function withoutSourcePrefixes(source: string): string {
  return source.split(/\r\n|\r|\n/u).map((line) => line.slice(sourcePrefix(line).length)).join("\n");
}

export function withSourcePrefix(source: string, prefix: string): string {
  return source.split(/(\r\n|\r|\n)/u).map((part, index) => index % 2 === 0 ? prefix + part : part).join("");
}

export function calloutRanges(source: string): { from: number; to: number }[] {
  const { lines, offsets } = sourceLines(source);
  const ranges: { from: number; to: number }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const opening = /^((?: {0,3}>[\t ]?)+)\[![^\]]+\]/u.exec(lines[index] ?? "");
    if (opening === null) continue;
    const depth = opening[1]!.split(">").length - 1;
    let end = index;
    while (end + 1 < lines.length && sourcePrefix(lines[end + 1] ?? "").split(">").length - 1 >= depth) end += 1;
    ranges.push({ from: offsets[index]!, to: offsets[end]! + lines[end]!.length });
    index = end;
  }
  return ranges;
}
