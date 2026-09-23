import {
  App,
  normalizePath,
  stringifyYaml,
  TFile,
  type Editor,
} from "obsidian";

import {
  buildBasePromotionPlan,
  embeddedBaseSource,
  promotionBlockAt,
  promotionBlocks,
  TABLE_MEMBERSHIP_PROPERTY,
  type BasePromotionPlan,
  type PromotionBlockMetadata,
  type PromotionRecord,
} from "../core/base-promotion";
import type { StructuralTable } from "../core/model";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { replaceTableSource } from "../editor/table-replacement";

const RECORDS_FOLDER = "_structural-table-records";

interface PreparedRecord {
  path: string;
  record: PromotionRecord;
  content: string;
}

export interface PreparedBasePromotion {
  plan: BasePromotionPlan;
  sourceFilePath: string;
  directoryPath: string;
  manifestPath: string;
  replacementSource: string;
  records: PreparedRecord[];
  manifestContent: string;
}

interface PromotionManifest {
  version: 1 | 2;
  pluginVersion: string;
  tableId: string;
  sourceFilePath: string;
  originalTableSource: string;
  replacementSource: string;
  createdAt: string;
  records: { recordId?: string; path: string }[];
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function joinedPath(...parts: string[]): string {
  return normalizePath(parts.filter((part) => part !== "").join("/"));
}

function lineEnding(source: string): "\r\n" | "\r" | "\n" {
  if (source.includes("\r\n")) return "\r\n";
  if (source.includes("\r")) return "\r";
  return "\n";
}

function applyLineEnding(source: string, ending: string): string {
  return source.replace(/\r\n|\r|\n/gu, ending);
}

function recordContent(
  tableId: string,
  record: PromotionRecord,
  membershipProperty = TABLE_MEMBERSHIP_PROPERTY,
): string {
  const frontmatter = {
    [membershipProperty]: [tableId],
    ...record.values,
  };
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n`;
}

function randomId(prefix: "stb"): string {
  const uuid = activeWindow.crypto.randomUUID().replace(/-/gu, "");
  return `${prefix}_${uuid}`;
}

function uniqueRecordPaths(directory: string, plan: BasePromotionPlan): PreparedRecord[] {
  const used = new Set<string>();
  return plan.records.map((record) => {
    const base = record.fileStem;
    let fileName = `${base}.md`;
    let suffix = 2;
    while (used.has(fileName.toLocaleLowerCase())) {
      fileName = `${base} ${suffix}.md`;
      suffix += 1;
    }
    used.add(fileName.toLocaleLowerCase());
    return { path: joinedPath(directory, fileName), record, content: recordContent(plan.tableId, record) };
  });
}

function matchingPromotionBlock(editor: Editor, expected: PromotionBlockMetadata): PromotionBlockMetadata | null {
  const matches = promotionBlocks(editor.getValue(), expected.recoveredSourcePath).filter((candidate) =>
    candidate.tableId === expected.tableId
    && candidate.manifestPath === expected.manifestPath
    && candidate.source === expected.source);
  return matches.length === 1 ? matches[0] ?? null : null;
}

function promotionManifest(value: unknown): PromotionManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Partial<PromotionManifest>;
  if (
    (source.version !== 1 && source.version !== 2)
    || typeof source.pluginVersion !== "string"
    || source.pluginVersion.trim() === ""
    || typeof source.tableId !== "string"
    || typeof source.sourceFilePath !== "string"
    || typeof source.originalTableSource !== "string"
    || typeof source.replacementSource !== "string"
    || !Array.isArray(source.records)
  ) return null;
  return source as PromotionManifest;
}

export class BasePromotionService {
  constructor(
    private readonly app: App,
    private readonly pluginVersion = "0.4.0",
  ) {}

  prepare(table: StructuralTable, sourceFile: TFile): PreparedBasePromotion {
    let tableId = randomId("stb");
    let directoryPath = joinedPath(parentPath(sourceFile.path), RECORDS_FOLDER, tableId);
    for (let attempt = 0; attempt < 10 && this.app.vault.getAbstractFileByPath(directoryPath) !== null; attempt += 1) {
      tableId = randomId("stb");
      directoryPath = joinedPath(parentPath(sourceFile.path), RECORDS_FOLDER, tableId);
    }
    if (this.app.vault.getAbstractFileByPath(directoryPath) !== null) {
      throw new Error("Could not allocate a unique record folder.");
    }
    const plan = buildBasePromotionPlan(table, tableId);
    const manifestPath = joinedPath(directoryPath, "_promotion.json");
    const replacementSource = applyLineEnding(embeddedBaseSource(plan, manifestPath), lineEnding(table.source));
    const records = uniqueRecordPaths(directoryPath, plan);
    const manifest: PromotionManifest = {
      version: 2,
      pluginVersion: this.pluginVersion,
      tableId,
      sourceFilePath: sourceFile.path,
      originalTableSource: table.source,
      replacementSource,
      createdAt: new Date().toISOString(),
      records: records.map(({ path }) => ({ path })),
    };
    return {
      plan,
      sourceFilePath: sourceFile.path,
      directoryPath,
      manifestPath,
      replacementSource,
      records,
      manifestContent: `${JSON.stringify(manifest, null, 2)}\n`,
    };
  }

  async execute(editor: Editor, expected: StructuralTable, prepared: PreparedBasePromotion): Promise<void> {
    if (prepared.plan.blockers.length > 0) {
      throw new Error("Resolve every blocking structural conversion issue before upgrading this table to a Base.");
    }
    if (this.app.vault.getAbstractFileByPath(prepared.directoryPath) !== null) {
      throw new Error("The target record folder already exists.");
    }
    const current = reparseUnchangedTable(editor.getValue(), expected);
    if (current === null) throw new Error("The table changed while the preview was open.");
    await this.ensureFolder(parentPath(prepared.directoryPath));
    const createdDirectory = await this.app.vault.createFolder(prepared.directoryPath);
    try {
      for (const record of prepared.records) await this.app.vault.create(record.path, record.content);
      await this.app.vault.create(prepared.manifestPath, prepared.manifestContent);
      const verified = reparseUnchangedTable(editor.getValue(), current);
      if (verified === null) throw new Error("The table changed while records were being created.");
      replaceTableSource(editor, verified, prepared.replacementSource);
    } catch (error) {
      // Vault reads cannot atomically authorize trashing. A sync client, plugin or user
      // may change even an already-checked file before trashFile() removes the folder.
      // Retain all partial output and leave cleanup to an explicit user decision.
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Base upgrade failed; generated files were left in place for review. Record folder: ${createdDirectory.path}. Original failure: ${detail}`,
      );
    }
  }

  async restore(editor: Editor, expected: PromotionBlockMetadata): Promise<void> {
    if (matchingPromotionBlock(editor, expected) === null) {
      throw new Error("The promoted Base changed before it could be restored.");
    }
    const manifest = await this.readManifest(expected);
    const current = matchingPromotionBlock(editor, expected);
    if (current === null) {
      throw new Error("The promoted Base changed while its recovery manifest was being read.");
    }
    editor.replaceRange(
      manifest.originalTableSource,
      editor.offsetToPos(current.range.from),
      editor.offsetToPos(current.range.to),
    );
  }

  async restorationSource(expected: PromotionBlockMetadata): Promise<string> {
    return (await this.readManifest(expected)).originalTableSource;
  }

  async createRecord(sourceFile: TFile, metadata: PromotionBlockMetadata): Promise<TFile> {
    if (metadata.recoveredSourcePath !== undefined) await this.readManifest(metadata);
    const directory = joinedPath(parentPath(sourceFile.path), RECORDS_FOLDER, metadata.tableId);
    await this.ensureFolder(directory);
    let path = joinedPath(directory, "Record.md");
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path) !== null) {
      path = joinedPath(directory, `Record ${suffix}.md`);
      suffix += 1;
    }
    const values = Object.fromEntries(metadata.propertyKeys.map((key) => [key, ""]));
    const created = await this.app.vault.create(path, recordContent(metadata.tableId, {
      fileStem: "Record",
      values,
    }, metadata.membershipProperty ?? TABLE_MEMBERSHIP_PROPERTY));
    await this.app.workspace.getLeaf(false).openFile(created);
    return created;
  }

  private async ensureFolder(path: string): Promise<void> {
    if (path === "") return;
    const segments = normalizePath(path).split("/");
    let current = "";
    for (const segment of segments) {
      current = joinedPath(current, segment);
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile) throw new Error(`A file blocks the target folder: ${current}`);
      if (existing === null) await this.app.vault.createFolder(current);
    }
  }

  private async readManifest(expected: PromotionBlockMetadata): Promise<PromotionManifest> {
    const manifestFile = this.app.vault.getFileByPath(expected.manifestPath);
    if (manifestFile === null) throw new Error("The promotion manifest could not be found.");
    const manifest = promotionManifest(JSON.parse(await this.app.vault.read(manifestFile)) as unknown);
    if (manifest === null || manifest.tableId !== expected.tableId) {
      throw new Error("The promotion manifest does not match this Base.");
    }
    if (expected.recoveredSourcePath !== undefined) {
      const original = promotionBlockAt(manifest.replacementSource, 1);
      if (manifest.sourceFilePath !== expected.recoveredSourcePath
        || original?.tableId !== expected.tableId || original.manifestPath !== expected.manifestPath) {
        throw new Error("The recovery manifest does not prove ownership of this Base.");
      }
    }
    return manifest;
  }
}
