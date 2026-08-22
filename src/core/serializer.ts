import type { ColumnAlignment, StructuralTable } from "./model";

function delimiterFor(alignment: ColumnAlignment): string {
  if (alignment === "left") return ":---";
  if (alignment === "center") return ":---:";
  if (alignment === "right") return "---:";
  return "---";
}

function escapedContent(content: string): string {
  if (content === "<" || content === "^") return `\\${content}`;
  return content;
}

export function serializeStructuralTable(table: StructuralTable): string {
  if (!table.valid) throw new Error("Cannot format an invalid structural table.");
  const delimiters = table.alignments.map(delimiterFor);
  const delimiter = table.rowHeaderColumnCount > 0
    ? `| ${delimiters.slice(0, table.rowHeaderColumnCount).join(" | ")} || ${delimiters.slice(table.rowHeaderColumnCount).join(" | ")} |`
    : `| ${delimiters.join(" | ")} |`;
  const lines: string[] = [];
  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex += 1) {
    if (rowIndex === table.headerRowCount) {
      lines.push(delimiter);
    }
    const row = table.rows[rowIndex];
    if (row === undefined) continue;
    const cells = row.cells.map((cell) => {
      if (!cell.covered) return escapedContent(cell.content);
      if (cell.row === cell.anchorRow) return "<";
      return "^";
    });
    lines.push(`| ${cells.join(" | ")} |`);
  }
  if (table.rows.length === table.headerRowCount) lines.push(delimiter);
  return lines.join("\n");
}
