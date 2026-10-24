import type { StructuralTable } from "./model";
import { parseEditableTables } from "./parser";

/** A single synchronous operation owns this exact source and its original parse. */
export class TableDocumentSnapshot {
  readonly tables: readonly StructuralTable[];

  constructor(readonly source: string) {
    this.tables = Object.freeze(parseEditableTables(source).tables);
    Object.freeze(this);
  }
}

export function reparseUnchangedTable(source: string | TableDocumentSnapshot, expected: StructuralTable): StructuralTable | null {
  if (typeof source === "string" && source.slice(expected.range.from, expected.range.to) !== expected.source) return null;
  const snapshot = typeof source === "string" ? new TableDocumentSnapshot(source) : source;
  if (snapshot.source.slice(expected.range.from, expected.range.to) !== expected.source) return null;
  return snapshot.tables.find((candidate) => (
    candidate.range.from === expected.range.from
    && candidate.range.to === expected.range.to
    && candidate.source === expected.source
  )) ?? null;
}
