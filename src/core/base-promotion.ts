import type { StructuralTable } from "./model";
import { projectStructuralTable } from "./interchange";

export const TABLE_MEMBERSHIP_PROPERTY = "structural-tables";
export const LEGACY_TABLE_MEMBERSHIP_PROPERTY = "structural_table_ids";
export const LEGACY_RECORD_ID_PROPERTY = "structural_record_id";

export type TableMembershipProperty =
  | typeof TABLE_MEMBERSHIP_PROPERTY
  | typeof LEGACY_TABLE_MEMBERSHIP_PROPERTY;

export type TableMembershipStatus = "missing" | "valid" | "invalid" | "conflict";

export interface TableMembershipState {
  status: TableMembershipStatus;
  ids: string[];
}

export interface PromotionColumn {
  sourceColumn: number;
  key: string;
  displayName: string;
}

export interface PromotionRecord {
  fileStem: string;
  values: Record<string, string>;
}

export type BasePromotionWarning =
  | "flatten-multi-row-headers"
  | "flatten-merged-column-headers"
  | "row-headers-become-properties"
  | "repeat-row-headers";

export interface BasePromotionBlocker {
  code: "merged-data-cell";
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}

export interface BasePromotionPlan {
  tableId: string;
  columns: PromotionColumn[];
  records: PromotionRecord[];
  warnings: BasePromotionWarning[];
  blockers: BasePromotionBlocker[];
}

export interface PromotionBlockMetadata {
  tableId: string;
  manifestPath: string;
  membershipProperty: TableMembershipProperty | null;
  propertyKeys: string[];
  range: { from: number; to: number };
  source: string;
}

interface SourceLine {
  from: number;
  contentTo: number;
  to: number;
  text: string;
}

interface FenceOpening {
  character: "`" | "~";
  length: number;
  info: string;
}

function propertyIdentity(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function propertyKey(label: string, column: number, generatedName: boolean): string {
  return generatedName ? `column_${column + 1}` : label.trim();
}

function headerColumnIsBlank(table: StructuralTable, column: number): boolean {
  for (let row = 0; row < table.headerRowCount; row += 1) {
    const cell = table.rows[row]?.cells[column];
    if (cell === undefined) continue;
    const anchor = table.rows[cell.anchorRow]?.cells[cell.anchorColumn];
    if (anchor?.content.trim() !== "") return false;
  }
  return true;
}

function uniqueColumns(table: StructuralTable, names: readonly string[]): PromotionColumn[] {
  const used = new Set([
    TABLE_MEMBERSHIP_PROPERTY,
    LEGACY_TABLE_MEMBERSHIP_PROPERTY,
    LEGACY_RECORD_ID_PROPERTY,
  ].map(propertyIdentity));
  return names.map((displayName, sourceColumn) => {
    const base = propertyKey(displayName, sourceColumn, headerColumnIsBlank(table, sourceColumn));
    let key = base;
    let suffix = 2;
    while (used.has(propertyIdentity(key))) {
      key = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(propertyIdentity(key));
    return { sourceColumn, key, displayName };
  });
}

function fileStem(value: string, row: number): string {
  const unwrapped = value.trim().replace(/^\[\[|\]\]$/gu, "").replace(/\|.*$/u, "");
  const sanitized = [...unwrapped]
    .map((character) => (character.codePointAt(0) ?? 0) < 32 ? " " : character)
    .join("")
    .replace(/[<>:"/\\|?*]/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/[ .]+$/gu, "")
    .trim()
    .slice(0, 80);
  const fallback = sanitized || `Record ${row + 1}`;
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(fallback) ? `_${fallback}` : fallback;
}

function mergedDataCellBlockers(table: StructuralTable): BasePromotionBlocker[] {
  return table.rows.flatMap((row) => row.cells.flatMap((cell) => {
    if (cell.covered || cell.role !== "data" || (cell.rowSpan === 1 && cell.columnSpan === 1)) return [];
    return [{
      code: "merged-data-cell" as const,
      row: cell.row + 1,
      column: cell.column + 1,
      rowSpan: cell.rowSpan,
      columnSpan: cell.columnSpan,
    }];
  }));
}

function promotionWarnings(table: StructuralTable): BasePromotionWarning[] {
  const warnings: BasePromotionWarning[] = [];
  if (table.headerRowCount > 1) warnings.push("flatten-multi-row-headers");
  if (table.rows.slice(0, table.headerRowCount).some((row) => row.cells.some((cell) => (
    !cell.covered && cell.role === "column_header" && (cell.rowSpan > 1 || cell.columnSpan > 1)
  )))) warnings.push("flatten-merged-column-headers");
  if (table.rowHeaderColumnCount > 0) warnings.push("row-headers-become-properties");
  if (table.rows.some((row) => row.cells.some((cell) => cell.role === "row_header" && cell.covered))) {
    warnings.push("repeat-row-headers");
  }
  return warnings;
}

export function buildBasePromotionPlan(
  table: StructuralTable,
  tableId: string,
): BasePromotionPlan {
  if (!table.valid) throw new Error("The table must be valid before promotion.");
  const projection = projectStructuralTable(table);
  if (projection.rows.length === 0) throw new Error("The table must contain at least one data row.");
  const columns = uniqueColumns(table, projection.columnNames);
  const records = projection.rows.map((row, rowIndex) => {
    const values = Object.fromEntries(columns.map((column) => [column.key, row[column.sourceColumn] ?? ""]));
    return {
      fileStem: fileStem(row[0] ?? "", rowIndex),
      values,
    };
  });
  return {
    tableId,
    columns,
    records,
    warnings: promotionWarnings(table),
    blockers: mergedDataCellBlockers(table),
  };
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function membershipList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || candidate.trim() === "") return null;
    const id = candidate.trim();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function sameMemberships(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

export function tableMembershipState(frontmatter: Record<string, unknown> | undefined): TableMembershipState {
  if (frontmatter === undefined) return { status: "missing", ids: [] };
  const hasCurrent = Object.prototype.hasOwnProperty.call(frontmatter, TABLE_MEMBERSHIP_PROPERTY);
  const hasLegacy = Object.prototype.hasOwnProperty.call(frontmatter, LEGACY_TABLE_MEMBERSHIP_PROPERTY);
  if (!hasCurrent && !hasLegacy) return { status: "missing", ids: [] };

  const current = hasCurrent ? membershipList(frontmatter[TABLE_MEMBERSHIP_PROPERTY]) : null;
  const legacy = hasLegacy ? membershipList(frontmatter[LEGACY_TABLE_MEMBERSHIP_PROPERTY]) : null;
  if ((hasCurrent && current === null) || (hasLegacy && legacy === null)) {
    return { status: "invalid", ids: [] };
  }
  if (current !== null && legacy !== null && !sameMemberships(current, legacy)) {
    return { status: "conflict", ids: [] };
  }
  return { status: "valid", ids: current ?? legacy ?? [] };
}

export function migrateMembershipFilter(source: string): string {
  const current = `list(note[${yamlString(TABLE_MEMBERSHIP_PROPERTY)}])`;
  return source
    .split(`list(note.${LEGACY_TABLE_MEMBERSHIP_PROPERTY})`).join(current)
    .split(`list(note[${yamlString(LEGACY_TABLE_MEMBERSHIP_PROPERTY)}])`).join(current);
}

export function migrateLegacyPromotionBlocks(source: string): { source: string; count: number } {
  const legacy = promotionBlocks(source)
    .filter(({ membershipProperty }) => membershipProperty === LEGACY_TABLE_MEMBERSHIP_PROPERTY)
    .sort((left, right) => right.range.from - left.range.from);
  let migrated = source;
  for (const block of legacy) {
    migrated = `${migrated.slice(0, block.range.from)}${migrateMembershipFilter(block.source)}${migrated.slice(block.range.to)}`;
  }
  return { source: migrated, count: legacy.length };
}

export function embeddedBaseSource(plan: BasePromotionPlan, manifestPath: string): string {
  const lines = [
    "```base",
    `# structural-tables-promotion: ${plan.tableId}`,
    `# structural-tables-manifest: ${yamlString(manifestPath)}`,
    "filters:",
    "  and:",
    `    - 'list(note[${yamlString(TABLE_MEMBERSHIP_PROPERTY)}]).contains(${yamlString(plan.tableId)})'`,
    "properties:",
  ];
  for (const column of plan.columns) {
    lines.push(`  ${yamlString(column.key)}:`);
    lines.push(`    displayName: ${yamlString(column.displayName)}`);
  }
  lines.push("views:", "  - type: table", "    name: Table", "    order:");
  for (const column of plan.columns) {
    lines.push(`      - ${yamlString(`note[${yamlString(column.key)}]`)}`);
  }
  lines.push("```");
  return lines.join("\n");
}

function propertyKeysFromBlock(block: string): string[] {
  const keys: string[] = [];
  for (const line of block.split(/\r?\n|\r/gu)) {
    const item = /^\s+-\s+(.+?)\s*$/u.exec(line)?.[1];
    if (item === undefined) continue;
    let expression = item;
    if (expression.startsWith('"')) {
      try {
        const parsed = JSON.parse(expression) as unknown;
        if (typeof parsed !== "string") continue;
        expression = parsed;
      } catch {
        continue;
      }
    }
    if (expression.startsWith("note.") && !expression.slice(5).includes(" ")) {
      keys.push(expression.slice(5));
      continue;
    }
    if (!expression.startsWith("note[") || !expression.endsWith("]")) continue;
    try {
      const parsed = JSON.parse(expression.slice(5, -1)) as unknown;
      if (typeof parsed === "string") keys.push(parsed);
    } catch {
      continue;
    }
  }
  return keys;
}

function sourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const pattern = /[^\r\n]*(?:(?:\r\n)|\r|\n|$)/gu;
  for (const match of source.matchAll(pattern)) {
    const raw = match[0];
    if (raw === "" || match.index === undefined) continue;
    const endingLength = raw.endsWith("\r\n") ? 2 : /[\r\n]$/u.test(raw) ? 1 : 0;
    const contentTo = match.index + raw.length - endingLength;
    lines.push({
      from: match.index,
      contentTo,
      to: match.index + raw.length,
      text: raw.slice(0, raw.length - endingLength),
    });
  }
  return lines;
}

function fenceOpening(line: string): FenceOpening | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  const fence = match?.[1];
  if (fence === undefined) return null;
  const character = fence[0];
  if (character !== "`" && character !== "~") return null;
  const info = (match?.[2] ?? "").trim();
  if (character === "`" && info.includes("`")) return null;
  return { character, length: fence.length, info };
}

function closesFence(line: string, opening: FenceOpening): boolean {
  const match = /^ {0,3}(`+|~+)[\t ]*$/u.exec(line);
  const fence = match?.[1];
  return fence !== undefined
    && fence[0] === opening.character
    && fence.length >= opening.length;
}

export function promotionBlocks(source: string): PromotionBlockMetadata[] {
  const blocks: PromotionBlockMetadata[] = [];
  const lines = sourceLines(source);
  for (let index = 0; index < lines.length; index += 1) {
    const openingLine = lines[index];
    if (openingLine === undefined) continue;
    const opening = fenceOpening(openingLine.text);
    if (opening === null) continue;
    let closingIndex = index + 1;
    while (closingIndex < lines.length && !closesFence(lines[closingIndex]?.text ?? "", opening)) {
      closingIndex += 1;
    }
    if (closingIndex >= lines.length) break;
    const closingLine = lines[closingIndex];
    if (closingLine === undefined) break;
    index = closingIndex;
    if (opening.info !== "base") continue;
    const from = openingLine.from;
    const to = closingLine.contentTo;
    const block = source.slice(from, to);
    const tableId = /^# structural-tables-promotion: ([^\s]+)$/mu.exec(block)?.[1];
    const manifestLiteral = /^# structural-tables-manifest: (.+)$/mu.exec(block)?.[1];
    if (tableId === undefined || manifestLiteral === undefined) continue;
    let manifestPath: string;
    try {
      const parsed = JSON.parse(manifestLiteral) as unknown;
      if (typeof parsed !== "string") continue;
      manifestPath = parsed;
    } catch {
      continue;
    }
    const propertyKeys = propertyKeysFromBlock(block);
    const membershipProperty = block.includes(`note[${yamlString(TABLE_MEMBERSHIP_PROPERTY)}]`)
      ? TABLE_MEMBERSHIP_PROPERTY
      : block.includes(`note.${LEGACY_TABLE_MEMBERSHIP_PROPERTY}`)
          || block.includes(`note[${yamlString(LEGACY_TABLE_MEMBERSHIP_PROPERTY)}]`)
        ? LEGACY_TABLE_MEMBERSHIP_PROPERTY
        : null;
    blocks.push({ tableId, manifestPath, membershipProperty, propertyKeys, range: { from, to }, source: block });
  }
  return blocks;
}

export function promotionBlockAt(source: string, offset: number): PromotionBlockMetadata | null {
  return promotionBlocks(source).find(({ range }) => offset >= range.from && offset <= range.to) ?? null;
}
