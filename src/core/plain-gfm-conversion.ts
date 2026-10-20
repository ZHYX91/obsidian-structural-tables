import { structuralTableToPlainGfm } from "./interchange";
import type { StructuralTable } from "./model";
import { planTransposeTable, type OperationResult } from "./operations";
import { parseEditableTables } from "./parser";
import { withSourcePrefix } from "./source-lines";
import { validateTableOperationInDocument } from "./table-operation-document";
import { hasHiddenGfmOverflow } from "./table-write-safety";

export type PlainGfmOrientation = "keep" | "transpose";
export type PlainGfmWarning = "merged-cells" | "multiple-headers" | "row-headers" | "empty-header" | "alignment" | "hidden-cells";

export interface PlainGfmPlan {
  orientation: PlainGfmOrientation;
  /** Portable Markdown without the original note's quote/list indentation. */
  source: string;
  warnings: PlainGfmWarning[];
  canReplace: boolean;
}

export interface PlainGfmConversion {
  recommended: PlainGfmOrientation;
  keep: PlainGfmPlan;
  transpose: PlainGfmPlan | null;
}

function projectionPlan(original: StructuralTable, projected: StructuralTable,
  orientation: PlainGfmOrientation, resetsAlignment = false): PlainGfmPlan {
  const warnings: PlainGfmWarning[] = [];
  if (projected.rows.some((row) => row.cells.some((cell) => cell.rowSpan > 1 || cell.columnSpan > 1))) warnings.push("merged-cells");
  if (projected.headerRowCount > 1) warnings.push("multiple-headers");
  if (projected.rowHeaderColumnCount > 0) warnings.push("row-headers");
  if (projected.headerRowCount === 0) warnings.push("empty-header");
  if (resetsAlignment) warnings.push("alignment");
  const canReplace = !hasHiddenGfmOverflow(original);
  if (!canReplace) warnings.push("hidden-cells");
  return { orientation, source: structuralTableToPlainGfm(projected, "aligned"), warnings, canReplace };
}

/** Reuse the table's transpose and portable projection; no intermediate source write. */
export function planPlainGfmConversion(table: StructuralTable): PlainGfmConversion | null {
  if (!table.valid) return null;
  const keep = projectionPlan(table, table, "keep");
  // The preview is portable Markdown. Serialize the logical transpose without
  // a quote/list prefix, which can look like indented code without its note.
  // Retain the original source so the existing core preserves its line endings.
  const transposePlan = planTransposeTable({ ...table, sourcePrefix: "" });
  const transposed = transposePlan.result.changed
    ? parseEditableTables(transposePlan.result.source).tables[0] : undefined;
  const transpose = transposed?.valid === true
    ? projectionPlan(table, transposed, "transpose", transposePlan.resetsColumnAlignment) : null;
  return {
    // GFM has one top header row. With only row headers, rotating first retains
    // those labels as headers instead of replacing their role with empty titles.
    recommended: table.headerRowCount === 0 && table.rowHeaderColumnCount > 0 && transpose !== null ? "transpose" : "keep",
    keep,
    transpose,
  };
}

/** The exact preview candidate must also be a safe replacement in the complete note. */
export function plainGfmConversionInDocument(source: string, table: StructuralTable,
  orientation: PlainGfmOrientation): OperationResult {
  const conversion = planPlainGfmConversion(table);
  const plan = conversion?.[orientation];
  if (plan == null || !plan.canReplace) return {
    changed: false, source: table.source,
    code: hasHiddenGfmOverflow(table) ? "gfm-overflow-readonly" : "invalid-result",
    message: "This table cannot be replaced by the selected GFM conversion.",
  };
  const replacement = withSourcePrefix(plan.source, table.sourcePrefix);
  return validateTableOperationInDocument(source, table, {
    changed: replacement !== table.source, source: replacement,
    code: "table-converted", message: "Table converted to plain GFM.",
  });
}
