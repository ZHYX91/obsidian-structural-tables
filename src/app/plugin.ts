import {
  MarkdownView,
  Notice,
  Plugin,
  type Command,
  type Editor,
  type TFile,
} from "obsidian";

import { createTranslator, operationNotice, type Translate } from "../config/i18n";
import {
  DEFAULT_SETTINGS,
  cloneSettings,
  normalizeStoredSettings,
  sanitizeSettings,
  type StructuralTablesSettings,
} from "../config/settings";
import {
  cellColumnAt,
  mergeCell,
  splitCell,
  type MergeDirection,
  type OperationResult,
} from "../core/operations";
import {
  enabledConflictingPlugins,
  migrateSheetsExtendedTable,
  structuralTableToDelimited,
  structuralTableToHtml,
  structuralTableToPlainGfm,
} from "../core/interchange";
import { parseEditableTables, parseStructuralTables } from "../core/parser";
import { serializeStructuralTable } from "../core/serializer";
import { reparseUnchangedTable } from "../core/table-snapshot";
import type { StructuralTable } from "../core/model";
import {
  promotionBlockAt,
  type BasePromotionBlocker,
  type BasePromotionWarning,
} from "../core/base-promotion";
import { NativeTableMenuBridge } from "../editor/native-table-menu";
import { StructuralTableEditorController } from "../editor/table-live-preview";
import {
  addBasePromotionMenuItem,
  addSelectionMenuItems,
  hasSelectionMenuItems,
  type TableOperation,
} from "../editor/table-menu";
import { replaceTableSource } from "../editor/table-replacement";
import { copyHtml, copyText, structuralSourceFromClipboardHtml } from "../editor/table-interchange";
import { selectedStructuralTableCells } from "../editor/table-selection";
import { StructuralTableReadingProcessor } from "../reading/table-postprocessor";
import { StructuralTablesSettingTab } from "./settings-tab";
import type { SettingsSaveStatus } from "./settings-save-coordinator";
import { SettingsPersistenceSession } from "./settings-persistence-session";
import { ConversionPreviewModal } from "./conversion-preview-modal";
import { BasePromotionModal } from "./base-promotion-modal";
import { BasePromotionService } from "./base-promotion-service";
import { BasePropertyMigrationModal } from "./base-property-migration-modal";
import { BasePropertyMigrationService } from "./base-property-migration-service";
import { PromotedBaseRecordAdopter } from "./promoted-base-record-adopter";

const TEMPLATE = `| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- || --- | --- |
| North | 10 | 12 |
| ^ | 8 | 11 |`;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function promotionWarningText(t: Translate, warning: BasePromotionWarning): string {
  if (warning === "flatten-multi-row-headers") return t("promotion.warning.flattenMultiRowHeaders");
  if (warning === "flatten-merged-column-headers") return t("promotion.warning.flattenMergedColumnHeaders");
  if (warning === "row-headers-become-properties") return t("promotion.warning.rowHeadersBecomeProperties");
  return t("promotion.warning.repeatRowHeaders");
}

function promotionBlockerText(t: Translate, blocker: BasePromotionBlocker): string {
  return t("promotion.blocker.mergedDataCell")
    .replace("{row}", String(blocker.row))
    .replace("{column}", String(blocker.column))
    .replace("{rowSpan}", String(blocker.rowSpan))
    .replace("{columnSpan}", String(blocker.columnSpan));
}

export class StructuralTablesPlugin extends Plugin {
  override settings: StructuralTablesSettings = cloneSettings(DEFAULT_SETTINGS);
  private editorController: StructuralTableEditorController | null = null;
  private basePromotionService: BasePromotionService | null = null;
  private basePropertyMigrationService: BasePropertyMigrationService | null = null;
  private readonly localizedCommands: Command[] = [];
  private settingsPersistence: SettingsPersistenceSession | null = null;

  override async onload(): Promise<void> {
    const loaded = normalizeStoredSettings(await this.loadData());
    this.settingsPersistence = new SettingsPersistenceSession(
      loaded,
      (data) => this.saveData(data),
    );
    this.settings = this.settingsPersistence.initialSettings();
    void this.settingsPersistence.start().catch(() => undefined);
    const promote = (editor: Editor, sourceFile: TFile | null, table: StructuralTable): void => {
      this.previewBasePromotion(editor, sourceFile, table);
    };
    this.editorController = new StructuralTableEditorController(this.app, () => this.settings, promote);
    const basePromotionService = new BasePromotionService(this.app, this.manifest.version);
    this.basePromotionService = basePromotionService;
    this.basePropertyMigrationService = new BasePropertyMigrationService(this.app);
    const baseRecordAdopter = new PromotedBaseRecordAdopter(this.app, basePromotionService, {
      adopted: ({ file }) => new Notice(
        createTranslator(this.settings.language)("notice.recordAdopted").replace("{path}", file.path),
      ),
      ambiguous: () => new Notice(
        createTranslator(this.settings.language)("notice.recordAdoptionAmbiguous"),
        8000,
      ),
      incompatible: () => new Notice(
        createTranslator(this.settings.language)("notice.recordAdoptionIncompatible"),
        8000,
      ),
      failed: (_file, error) => new Notice(
        createTranslator(this.settings.language)("notice.recordAdoptionFailed")
          .replace("{message}", errorMessage(error)),
        8000,
      ),
    });
    this.registerEditorExtension(this.editorController.createExtension());
    const reading = new StructuralTableReadingProcessor(this.app, () => this.settings);
    this.registerMarkdownPostProcessor((element, context) => reading.process(element, context));
    new NativeTableMenuBridge(this.app, () => this.settings, promote).register(this);
    this.addSettingTab(new StructuralTablesSettingTab(this.app, this));
    this.registerCommands();
    this.registerEditorMenu();
    this.registerHtmlTablePaste();
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (file) => baseRecordAdopter.handleCreated(file)));
      this.registerEvent(this.app.metadataCache.on("changed", (file, _data, cache) => {
        void baseRecordAdopter.handleMetadataChanged(file, cache);
      }));
      this.registerInterval(window.setInterval(() => baseRecordAdopter.pruneExpired(), 30_000));
      this.warnAboutPluginConflicts();
    });
  }

  override onunload(): void {
    void this.settingsPersistence?.flush().catch((error: unknown) => {
      console.error("Structural Tables: failed to flush settings", error);
    });
  }

  async updateSettings(update: Partial<StructuralTablesSettings>): Promise<void> {
    if (this.settingsPersistence == null) {
      throw new Error("Structural Tables settings persistence is unavailable.");
    }
    this.settingsPersistence.assertWritable();
    this.settings = sanitizeSettings({ ...this.settings, ...update });
    this.refreshCommandNames();
    this.editorController?.refresh();
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
    });
    await this.settingsPersistence.save(this.settings);
  }

  settingsSaveStatus(): SettingsSaveStatus {
    return this.settingsPersistence?.status() ?? { state: "saved", error: null };
  }

  subscribeSettingsSaveStatus(listener: (status: SettingsSaveStatus) => void): () => void {
    return this.settingsPersistence?.subscribe(listener) ?? (() => undefined);
  }

  retrySettingsSave(): Promise<void> {
    return this.settingsPersistence?.retry() ?? Promise.resolve();
  }

  private registerCommands(): void {
    const t = createTranslator(this.settings.language);
    this.localizedCommands.push(this.addCommand({
      id: "insert-structural-table",
      name: t("command.insert"),
      editorCallback: (editor) => {
        editor.replaceSelection(TEMPLATE);
        new Notice(createTranslator(this.settings.language)("notice.inserted"));
      },
    }));
    this.localizedCommands.push(this.addCommand({
      id: "migrate-legacy-base-properties",
      name: t("command.migrateBaseProperties"),
      callback: () => { void this.previewBasePropertyMigration(); },
    }));
    this.localizedCommands.push(this.addCommand({
      id: "promote-current-table-to-base",
      name: t("command.promoteBase"),
      editorCallback: (editor, context) => this.previewBasePromotion(editor, context.file),
    }));
    this.localizedCommands.push(this.addCommand({
      id: "restore-current-promoted-base-to-table",
      name: t("command.restorePromotedTable"),
      editorCallback: (editor) => { void this.previewPromotedTableRestore(editor); },
    }));
    this.localizedCommands.push(this.addCommand({
      id: "create-record-for-current-promoted-base",
      name: t("command.createBaseRecord"),
      editorCallback: (editor, context) => { void this.createPromotedBaseRecord(editor, context.file); },
    }));
    this.localizedCommands.push(this.addCommand({
      id: "copy-current-table-as-html",
      name: t("command.copyHtml"),
      editorCallback: (editor) => this.copyCurrentTable(editor, "HTML"),
    }));
    this.localizedCommands.push(this.addCommand({
      id: "copy-current-table-as-plain-gfm",
      name: t("command.copyGfm"),
      editorCallback: (editor) => this.copyCurrentTable(editor, "GFM"),
    }));
    this.localizedCommands.push(this.addCommand({
      id: "copy-current-table-as-tsv",
      name: t("command.copyTsv"),
      editorCallback: (editor) => this.copyCurrentTable(editor, "TSV"),
    }));
    this.localizedCommands.push(this.addCommand({
      id: "copy-current-table-as-csv",
      name: t("command.copyCsv"),
      editorCallback: (editor) => this.copyCurrentTable(editor, "CSV"),
    }));
    this.localizedCommands.push(this.addCommand({
      id: "convert-current-table-to-plain-gfm",
      name: t("command.convertGfm"),
      editorCallback: (editor) => this.previewPlainGfmConversion(editor),
    }));
    this.localizedCommands.push(this.addCommand({
      id: "convert-current-sheets-extended-table",
      name: t("command.migrateSheets"),
      editorCallback: (editor) => this.migrateSheetsExtended(editor),
    }));
    this.localizedCommands.push(this.addCommand({
      id: "format-current-structural-table",
      name: t("command.format"),
      editorCallback: (editor) => this.formatCurrent(editor),
    }));
    this.localizedCommands.push(this.addCommand({ id: "merge-current-cell-left", name: t("command.mergeLeft"), editorCallback: (editor) => this.editMerge(editor, "left") }));
    this.localizedCommands.push(this.addCommand({ id: "merge-current-cell-up", name: t("command.mergeUp"), editorCallback: (editor) => this.editMerge(editor, "up") }));
    this.localizedCommands.push(this.addCommand({ id: "split-current-merged-cell", name: t("command.split"), editorCallback: (editor) => this.editSplit(editor) }));
    this.localizedCommands.push(this.addCommand({
      id: "validate-current-note",
      name: t("command.validate"),
      editorCallback: (editor) => {
        const tables = parseStructuralTables(editor.getValue()).tables;
        const diagnostics = tables.flatMap((table) => table.diagnostics);
        new Notice(diagnostics.length === 0
          ? createTranslator(this.settings.language)("notice.valid")
          : diagnostics.map((diagnostic) => `Line ${diagnostic.row + 1}: ${diagnostic.message}`).join("\n"));
      },
    }));
  }

  private refreshCommandNames(): void {
    const t = createTranslator(this.settings.language);
    const names: Record<string, string> = {
      "convert-current-sheets-extended-table": t("command.migrateSheets"),
      "convert-current-table-to-plain-gfm": t("command.convertGfm"),
      "copy-current-table-as-csv": t("command.copyCsv"),
      "copy-current-table-as-html": t("command.copyHtml"),
      "copy-current-table-as-plain-gfm": t("command.copyGfm"),
      "copy-current-table-as-tsv": t("command.copyTsv"),
      "create-record-for-current-promoted-base": t("command.createBaseRecord"),
      "format-current-structural-table": t("command.format"),
      "insert-structural-table": t("command.insert"),
      "merge-current-cell-left": t("command.mergeLeft"),
      "merge-current-cell-up": t("command.mergeUp"),
      "migrate-legacy-base-properties": t("command.migrateBaseProperties"),
      "promote-current-table-to-base": t("command.promoteBase"),
      "restore-current-promoted-base-to-table": t("command.restorePromotedTable"),
      "split-current-merged-cell": t("command.split"),
      "validate-current-note": t("command.validate"),
    };
    for (const command of this.localizedCommands) command.name = names[command.id] ?? command.name;
  }

  private registerEditorMenu(): void {
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      const t = createTranslator(this.settings.language);
      const offset = editor.posToOffset(editor.getCursor());
      const promoted = promotionBlockAt(editor.getValue(), offset);
      if (promoted !== null) {
        menu.addItem((item) => item
          .setSection("structural-tables-base")
          .setIcon("file-plus-2")
          .setTitle(t("menu.createBaseRecord"))
          .onClick(() => { void this.createPromotedBaseRecord(editor, info.file); }));
        menu.addItem((item) => item
          .setSection("structural-tables-base")
          .setIcon("rotate-ccw")
          .setTitle(t("menu.restorePromotedTable"))
          .onClick(() => { void this.previewPromotedTableRestore(editor); }));
        return;
      }
      const current = this.currentTable(editor);
      if (current !== null && current.table.valid) {
        addBasePromotionMenuItem(menu, t, current.table, () => {
          this.previewBasePromotion(editor, info.file, current.table);
        });
      }
      const selection = selectedStructuralTableCells(editor);
      if (selection === null || !selection.table.valid || !selection.rectangular || !hasSelectionMenuItems(selection)) return;
      addSelectionMenuItems(
        menu,
        t,
        selection,
        (operation) => this.applyMenuOperation(editor, selection.table, operation),
      );
    }));
  }

  private registerHtmlTablePaste(): void {
    this.registerEvent(this.app.workspace.on("editor-paste", (event, editor) => {
      if (!this.settings.convertHtmlTablePaste || event.defaultPrevented) return;
      const html = event.clipboardData?.getData("text/html") ?? "";
      const source = structuralSourceFromClipboardHtml(html);
      if (source === null) return;
      event.preventDefault();
      editor.replaceSelection(source);
      new Notice(createTranslator(this.settings.language)("notice.htmlTableImported"));
    }));
  }

  private warnAboutPluginConflicts(): void {
    if (!this.settings.warnPluginConflicts) return;
    const manager = (this.app as unknown as { plugins?: { enabledPlugins?: Iterable<string> } }).plugins;
    const conflicts = enabledConflictingPlugins(manager?.enabledPlugins ?? []);
    if (conflicts.length === 0) return;
    const message = createTranslator(this.settings.language)("notice.conflictingPlugins")
      .replace("{plugins}", conflicts.join(", "));
    new Notice(message, 8000);
  }

  private currentTable(editor: Editor): { table: StructuralTable; row: number; column: number } | null {
    const cursor = editor.getCursor();
    const offset = editor.posToOffset(cursor);
    const table = parseEditableTables(editor.getValue()).tables.find((candidate) => offset >= candidate.range.from && offset <= candidate.range.to);
    if (table === undefined) return null;
    const row = table.rows.findIndex((candidate) => candidate.sourceLine === cursor.line);
    if (row < 0) return { table, row: -1, column: -1 };
    const column = cellColumnAt(editor.getLine(cursor.line), cursor.ch);
    return { table, row, column: Math.min(column ?? 0, table.columnCount - 1) };
  }

  private replaceTable(editor: Editor, table: StructuralTable, source: string): void {
    replaceTableSource(editor, table, source);
  }

  private formatCurrent(editor: Editor): void {
    const current = this.currentTable(editor);
    if (current === null) return this.noTable();
    if (!current.table.valid) {
      new Notice(current.table.diagnostics[0]?.message ?? "Invalid structural table.");
      return;
    }
    const t = createTranslator(this.settings.language);
    const source = serializeStructuralTable(current.table);
    new ConversionPreviewModal(this.app, {
      title: t("modal.format.title"),
      description: t("modal.format.desc"),
      source,
      cancelLabel: t("modal.cancel"),
      confirmLabel: t("modal.format.confirm"),
      onConfirm: () => {
        const reparsed = reparseUnchangedTable(editor.getValue(), current.table);
        if (reparsed === null) {
          new Notice(t("notice.staleTable"));
          return;
        }
        this.replaceTable(editor, reparsed, source);
        new Notice(t("notice.formatted"));
      },
    }).open();
  }

  private copyCurrentTable(editor: Editor, format: "HTML" | "GFM" | "TSV" | "CSV"): void {
    const current = this.currentTable(editor);
    if (current === null) return this.noTable();
    if (!current.table.valid) {
      new Notice(current.table.diagnostics[0]?.message ?? "Invalid structural table.");
      return;
    }
    const output = format === "HTML"
      ? structuralTableToHtml(current.table)
      : format === "GFM"
        ? structuralTableToPlainGfm(current.table)
        : structuralTableToDelimited(current.table, format === "CSV" ? "," : "\t");
    const write = format === "HTML" ? copyHtml(output) : copyText(output);
    void write.then(() => {
      const message = createTranslator(this.settings.language)("notice.copied").replace("{format}", format);
      new Notice(message);
    }).catch(() => new Notice(createTranslator(this.settings.language)("notice.clipboardFailed")));
  }

  private previewPlainGfmConversion(editor: Editor): void {
    const current = this.currentTable(editor);
    if (current === null) return this.noTable();
    if (!current.table.valid) {
      new Notice(current.table.diagnostics[0]?.message ?? "Invalid structural table.");
      return;
    }
    const t = createTranslator(this.settings.language);
    const source = structuralTableToPlainGfm(current.table);
    new ConversionPreviewModal(this.app, {
      title: t("modal.convertGfm.title"),
      description: t("modal.convertGfm.desc"),
      source,
      cancelLabel: t("modal.cancel"),
      confirmLabel: t("modal.convertGfm.replace"),
      onConfirm: () => {
        const reparsed = reparseUnchangedTable(editor.getValue(), current.table);
        if (reparsed === null) {
          new Notice(t("notice.staleTable"));
          return;
        }
        this.replaceTable(editor, reparsed, source);
        new Notice(t("notice.convertedGfm"));
      },
    }).open();
  }

  private migrateSheetsExtended(editor: Editor): void {
    const current = this.currentTable(editor);
    if (current === null) return this.noTable();
    const migration = migrateSheetsExtendedTable(current.table);
    const t = createTranslator(this.settings.language);
    if (migration === null) {
      new Notice(t("notice.sheetsNotDetected"));
      return;
    }
    this.replaceTable(editor, current.table, migration.source);
    new Notice(t("notice.sheetsMigrated"));
  }

  private previewBasePromotion(
    editor: Editor,
    sourceFile: TFile | null,
    expectedTable?: StructuralTable,
  ): void {
    if (sourceFile === null || this.basePromotionService === null) {
      new Notice(createTranslator(this.settings.language)("notice.noFile"));
      return;
    }
    const internalPlugins = (this.app as unknown as {
      internalPlugins?: { getPluginById?: (id: string) => { enabled?: boolean } | null };
    }).internalPlugins;
    if (internalPlugins?.getPluginById?.("bases")?.enabled !== true) {
      new Notice(createTranslator(this.settings.language)("notice.basesRequired"));
      return;
    }
    const table = expectedTable === undefined
      ? this.currentTable(editor)?.table ?? null
      : reparseUnchangedTable(editor.getValue(), expectedTable);
    if (table === null) {
      if (expectedTable !== undefined) new Notice(createTranslator(this.settings.language)("notice.staleTable"));
      else this.noTable();
      return;
    }
    const t = createTranslator(this.settings.language);
    try {
      const prepared = this.basePromotionService.prepare(table, sourceFile);
      const expandsStructure = table.structural;
      new BasePromotionModal(
        this.app,
        prepared,
        {
          title: t(expandsStructure ? "modal.promoteBase.structuralTitle" : "modal.promoteBase.title"),
          description: t(expandsStructure ? "modal.promoteBase.structuralDesc" : "modal.promoteBase.desc"),
          target: t("modal.promoteBase.target"),
          records: t("modal.promoteBase.records"),
          columns: t("modal.promoteBase.columns"),
          warning: (warning) => promotionWarningText(t, warning),
          blockingIssues: t("modal.promoteBase.blockingIssues"),
          blocker: (blocker) => promotionBlockerText(t, blocker),
          cancel: t("modal.cancel"),
          confirm: t("modal.promoteBase.confirm"),
        },
        async () => {
          if (this.basePromotionService === null) throw new Error("Base promotion service is unavailable.");
          await this.basePromotionService.execute(editor, table, prepared);
          new Notice(t("notice.promoted").replace("{path}", prepared.manifestPath), 8000);
        },
        (error) => new Notice(t("notice.promoteFailed").replace("{message}", errorMessage(error)), 8000),
      ).open();
    } catch (error) {
      new Notice(t("notice.promoteFailed").replace("{message}", errorMessage(error)), 8000);
    }
  }

  private async previewPromotedTableRestore(editor: Editor): Promise<void> {
    const service = this.basePromotionService;
    const t = createTranslator(this.settings.language);
    const offset = editor.posToOffset(editor.getCursor());
    const metadata = promotionBlockAt(editor.getValue(), offset);
    if (metadata === null || service === null) {
      new Notice(t("notice.noPromotedBase"));
      return;
    }
    try {
      const source = await service.restorationSource(metadata);
      new ConversionPreviewModal(this.app, {
        title: t("modal.restoreBase.title"),
        description: t("modal.restoreBase.desc"),
        source,
        cancelLabel: t("modal.cancel"),
        confirmLabel: t("modal.restoreBase.confirm"),
        onConfirm: () => {
          void service.restore(editor, metadata)
            .then(() => new Notice(t("notice.restored"), 8000))
            .catch((error: unknown) => new Notice(
              t("notice.restoreFailed").replace("{message}", errorMessage(error)),
              8000,
            ));
        },
      }).open();
    } catch (error) {
      new Notice(t("notice.restoreFailed").replace("{message}", errorMessage(error)), 8000);
    }
  }

  private async previewBasePropertyMigration(): Promise<void> {
    const service = this.basePropertyMigrationService;
    const t = createTranslator(this.settings.language);
    if (service === null) return;
    try {
      const prepared = await service.prepare();
      if (
        prepared.membershipNoteCount === 0
        && prepared.legacyBaseCount === 0
        && prepared.legacyRecordIdCount === 0
      ) {
        new Notice(t("notice.noBasePropertiesToMigrate"));
        return;
      }
      new BasePropertyMigrationModal(
        this.app,
        prepared,
        {
          title: t("modal.migrateBaseProperties.title"),
          description: t("modal.migrateBaseProperties.desc"),
          membershipNotes: t("modal.migrateBaseProperties.membershipNotes"),
          promotedBases: t("modal.migrateBaseProperties.promotedBases"),
          retiredRecordIds: t("modal.migrateBaseProperties.retiredRecordIds"),
          removeRecordIds: t("modal.migrateBaseProperties.removeRecordIds"),
          removeRecordIdsDescription: t("modal.migrateBaseProperties.removeRecordIdsDesc"),
          cancel: t("modal.cancel"),
          confirm: t("modal.migrateBaseProperties.confirm"),
        },
        async (removeLegacyRecordIds) => {
          const result = await service.execute(prepared, removeLegacyRecordIds);
          const message = t("notice.basePropertiesMigrated")
            .replace("{files}", String(result.fileCount))
            .replace("{memberships}", String(result.membershipNoteCount))
            .replace("{bases}", String(result.legacyBaseCount))
            .replace("{ids}", String(result.removedRecordIdCount));
          new Notice(message, 8000);
        },
        (error) => new Notice(
          t("notice.basePropertyMigrationFailed").replace("{message}", errorMessage(error)),
          8000,
        ),
      ).open();
    } catch (error) {
      new Notice(
        t("notice.basePropertyMigrationFailed").replace("{message}", errorMessage(error)),
        8000,
      );
    }
  }

  private async createPromotedBaseRecord(editor: Editor, sourceFile: TFile | null): Promise<void> {
    const t = createTranslator(this.settings.language);
    const service = this.basePromotionService;
    if (sourceFile === null || service === null) {
      new Notice(t("notice.noFile"));
      return;
    }
    const metadata = promotionBlockAt(editor.getValue(), editor.posToOffset(editor.getCursor()));
    if (metadata === null) {
      new Notice(t("notice.noPromotedBase"));
      return;
    }
    try {
      const created = await service.createRecord(sourceFile, metadata);
      new Notice(t("notice.recordCreated").replace("{path}", created.path));
    } catch (error) {
      new Notice(t("notice.promoteFailed").replace("{message}", errorMessage(error)), 8000);
    }
  }

  private editMerge(editor: Editor, direction: MergeDirection): void {
    const current = this.currentTable(editor);
    if (current === null || current.row < 0) return this.noTable();
    const result = mergeCell(current.table, current.row, current.column, direction);
    this.applyOperation(editor, current.table, result);
  }

  private editSplit(editor: Editor): void {
    const current = this.currentTable(editor);
    if (current === null || current.row < 0) return this.noTable();
    const result = splitCell(current.table, current.row, current.column);
    this.applyOperation(editor, current.table, result);
  }

  private applyOperation(editor: Editor, table: StructuralTable, result: OperationResult): void {
    if (result.changed) this.replaceTable(editor, table, result.source);
    new Notice(operationNotice(createTranslator(this.settings.language), result.code));
  }

  private applyMenuOperation(
    editor: Editor,
    expected: StructuralTable,
    operation: TableOperation,
  ): void {
    const current = reparseUnchangedTable(editor.getValue(), expected);
    if (current === null) {
      new Notice(createTranslator(this.settings.language)("notice.staleTable"));
      return;
    }
    this.applyOperation(editor, current, operation(current));
  }

  private noTable(): void {
    new Notice(createTranslator(this.settings.language)("notice.noTable"));
  }
}
