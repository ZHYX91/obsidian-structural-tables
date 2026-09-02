import { TFile, type App } from "obsidian";

import {
  LEGACY_RECORD_ID_PROPERTY,
  LEGACY_TABLE_MEMBERSHIP_PROPERTY,
  migrateLegacyPromotionBlocks,
  promotionBlocks,
  TABLE_MEMBERSHIP_PROPERTY,
  tableMembershipState,
} from "../core/base-promotion";

interface PropertyMigrationFile {
  file: TFile;
  path: string;
  originalSource: string;
  migrateMembership: boolean;
  legacyBaseCount: number;
  hasLegacyRecordId: boolean;
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
      if (migrateMembership) {
        const membership = tableMembershipState(frontmatter);
        if (membership.status === "invalid" || membership.status === "conflict") {
          throw new Error(`Conflicting or invalid Structural Tables membership in ${file.path}.`);
        }
        membershipNoteCount += 1;
      }
      const hasLegacyRecordId = frontmatter !== undefined && owns(frontmatter, LEGACY_RECORD_ID_PROPERTY);
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

    const written = new Map<PropertyMigrationFile, string>();
    try {
      for (const candidate of active) {
        if (candidate.migrateMembership || (removeLegacyRecordIds && candidate.hasLegacyRecordId)) {
          await this.app.fileManager.processFrontMatter(candidate.file, (frontmatter: Record<string, unknown>) => {
            if (candidate.migrateMembership) {
              const membership = tableMembershipState(frontmatter);
              if (
                membership.status !== "valid"
                || !owns(frontmatter, LEGACY_TABLE_MEMBERSHIP_PROPERTY)
              ) {
                throw new Error(`Structural Tables membership changed during migration: ${candidate.path}.`);
              }
              frontmatter[TABLE_MEMBERSHIP_PROPERTY] = [...membership.ids];
              delete frontmatter[LEGACY_TABLE_MEMBERSHIP_PROPERTY];
            }
            if (removeLegacyRecordIds) delete frontmatter[LEGACY_RECORD_ID_PROPERTY];
          });
          written.set(candidate, await this.app.vault.read(candidate.file));
        }

        if (candidate.legacyBaseCount > 0) {
          const expectedTableIds = promotionBlocks(candidate.originalSource)
            .filter(({ membershipProperty }) => membershipProperty === LEGACY_TABLE_MEMBERSHIP_PROPERTY)
            .map(({ tableId }) => tableId);
          const migrated = await this.app.vault.process(candidate.file, (source) => {
            const currentTableIds = promotionBlocks(source)
              .filter(({ membershipProperty }) => membershipProperty === LEGACY_TABLE_MEMBERSHIP_PROPERTY)
              .map(({ tableId }) => tableId);
            if (JSON.stringify(currentTableIds) !== JSON.stringify(expectedTableIds)) {
              throw new Error(`A promoted Base changed during migration: ${candidate.path}.`);
            }
            return migrateLegacyPromotionBlocks(source).source;
          });
          written.set(candidate, migrated);
        }
      }
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const candidate of [...active].reverse()) {
        const expectedWritten = written.get(candidate);
        if (expectedWritten === undefined) continue;
        try {
          await this.app.vault.process(candidate.file, (source) => {
            if (source !== expectedWritten) {
              throw new Error("the file changed after migration wrote it");
            }
            return candidate.originalSource;
          });
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
