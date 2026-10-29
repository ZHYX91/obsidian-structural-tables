import type { SourceRange, StructuralTable } from "./model";
import { parseEditableTables } from "./parser";
import { hasHiddenGfmOverflow } from "./table-write-safety";

function sameTable(left: StructuralTable, right: StructuralTable, shift: number): boolean {
  return right.range.from === left.range.from + shift && right.range.to === left.range.to + shift
    && right.source === left.source && right.valid === left.valid && right.sourcePrefix === left.sourcePrefix;
}

/**
 * Prove table ownership in the complete candidate, including tables in a literal
 * plain-text fallback. No inferred TSV/Markdown conversion or boundary padding.
 */
export function validateDocumentReplacement(source: string, range: SourceRange, replacement: string,
  requireWholeTable = false): boolean {
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to)
    || range.from < 0 || range.to < range.from || range.to > source.length) return false;
  const inserted = parseEditableTables(replacement).tables;
  if (requireWholeTable && (inserted.length !== 1 || !inserted[0]!.valid
    || hasHiddenGfmOverflow(inserted[0]!) || inserted[0]!.range.from !== 0
    || inserted[0]!.range.to !== replacement.length)) return false;
  const retained: StructuralTable[] = [];
  for (const table of parseEditableTables(source).tables) {
    const overlaps = table.range.from < range.to && table.range.to > range.from
      || range.from === range.to && table.range.from < range.from && table.range.to > range.from;
    if (!overlaps) retained.push(table);
    else if (table.range.from < range.from || table.range.to > range.to || !table.valid || hasHiddenGfmOverflow(table)) return false;
  }
  const candidate = source.slice(0, range.from) + replacement + source.slice(range.to);
  const after = parseEditableTables(candidate).tables;
  const expected = [
    ...retained.map((table) => ({ table, shift: table.range.from >= range.to ? replacement.length - (range.to - range.from) : 0 })),
    ...inserted.map((table) => ({ table, shift: range.from })),
  ].sort((left, right) => left.table.range.from + left.shift - (right.table.range.from + right.shift));
  return after.length === expected.length && expected.every(({ table, shift }, index) => sameTable(table, after[index]!, shift));
}
