import { TFile, type App } from "obsidian";

import {
  LEGACY_RECORD_ID_PROPERTY,
  LEGACY_TABLE_MEMBERSHIP_PROPERTY,
  migrateLegacyPromotionBlocks,
  promotionBlocks,
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
  legacyRecordIdValue: unknown;
}

interface MigratedBaseBlock {
  tableId: string;
  before: string;
  after: string;
}

interface WrittenChanges {
  frontmatter: boolean;
  bases: MigratedBaseBlock[];
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

function restoreMigratedBaseBlocks(source: string, changes: readonly MigratedBaseBlock[]): string {
  const available = promotionBlocks(source);
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
  constructor(private readonly app: App) {}

  async prepare(): Promise<PreparedBasePropertyMigration> {
    const files: PropertyMigrationFile[] = [];
    let membershipNoteCount = 0;
    let legacyBaseCount = 0;
    let legacyRecordIdCount = 0;

    for (const file of this.app.vault.getMarkdownFiles()) {
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
      const fileLegacyBaseCount = promotionBlocks(originalSource)
        .filter(({ membershipProperty }) => membershipProperty === LEGACY_TABLE_MEMBERSHIP_PROPERTY)
        .length;
      legacyBaseCount += fileLegacyBaseCount;
      if (migrateMembership || hasLegacyRecordId || fileLegacyBaseCount > 0) {
        files.push({
          file,
          path: file.path,
          originalSource,
          migrateMembership,
          legacyBaseCount: fileLegacyBaseCount,
          hasLegacyRecordId,
          membershipIds: [...membership.ids],
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
    const active = prepared.files.filter((candidate) => (
      candidate.migrateMembership
      || candidate.legacyBaseCount > 0
      || (removeLegacyRecordIds && candidate.hasLegacyRecordId)
    ));
    for (const candidate of active) {
      if (candidate.file.path !== candidate.path) {
        throw new Error(`A migration file moved after preview: ${candidate.path}.`);
      }
      const current = await this.app.vault.read(candidate.file);
      if (current !== candidate.originalSource) {
        throw new Error(`A migration file changed after preview: ${candidate.path}.`);
      }
    }

    const written = new Map<PropertyMigrationFile, WrittenChanges>();
    try {
      for (const candidate of active) {
        let expectedSource = candidate.originalSource;
        const changes: WrittenChanges = { frontmatter: false, bases: [] };
        if (candidate.migrateMembership || (removeLegacyRecordIds && candidate.hasLegacyRecordId)) {
          await this.app.fileManager.processFrontMatter(candidate.file, (frontmatter: Record<string, unknown>) => {
            const membership = tableMembershipState(frontmatter);
            if (membership.status !== "valid" || !sameStrings(membership.ids, candidate.membershipIds)) {
              throw new Error(`Structural Tables membership changed during migration: ${candidate.path}.`);
            }
            if (candidate.migrateMembership) {
              if (!owns(frontmatter, LEGACY_TABLE_MEMBERSHIP_PROPERTY)) {
                throw new Error(`Structural Tables membership changed during migration: ${candidate.path}.`);
              }
              frontmatter[TABLE_MEMBERSHIP_PROPERTY] = [...membership.ids];
              delete frontmatter[LEGACY_TABLE_MEMBERSHIP_PROPERTY];
            }
            if (removeLegacyRecordIds && candidate.hasLegacyRecordId) {
              if (!owns(frontmatter, LEGACY_RECORD_ID_PROPERTY)
                || !sameValue(frontmatter[LEGACY_RECORD_ID_PROPERTY], candidate.legacyRecordIdValue)) {
                throw new Error(`Structural Tables record ID changed during migration: ${candidate.path}.`);
              }
              delete frontmatter[LEGACY_RECORD_ID_PROPERTY];
            }
          });
          changes.frontmatter = true;
          written.set(candidate, changes);
          expectedSource = await this.app.vault.read(candidate.file);
        }

        if (candidate.legacyBaseCount > 0) {
          const expectedTableIds = promotionBlocks(candidate.originalSource)
            .filter(({ membershipProperty }) => membershipProperty === LEGACY_TABLE_MEMBERSHIP_PROPERTY)
            .map(({ tableId }) => tableId);
          const migrated = await this.app.vault.process(candidate.file, (source) => {
            if (source !== expectedSource) {
              throw new Error(`A migration file changed during migration: ${candidate.path}.`);
            }
            const currentTableIds = promotionBlocks(source)
              .filter(({ membershipProperty }) => membershipProperty === LEGACY_TABLE_MEMBERSHIP_PROPERTY)
              .map(({ tableId }) => tableId);
            if (JSON.stringify(currentTableIds) !== JSON.stringify(expectedTableIds)) {
              throw new Error(`A promoted Base changed during migration: ${candidate.path}.`);
            }
            const currentBlocks = promotionBlocks(source)
              .filter(({ membershipProperty }) => membershipProperty === LEGACY_TABLE_MEMBERSHIP_PROPERTY);
            changes.bases = currentBlocks.map((block) => ({
              tableId: block.tableId,
              before: block.source,
              after: migrateMembershipFilter(block.source),
            }));
            return migrateLegacyPromotionBlocks(source).source;
          });
          if (migrated === expectedSource) throw new Error(`A promoted Base changed during migration: ${candidate.path}.`);
          written.set(candidate, changes);
        }
      }
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const candidate of [...active].reverse()) {
        const changes = written.get(candidate);
        if (changes === undefined) continue;
        try {
          if (changes.bases.length > 0) {
            await this.app.vault.process(candidate.file, (source) => restoreMigratedBaseBlocks(source, changes.bases));
          }
          if (changes.frontmatter) {
            await this.app.fileManager.processFrontMatter(candidate.file, (frontmatter: Record<string, unknown>) => {
              const membership = tableMembershipState(frontmatter);
              if (membership.status !== "valid" || !sameStrings(membership.ids, candidate.membershipIds)) {
                throw new Error("membership changed after migration wrote it");
              }
              if (candidate.migrateMembership) {
                if (!owns(frontmatter, TABLE_MEMBERSHIP_PROPERTY)
                  || owns(frontmatter, LEGACY_TABLE_MEMBERSHIP_PROPERTY)) {
                  throw new Error("membership properties changed after migration wrote them");
                }
                frontmatter[LEGACY_TABLE_MEMBERSHIP_PROPERTY] = [...candidate.membershipIds];
                delete frontmatter[TABLE_MEMBERSHIP_PROPERTY];
              }
              if (removeLegacyRecordIds && candidate.hasLegacyRecordId) {
                if (owns(frontmatter, LEGACY_RECORD_ID_PROPERTY)) {
                  if (!sameValue(frontmatter[LEGACY_RECORD_ID_PROPERTY], candidate.legacyRecordIdValue)) {
                    throw new Error("record ID changed after migration removed it");
                  }
                } else {
                  frontmatter[LEGACY_RECORD_ID_PROPERTY] = candidate.legacyRecordIdValue;
                }
              }
            });
          }
        } catch (rollbackError) {
          rollbackFailures.push(`${candidate.path}: ${errorMessage(rollbackError)}`);
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
