import {
  App,
  normalizePath,
  stringifyYaml,
  TFile,
  TFolder,
  type Editor,
} from "obsidian";

import {
  buildBasePromotionPlan,
  embeddedBaseSource,
  promotionBlockAt,
  RECORD_ID_PROPERTY,
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

export interface AdoptedBaseRecord {
  file: TFile;
  adopted: boolean;
  moved: boolean;
}

interface PromotionManifest {
  version: 1;
  pluginVersion: string;
  tableId: string;
  sourceFilePath: string;
  originalTableSource: string;
  replacementSource: string;
  createdAt: string;
  records: { recordId: string; path: string }[];
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

function recordContent(tableId: string, record: PromotionRecord): string {
  const frontmatter = {
    [TABLE_MEMBERSHIP_PROPERTY]: [tableId],
    [RECORD_ID_PROPERTY]: record.recordId,
    ...record.values,
  };
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n`;
}

function randomId(prefix: "stb" | "str"): string {
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

function promotionManifest(value: unknown): PromotionManifest | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Partial<PromotionManifest>;
  if (
    source.version !== 1
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
  constructor(private readonly app: App) {}

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
    const rowCount = table.rows.length - table.headerRowCount;
    const plan = buildBasePromotionPlan(
      table,
      tableId,
      Array.from({ length: rowCount }, () => randomId("str")),
    );
    const manifestPath = joinedPath(directoryPath, "_promotion.json");
    const replacementSource = applyLineEnding(embeddedBaseSource(plan, manifestPath), lineEnding(table.source));
    const records = uniqueRecordPaths(directoryPath, plan);
    const manifest: PromotionManifest = {
      version: 1,
      pluginVersion: "0.3.0",
      tableId,
      sourceFilePath: sourceFile.path,
      originalTableSource: table.source,
      replacementSource,
      createdAt: new Date().toISOString(),
      records: records.map(({ path, record }) => ({ path, recordId: record.recordId })),
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
    await this.app.vault.createFolder(prepared.directoryPath);
    try {
      for (const record of prepared.records) await this.app.vault.create(record.path, record.content);
      await this.app.vault.create(prepared.manifestPath, prepared.manifestContent);
      const verified = reparseUnchangedTable(editor.getValue(), current);
      if (verified === null) throw new Error("The table changed while records were being created.");
      replaceTableSource(editor, verified, prepared.replacementSource);
    } catch (error) {
      await this.trashCreatedDirectory(prepared.directoryPath);
      throw error;
    }
  }

  async restore(editor: Editor, expected: PromotionBlockMetadata): Promise<void> {
    const current = promotionBlockAt(editor.getValue(), expected.range.from + 1);
    if (current === null || current.source !== expected.source || current.tableId !== expected.tableId) {
      throw new Error("The promoted Base changed before it could be restored.");
    }
    const manifest = await this.readManifest(expected);
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
    const directory = joinedPath(parentPath(sourceFile.path), RECORDS_FOLDER, metadata.tableId);
    await this.ensureFolder(directory);
    const recordId = randomId("str");
    const shortId = recordId.slice(-8);
    let path = joinedPath(directory, `Record ${shortId}.md`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path) !== null) {
      path = joinedPath(directory, `Record ${shortId} ${suffix}.md`);
      suffix += 1;
    }
    const values = Object.fromEntries(metadata.propertyKeys.map((key) => [key, ""]));
    const created = await this.app.vault.create(path, recordContent(metadata.tableId, {
      recordId,
      fileStem: `Record ${shortId}`,
      values,
    }));
    await this.app.workspace.getLeaf(false).openFile(created);
    return created;
  }

  async adoptCreatedRecord(
    recordFile: TFile,
    sourceFile: TFile,
    metadata: PromotionBlockMetadata,
    moveToInbox: boolean,
  ): Promise<AdoptedBaseRecord> {
    let adopted = false;
    await this.app.fileManager.processFrontMatter(recordFile, (frontmatter) => {
      const properties = frontmatter as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(properties, RECORD_ID_PROPERTY)) return;
      properties[RECORD_ID_PROPERTY] = randomId("str");
      adopted = true;
    });
    if (!adopted || !moveToInbox) return { file: recordFile, adopted, moved: false };

    const directory = joinedPath(parentPath(sourceFile.path), RECORDS_FOLDER, metadata.tableId);
    await this.ensureFolder(directory);
    const destination = this.availableRecordPath(directory, recordFile);
    if (destination === recordFile.path) return { file: recordFile, adopted: true, moved: false };
    await this.app.fileManager.renameFile(recordFile, destination);
    return { file: recordFile, adopted: true, moved: true };
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

  private availableRecordPath(directory: string, file: TFile): string {
    let path = joinedPath(directory, file.name);
    let suffix = 2;
    while (true) {
      const existing = this.app.vault.getAbstractFileByPath(path);
      if (existing === null || existing === file) return path;
      path = joinedPath(directory, `${file.basename} ${suffix}.${file.extension}`);
      suffix += 1;
    }
  }

  private async trashCreatedDirectory(path: string): Promise<void> {
    const created = this.app.vault.getAbstractFileByPath(path);
    if (created instanceof TFolder) await this.app.fileManager.trashFile(created);
  }

  private async readManifest(expected: PromotionBlockMetadata): Promise<PromotionManifest> {
    const manifestFile = this.app.vault.getFileByPath(expected.manifestPath);
    if (manifestFile === null) throw new Error("The promotion manifest could not be found.");
    const manifest = promotionManifest(JSON.parse(await this.app.vault.read(manifestFile)) as unknown);
    if (manifest === null || manifest.tableId !== expected.tableId) {
      throw new Error("The promotion manifest does not match this Base.");
    }
    return manifest;
  }
}
