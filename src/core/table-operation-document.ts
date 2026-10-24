import type { StructuralTable } from "./model";
import type { OperationResult } from "./operations";
import { parseEditableTables } from "./parser";
import { reparseUnchangedTable, TableDocumentSnapshot } from "./table-snapshot";

/** A replacement that parses alone may absorb adjacent pipe prose in the complete note. */
export function validateTableOperationInDocument(document: string | TableDocumentSnapshot, expected: StructuralTable, result: OperationResult): OperationResult {
  if (!result.changed) return result;
  const snapshot = typeof document === "string" ? new TableDocumentSnapshot(document) : document;
  const source = snapshot.source;
  const refuse: OperationResult = { changed: false, code: "invalid-result",
    message: "The operation would change a neighboring table or its boundary. Add a blank line around the table and retry.",
    source: expected.source };
  if (reparseUnchangedTable(snapshot, expected) === null) return refuse;
  const before = snapshot.tables;
  const index = before.findIndex((table) => table.range.from === expected.range.from
    && table.range.to === expected.range.to && table.source === expected.source);
  if (index < 0) return refuse;
  const updated = source.slice(0, expected.range.from) + result.source + source.slice(expected.range.to);
  const after = parseEditableTables(updated).tables;
  const deleted = result.code === "table-deleted";
  if (after.length !== before.length - (deleted ? 1 : 0)) return refuse;
  if (!deleted) {
    const target = after[index];
    if (target === undefined || !target.valid || target.range.from !== expected.range.from
      || target.range.to !== expected.range.from + result.source.length
      || target.source !== result.source || target.startLine !== expected.startLine
      || target.sourcePrefix !== expected.sourcePrefix) return refuse;
  }
  const otherBefore = before.filter((_table, i) => i !== index);
  const otherAfter = deleted ? after : after.filter((_table, i) => i !== index);
  const delta = result.source.length - expected.source.length;
  for (const [i, original] of otherBefore.entries()) {
    const candidate = otherAfter[i];
    const shift = original.range.from >= expected.range.to ? delta : 0;
    if (candidate === undefined || candidate.range.from !== original.range.from + shift
      || candidate.range.to !== original.range.to + shift || candidate.source !== original.source
      || candidate.valid !== original.valid) return refuse;
  }
  return result;
}
