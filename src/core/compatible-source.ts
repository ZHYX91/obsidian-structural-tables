import type { ColumnAlignment } from "./model";

function delimiterFor(alignment: ColumnAlignment): string {
  if (alignment === "left") return ":---";
  if (alignment === "center") return ":---:";
  if (alignment === "right") return "---:";
  return "---";
}

/** Build GFM-valid physical rows; control cells never enter the logical grid. */
export function compatibleSourceRows(
  values: readonly (readonly string[])[],
  headerRows: number,
  rowHeaderColumns: number,
  alignments: readonly ColumnAlignment[],
): string[][] {
  const withBoundary = (row: readonly string[]): string[] => {
    const cells = [...row];
    if (rowHeaderColumns > 0) cells.splice(rowHeaderColumns, 0, "<<");
    return cells;
  };
  const physical = values.map(withBoundary);
  const delimiter = alignments.map(delimiterFor);
  if (rowHeaderColumns > 0) delimiter.splice(rowHeaderColumns, 0, "---");
  const headerBoundary = withBoundary(alignments.map(() => "^^"));
  const lines: string[][] = [];
  if (headerRows === 0) {
    lines.push(headerBoundary, delimiter, ...physical);
    return lines;
  }
  lines.push(physical[0] ?? withBoundary(alignments.map(() => "")), delimiter);
  for (let row = 1; row < physical.length; row += 1) {
    if (row === headerRows && headerRows > 1) lines.push(headerBoundary);
    lines.push(physical[row]!);
  }
  if (headerRows > 1 && headerRows === physical.length) lines.push(headerBoundary);
  return lines;
}

export function compatibleSource(
  values: readonly (readonly string[])[],
  headerRows: number,
  rowHeaderColumns: number,
  alignments: readonly ColumnAlignment[],
  ending: string,
): string {
  return compatibleSourceRows(values, headerRows, rowHeaderColumns, alignments)
    .map((cells) => "| " + cells.join(" | ") + " |").join(ending);
}
