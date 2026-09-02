import {
  TFile,
  type App,
  type CachedMetadata,
  type TAbstractFile,
} from "obsidian";

import {
  promotionBlocks,
  tableMembershipState,
  type PromotionBlockMetadata,
} from "../core/base-promotion";
import type { AdoptedBaseRecord, BasePromotionService } from "./base-promotion-service";

const ADOPTION_WINDOW_MS = 30_000;

interface PendingRecord {
  createdAt: number;
  createdPath: string;
  sourceFile: TFile | null;
}

interface PromotionMatch {
  sourceFile: TFile;
  metadata: PromotionBlockMetadata;
}

interface MatchResult {
  match: PromotionMatch | null;
  ambiguous: boolean;
}

export interface BaseRecordAdoptionReporter {
  adopted(result: AdoptedBaseRecord): void;
  ambiguous(file: TFile): void;
  incompatible(file: TFile): void;
  failed(file: TFile, error: unknown): void;
}

type AdoptionService = Pick<BasePromotionService, "adoptCreatedRecord">;

export class PromotedBaseRecordAdopter {
  private readonly pending = new Map<TFile, PendingRecord>();
  private readonly inFlight = new Set<TFile>();

  constructor(
    private readonly app: App,
    private readonly service: AdoptionService,
    private readonly reporter: BaseRecordAdoptionReporter,
    private readonly now: () => number = Date.now,
  ) {}

  handleCreated(file: TAbstractFile): void {
    if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "md") return;
    const activeFile = this.app.workspace.getActiveFile();
    this.pending.set(file, {
      createdAt: this.now(),
      createdPath: file.path,
      sourceFile: activeFile === file ? null : activeFile,
    });
    const cache = this.app.metadataCache.getFileCache(file);
    if (cache !== null) void this.handleMetadataChanged(file, cache);
  }

  async handleMetadataChanged(file: TFile, cache: CachedMetadata): Promise<void> {
    const pending = this.pending.get(file);
    if (pending === undefined || this.inFlight.has(file)) return;
    if (this.now() - pending.createdAt > ADOPTION_WINDOW_MS) {
      this.pending.delete(file);
      return;
    }
    const membership = tableMembershipState(cache.frontmatter);
    if (membership.status === "invalid" || membership.status === "conflict") {
      this.pending.delete(file);
      this.reporter.incompatible(file);
      return;
    }
    const tableIds = new Set(membership.ids);
    if (tableIds.size === 0) return;

    this.inFlight.add(file);
    try {
      const resolved = await this.resolveMatch(file, pending.sourceFile, tableIds);
      this.pending.delete(file);
      if (resolved.ambiguous) {
        this.reporter.ambiguous(file);
        return;
      }
      if (resolved.match === null) return;
      const result = await this.service.adoptCreatedRecord(
        file,
        resolved.match.sourceFile,
        resolved.match.metadata,
        file.path === pending.createdPath,
      );
      if (result.adopted) this.reporter.adopted(result);
    } catch (error) {
      this.pending.delete(file);
      this.reporter.failed(file, error);
    } finally {
      this.inFlight.delete(file);
    }
  }

  pruneExpired(): void {
    const threshold = this.now() - ADOPTION_WINDOW_MS;
    for (const [file, pending] of this.pending) {
      if (pending.createdAt < threshold) this.pending.delete(file);
    }
  }

  private async resolveMatch(
    recordFile: TFile,
    expectedSource: TFile | null,
    tableIds: ReadonlySet<string>,
  ): Promise<MatchResult> {
    if (expectedSource !== null && expectedSource !== recordFile) {
      const matches = await this.matchesInFile(expectedSource, tableIds);
      if (matches.length === 1) return { match: matches[0] ?? null, ambiguous: false };
      if (matches.length > 1) return { match: null, ambiguous: true };
    }

    const matches: PromotionMatch[] = [];
    for (const sourceFile of this.app.vault.getMarkdownFiles()) {
      if (sourceFile === recordFile || sourceFile === expectedSource) continue;
      matches.push(...await this.matchesInFile(sourceFile, tableIds));
      if (matches.length > 1) return { match: null, ambiguous: true };
    }
    return { match: matches[0] ?? null, ambiguous: false };
  }

  private async matchesInFile(
    sourceFile: TFile,
    tableIds: ReadonlySet<string>,
  ): Promise<PromotionMatch[]> {
    try {
      const source = await this.app.vault.cachedRead(sourceFile);
      return promotionBlocks(source)
        .filter(({ tableId }) => tableIds.has(tableId))
        .map((metadata) => ({ sourceFile, metadata }));
    } catch {
      return [];
    }
  }
}
