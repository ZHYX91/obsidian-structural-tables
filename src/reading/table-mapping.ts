import type { StructuralTable } from "../core/model";

export function renderedTableFor<T>(candidates: readonly T[], table: StructuralTable): T | undefined {
  return candidates[table.sourceTableIndex];
}
