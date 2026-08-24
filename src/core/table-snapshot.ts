import type { StructuralTable } from "./model";
import { parseStructuralTables } from "./parser";

export function reparseUnchangedTable(source: string, expected: StructuralTable): StructuralTable | null {
  if (source.slice(expected.range.from, expected.range.to) !== expected.source) return null;
  return parseStructuralTables(source).tables.find((candidate) => (
    candidate.range.from === expected.range.from
    && candidate.range.to === expected.range.to
    && candidate.source === expected.source
  )) ?? null;
}
