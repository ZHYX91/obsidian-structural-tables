import { MarkdownView, TFile, type App } from "obsidian";
import { isMap, isNode, isScalar, parseDocument } from "yaml";

import { assertRecoveredPromotionOwnership } from "./base-promotion-service";

import {
  LEGACY_RECORD_ID_PROPERTY,
  LEGACY_TABLE_MEMBERSHIP_PROPERTY,
  migrateLegacyPromotionBlocks,
  promotionBlocks,
  promotionBlocksNeedingMigration,
  TABLE_MEMBERSHIP_PROPERTY,
  tableMembershipState,
  migrateMembershipFilter,
} from "../core/base-promotion";

interface PropertyMigrationFile {
  file: TFile;
  path: string;
  originalSource: string;
  migrateMembership: boolean;
  legacyBaseCount: number;
  hasLegacyRecordId: boolean;
  membershipIds: string[];
  currentMembershipPresent: boolean;
  currentMembershipValue: unknown;
  legacyMembershipValue: unknown;
  legacyRecordIdValue: unknown;
}

interface MigratedBaseBlock {
  tableId: string;
  before: string;
  after: string;
}

interface WrittenChanges {
  properties: PropertyChange[];
  bases: MigratedBaseBlock[];
}

interface PropertyField {
  key: string;
  from: number;
  insertionFrom: number;
  to: number;
  keyTo: number;
  hasKeyPrefix: boolean;
  source: string;
  nextKey: string | undefined;
}

interface PropertyChange {
  before: PropertyField;
  after: PropertyField | null;
}

function migrationFrontmatter(source: string) {
  const opening = /^\uFEFF?---[\t ]*(?:\r\n|\r|\n)/u.exec(source);
  if (opening === null) throw new Error("Migration frontmatter is missing.");
  const remaining = source.slice(opening[0].length);
  const closing = /^(?:---|\.\.\.)[\t ]*(?=\r\n|\r|\n|$)/mu.exec(remaining);
  if (closing === null) throw new Error("Migration frontmatter is not closed.");
  const from = opening[0].length;
  const to = from + closing.index;
  const text = source.slice(from, to);
  // Lone CR normalization has the same UTF-16 offsets as the original text.
  const document = parseDocument(text.replace(/\r(?!\n)/gu, "\n"), { keepSourceTokens: true });
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw new Error("Migration frontmatter is not an unambiguous mapping.");
  }
  const map = document.contents;
  const fields = map.items.flatMap((pair, index): PropertyField[] => {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") return [];
    if (pair.key.range == null || !isNode(pair.value) || pair.value.range == null) {
      throw new Error("Migration frontmatter contains an unsupported property.");
    }
    const fieldFrom = pair.key.range[0];
    const fieldTo = pair.value.range[map.flow ? 1 : 2];
    const keyPrefixes = pair.srcToken?.start.filter((token) => (
      token.type === "anchor" || token.type === "tag" || token.type === "explicit-key-ind"
    )) ?? [];
    const next = map.items[index + 1]?.key;
    return [{
      key: pair.key.value,
      from: fieldFrom,
      insertionFrom: keyPrefixes[0]?.offset ?? fieldFrom,
      to: fieldTo,
      keyTo: pair.key.range[1],
      hasKeyPrefix: pair.key.anchor !== undefined || pair.key.tag !== undefined || keyPrefixes.length > 0,
      source: text.slice(fieldFrom, fieldTo),
      nextKey: isScalar(next) && typeof next.value === "string" ? next.value : undefined,
    }];
  });
  return { from, to, text, document, map, fields };
}

function propertyField(source: string, key: string): PropertyField | null {
  return migrationFrontmatter(source).fields.find((field) => field.key === key) ?? null;
}

function replacePropertyField(source: string, field: PropertyField, replacement: string): string {
  if (field.hasKeyPrefix) throw new Error(`Migration cannot safely change a prefixed YAML property key: ${field.key}.`);
  const frontmatter = migrationFrontmatter(source);
  let from = field.from;
  let to = field.to;
  if (replacement === "" && frontmatter.map.flow) {
    const index = frontmatter.map.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === field.key);
    const precedingComma = frontmatter.map.items[index]?.srcToken?.start.find((token) => token.type === "comma");
    if (precedingComma !== undefined) from = precedingComma.offset;
    else {
      const followingComma = frontmatter.map.items[index + 1]?.srcToken?.start.find((token) => token.type === "comma");
      if (followingComma !== undefined) to = followingComma.offset + 1;
    }
  }
  return source.slice(0, frontmatter.from + from) + replacement + source.slice(frontmatter.from + to);
}

function insertPropertyField(source: string, field: PropertyField): string {
  const frontmatter = migrationFrontmatter(source);
  const next = frontmatter.fields.find((candidate) => candidate.key === field.nextKey);
  if (frontmatter.map.flow) {
    const token = frontmatter.map.srcToken?.type === "flow-collection" ? frontmatter.map.srcToken : undefined;
    const end = token?.end.find((part) => part.type === "flow-map-end")?.offset;
    if (end === undefined) throw new Error("Migration frontmatter mapping changed.");
    const tail = token?.items[token.items.length - 1];
    const trailingComma = tail?.key === undefined && tail?.value === undefined
      ? tail?.start.find((part) => part.type === "comma")?.offset
      : undefined;
    // Insert before an existing trailing comma so it stays a legal collection terminator.
    const at = next?.insertionFrom ?? trailingComma ?? end;
    const insertion = next === undefined
      ? `${frontmatter.map.items.length > 0 ? ", " : ""}${field.source}`
      : `${field.source}, `;
    return source.slice(0, frontmatter.from + at) + insertion + source.slice(frontmatter.from + at);
  }
  const at = frontmatter.from + (next?.insertionFrom ?? frontmatter.text.length);
  return source.slice(0, at) + field.source + source.slice(at);
}

function migrateProperties(source: string, candidate: PropertyMigrationFile, removeLegacyRecordIds: boolean) {
  const frontmatter = migrationFrontmatter(source).document.toJS() as Record<string, unknown>;
  const membership = tableMembershipState(frontmatter);
  if (membership.status !== "valid" || !sameStrings(membership.ids, candidate.membershipIds)) {
    throw new Error(`Structural Tables membership changed during migration: ${candidate.path}.`);
  }
  const changes: PropertyChange[] = [];
  let result = source;
  if (candidate.migrateMembership) {
    if (!owns(frontmatter, LEGACY_TABLE_MEMBERSHIP_PROPERTY)
      || !sameValue(frontmatter[LEGACY_TABLE_MEMBERSHIP_PROPERTY], candidate.legacyMembershipValue)
      || (candidate.currentMembershipPresent
        ? !owns(frontmatter, TABLE_MEMBERSHIP_PROPERTY)
          || !sameValue(frontmatter[TABLE_MEMBERSHIP_PROPERTY], candidate.currentMembershipValue)
        : owns(frontmatter, TABLE_MEMBERSHIP_PROPERTY))) {
      throw new Error(`Structural Tables membership changed during migration: ${candidate.path}.`);
    }
    const before = propertyField(result, LEGACY_TABLE_MEMBERSHIP_PROPERTY)!;
    const replacement = candidate.currentMembershipPresent ? ""
      : TABLE_MEMBERSHIP_PROPERTY + before.source.slice(before.keyTo - before.from);
    result = replacePropertyField(result, before, replacement);
    changes.push({ before, after: candidate.currentMembershipPresent ? null : propertyField(result, TABLE_MEMBERSHIP_PROPERTY) });
  }
  if (removeLegacyRecordIds && candidate.hasLegacyRecordId) {
    if (!owns(frontmatter, LEGACY_RECORD_ID_PROPERTY)
      || !sameValue(frontmatter[LEGACY_RECORD_ID_PROPERTY], candidate.legacyRecordIdValue)) {
      throw new Error(`Structural Tables record ID changed during migration: ${candidate.path}.`);
    }
    const before = propertyField(result, LEGACY_RECORD_ID_PROPERTY)!;
    result = replacePropertyField(result, before, "");
    changes.push({ before, after: null });
  }
  // Validate alias references and the resulting mapping before committing a raw patch.
  migrationFrontmatter(result).document.toJS();
  return { source: result, changes };
}

function restoreProperties(source: string, changes: readonly PropertyChange[], candidate: PropertyMigrationFile): string {
  const membership = tableMembershipState(migrationFrontmatter(source).document.toJS() as Record<string, unknown>);
  if (membership.status !== "valid" || !sameStrings(membership.ids, candidate.membershipIds)) {
    throw new Error("membership changed after migration wrote it");
  }
  let restored = source;
  for (const change of [...changes].reverse()) {
    if (propertyField(restored, change.before.key) !== null) throw new Error("property changed after migration wrote it");
    if (change.after !== null) {
      const current = propertyField(restored, change.after.key);
      if (current === null || current.source !== change.after.source) throw new Error("property changed after migration wrote it");
      restored = replacePropertyField(restored, current, change.before.source);
    } else restored = insertPropertyField(restored, change.before);
  }
  migrationFrontmatter(restored).document.toJS();
  return restored;
}

export interface PreparedBasePropertyMigration {
  files: PropertyMigrationFile[];
  membershipNoteCount: number;
  legacyBaseCount: number;
  legacyRecordIdCount: number;
}

export interface BasePropertyMigrationResult {
  fileCount: number;
  membershipNoteCount: number;
  legacyBaseCount: number;
  removedRecordIdCount: number;
}

function owns(value: Record<string, unknown>, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function restoreMigratedBaseBlocks(
  source: string,
  changes: readonly MigratedBaseBlock[],
  sourceFilePath?: string,
): string {
  const available = promotionBlocks(source, sourceFilePath);
  const replacements = changes.map((change) => {
    const index = available.findIndex((block) => block.tableId === change.tableId && block.source === change.after);
    const block = index < 0 ? undefined : available.splice(index, 1)[0];
    if (block === undefined) throw new Error(`promoted Base ${change.tableId} changed after migration`);
    return { ...block.range, source: change.before };
  }).sort((left, right) => right.from - left.from);
  let restored = source;
  for (const replacement of replacements) {
    restored = `${restored.slice(0, replacement.from)}${replacement.source}${restored.slice(replacement.to)}`;
  }
  return restored;
}

export class BasePropertyMigrationService {
  private disposed = false;

  constructor(private readonly app: App) {}

  dispose(): void {
    this.disposed = true;
  }

  assertActive(): void {
    if (this.disposed) throw new Error("The property migration stopped because the plugin was unloaded.");
  }

  private assertFile(file: TFile, path: string, source?: string): void {
    this.assertActive();
    if (file.path !== path || this.app.vault.getFileByPath(path) !== file) {
      throw new Error(`A migration file moved or was replaced: ${path}.`);
    }
    if (source === undefined) return;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView && (view.file === file || view.file?.path === path)
        && (view.file !== file || view.editor.getValue() !== source)) {
        throw new Error(`An open editor has unsaved or conflicting content: ${path}.`);
      }
    });
  }

  async prepare(): Promise<PreparedBasePropertyMigration> {
    this.assertActive();
    const files: PropertyMigrationFile[] = [];
    let membershipNoteCount = 0;
    let legacyBaseCount = 0;
    let legacyRecordIdCount = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
      const path = file.path;
      this.assertFile(file, path);
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as
        | Record<string, unknown>
        | undefined;
      const migrateMembership = frontmatter !== undefined
        && owns(frontmatter, LEGACY_TABLE_MEMBERSHIP_PROPERTY);
      const membership = tableMembershipState(frontmatter);
      if (migrateMembership) {
        if (membership.status === "invalid" || membership.status === "conflict") {
          throw new Error(`Conflicting or invalid Structural Tables membership in ${file.path}.`);
        }
        membershipNoteCount += 1;
      }
      const hasLegacyRecordId = frontmatter !== undefined
        && owns(frontmatter, LEGACY_RECORD_ID_PROPERTY)
        && membership.status === "valid"
        && membership.ids.length > 0;
      if (hasLegacyRecordId) legacyRecordIdCount += 1;
      const originalSource = await this.app.vault.read(file);
      this.assertFile(file, path);
      const legacyBases = promotionBlocksNeedingMigration(originalSource, path);
      for (const block of legacyBases) {
        await assertRecoveredPromotionOwnership(this.app, block);
        this.assertFile(file, path);
      }
      const fileLegacyBaseCount = legacyBases.length;
      legacyBaseCount += fileLegacyBaseCount;
      if (migrateMembership || hasLegacyRecordId || fileLegacyBaseCount > 0) {
        this.assertFile(file, path, originalSource);
        files.push({
          file,
          path,
          originalSource,
          migrateMembership,
          legacyBaseCount: fileLegacyBaseCount,
          hasLegacyRecordId,
          membershipIds: [...membership.ids],
          currentMembershipPresent: frontmatter !== undefined && owns(frontmatter, TABLE_MEMBERSHIP_PROPERTY),
          currentMembershipValue: frontmatter?.[TABLE_MEMBERSHIP_PROPERTY],
          legacyMembershipValue: frontmatter?.[LEGACY_TABLE_MEMBERSHIP_PROPERTY],
          legacyRecordIdValue: frontmatter?.[LEGACY_RECORD_ID_PROPERTY],
        });
      }
    }

    return { files, membershipNoteCount, legacyBaseCount, legacyRecordIdCount };
  }

  async execute(
    prepared: PreparedBasePropertyMigration,
    removeLegacyRecordIds: boolean,
  ): Promise<BasePropertyMigrationResult> {
    this.assertActive();
    const active = prepared.files.filter((candidate) => (
      candidate.migrateMembership
      || candidate.legacyBaseCount > 0
      || (removeLegacyRecordIds && candidate.hasLegacyRecordId)
    ));
    for (const candidate of active) {
      this.assertFile(candidate.file, candidate.path, candidate.originalSource);
      const current = await this.app.vault.read(candidate.file);
      this.assertFile(candidate.file, candidate.path, candidate.originalSource);
      if (current !== candidate.originalSource) {
        throw new Error(`A migration file changed after preview: ${candidate.path}.`);
      }
      const currentBases = promotionBlocksNeedingMigration(current, candidate.path);
      if (currentBases.length !== candidate.legacyBaseCount) {
        throw new Error(`A promoted Base changed after preview: ${candidate.path}.`);
      }
      for (const block of currentBases) {
        await assertRecoveredPromotionOwnership(this.app, block);
        this.assertFile(candidate.file, candidate.path, candidate.originalSource);
      }
      if (candidate.migrateMembership || (removeLegacyRecordIds && candidate.hasLegacyRecordId)) {
        migrateProperties(current, candidate, removeLegacyRecordIds);
      }
    }

    const written = new Map<PropertyMigrationFile, WrittenChanges>();
    try {
      for (const candidate of active) {
        this.assertFile(candidate.file, candidate.path, candidate.originalSource);
        const changes: WrittenChanges = { properties: [], bases: [] };
        await this.app.vault.process(candidate.file, (source) => {
          this.assertFile(candidate.file, candidate.path, source);
          if (source !== candidate.originalSource) {
            throw new Error(`A migration file changed during migration: ${candidate.path}.`);
          }
          let result = source;
          if (candidate.migrateMembership || (removeLegacyRecordIds && candidate.hasLegacyRecordId)) {
            const properties = migrateProperties(result, candidate, removeLegacyRecordIds);
            result = properties.source;
            changes.properties = properties.changes;
          }
          if (candidate.legacyBaseCount > 0) {
            const blocks = promotionBlocksNeedingMigration(result, candidate.path);
            if (blocks.length !== candidate.legacyBaseCount) {
              throw new Error(`A promoted Base changed during migration: ${candidate.path}.`);
            }
            changes.bases = blocks.map((block) => ({
              tableId: block.tableId,
              before: block.source,
              after: migrateMembershipFilter(block.source),
            }));
            result = migrateLegacyPromotionBlocks(result, candidate.path).source;
          }
          return result;
        });
        written.set(candidate, changes);
        this.assertFile(candidate.file, candidate.path);
      }
    } catch (error) {
      if (this.disposed) {
        const paths = [...written.keys()].map(({ path }) => path);
        throw new Error(`${errorMessage(error)} Completed changes were retained in ${paths.length} file(s)${paths.length === 0 ? "." : `: ${paths.join("; ")}.`}`);
      }
      const rollbackFailures: string[] = [];
      for (const [candidate, changes] of [...written].reverse()) {
        try {
          this.assertFile(candidate.file, candidate.path);
          await this.app.vault.process(candidate.file, (source) => {
            this.assertFile(candidate.file, candidate.path, source);
            let restored = source;
            if (changes.bases.length > 0) restored = restoreMigratedBaseBlocks(restored, changes.bases, candidate.path);
            if (changes.properties.length > 0) restored = restoreProperties(restored, changes.properties, candidate);
            return restored;
          });
          this.assertFile(candidate.file, candidate.path);
        } catch (rollbackError) {
          rollbackFailures.push(`${candidate.path}: ${errorMessage(rollbackError)}`);
          if (this.disposed) break;
        }
      }
      const suffix = rollbackFailures.length === 0
        ? " Every completed file was restored."
        : ` Rollback needs attention: ${rollbackFailures.join("; ")}`;
      throw new Error(`${errorMessage(error)}${suffix}`);
    }

    return {
      fileCount: active.length,
      membershipNoteCount: prepared.membershipNoteCount,
      legacyBaseCount: prepared.legacyBaseCount,
      removedRecordIdCount: removeLegacyRecordIds ? prepared.legacyRecordIdCount : 0,
    };
  }
}
