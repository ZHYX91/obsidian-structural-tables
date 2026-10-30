import {
  MarkdownView,
  Notice,
  Plugin,
  type Modal,
  type Command,
  type Editor,
  type TFile,
} from "obsidian";

import { createTranslator, diagnosticNotice, operationNotice, type Translate } from "../config/i18n";
import { displayPathText } from "../config/interface-bidi";
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
} from "../core/interchange";
import { parseEditableTables, parseStructuralTables } from "../core/parser";
import { serializeStructuralTable } from "../core/serializer";
import { reparseUnchangedTable } from "../core/table-snapshot";
import { validateTableOperationInDocument } from "../core/table-operation-document";
import { hasHiddenGfmOverflow } from "../core/table-write-safety";
import type { StructuralTable } from "../core/model";
import {
  promotionBlockAt,
  type BasePromotionBlocker,
  type BasePromotionWarning,
} from "../core/base-promotion";
import type { BasePromotionContentKind } from "../core/base-promotion-content";
import { NativeTableMenuBridge } from "../editor/native-table-menu";
import { registerTableMenuIcons } from "../editor/table-menu-icons";
import { captureEditorTransposeTarget, openEditorTableTranspose } from "../editor/table-transpose-target";
import { requestWholeTableTranspose } from "./table-transpose-modal";
import { StructuralTableEditorController } from "../editor/table-live-preview";
import {
  addBasePromotionMenuItem,
  addImageExportMenuItem,
  addPlainGfmMenuItem,
  addSelectionMenuItems,
  addWholeTableTransposeMenuItem,
  hasSelectionMenuItems,
} from "../editor/table-menu";
import { replaceTableSource } from "../editor/table-replacement";
import { copyText, replaceSelectionFromClipboardTable } from "../editor/table-interchange";
import { selectedStructuralTableCells } from "../editor/table-selection";
import { StructuralTableReadingProcessor } from "../reading/table-postprocessor";
import { attachedEditorContext, editorTableContext, editorTableDirection } from "../editor/editor-view-context";
import { StructuralTablesSettingTab } from "./settings-tab";
import type { SettingsSaveStatus } from "./settings-save-coordinator";
import { SettingsPersistenceSession } from "./settings-persistence-session";
import { settingsStoreScheduler } from "./settings-store-queue";
import { captureEditorTableCommandTarget } from "../editor/table-command-target";
import { ConversionPreviewModal } from "./conversion-preview-modal";
import { BasePromotionModal } from "./base-promotion-modal";
import {
  BasePromotionService,
  captureBaseEditorTarget,
  type BaseEditorInfo,
  type BasePromotionContentAcceptance,
} from "./base-promotion-service";
import { BasePropertyMigrationModal } from "./base-property-migration-modal";
import { BasePropertyMigrationService } from "./base-property-migration-service";
import { showRecoveredCellDrafts } from "../editor/cell-draft-recovery";
import { TableImageExportService } from "./table-image-modal";
import { PlainGfmConversionService } from "./plain-gfm-modal";
import { captureEditorPlainGfmTarget } from "../editor/plain-gfm-target";
import { addEditorTableHtmlCopyMenuItem } from "../editor/table-html-menu";
import { planPlainGfmConversion } from "../core/plain-gfm-conversion";
import { copyTableForWord, startTableCopySession, tableCopySession, type TableCopySession } from "./table-html-copy";

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

function promotionContentKindText(t: Translate, kind: BasePromotionContentKind): string {
  if (kind === "visual-break") return t("modal.promoteBase.contentVisualBreak");
  if (kind === "code-literal") return t("modal.promoteBase.contentCodeLiteral");
  if (kind === "escaped-literal") return t("modal.promoteBase.contentEscapedLiteral");
  if (kind === "entity-literal") return t("modal.promoteBase.contentEntityLiteral");
  if (kind === "math-uncertain") return t("modal.promoteBase.contentMathUncertain");
  if (kind === "html-uncertain") return t("modal.promoteBase.contentHtmlUncertain");
  return t("modal.promoteBase.contentSyntaxUncertain");
}

export class StructuralTablesPlugin extends Plugin {
  override settings: StructuralTablesSettings = cloneSettings(DEFAULT_SETTINGS);
  private editorController: StructuralTableEditorController | null = null;
  private basePromotionService: BasePromotionService | null = null;
  private basePropertyMigrationService: BasePropertyMigrationService | null = null;
  private readonly localizedCommands: Command[] = [];
  private settingsPersistence: SettingsPersistenceSession | null = null;
  private imageExport: TableImageExportService | null = null;
  private plainGfm: PlainGfmConversionService | null = null;
  private transposeRequestsActive = true;
  private runtimeEpoch?: object;
  private operationPreviews?: Set<Modal>;
  private clipboardCopySession?: TableCopySession;

  override async onload(): Promise<void> {
    this.runtimeEpoch = {};
    this.transposeRequestsActive = true;
    this.clipboardCopySession = startTableCopySession(this.app);
    const isActive = this.captureRuntime();
    registerTableMenuIcons(this);
    const schedule = settingsStoreScheduler(this.app);
    const loaded = normalizeStoredSettings(await schedule(() => this.loadData()));
    if (!isActive()) return;
    this.settingsPersistence = new SettingsPersistenceSession(
      loaded,
      (data) => this.saveData(data),
      schedule,
    );
    this.settings = this.settingsPersistence.initialSettings();
    void this.settingsPersistence.start().catch(() => undefined);
    const promote = (editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable): void => {
      if (isActive()) this.previewBasePromotion(editor, getInfo, table);
    };
    this.imageExport = new TableImageExportService(this.app, () => ({ settings: this.settings, t: createTranslator(this.settings.language) }));
    const imageExport = this.imageExport;
    this.register(() => imageExport.dispose());
    this.plainGfm = new PlainGfmConversionService(this.app, () => createTranslator(this.settings.language));
    const plainGfm = this.plainGfm;
    this.register(() => plainGfm.close());
    this.editorController = new StructuralTableEditorController(this.app, () => this.settings, promote, this.imageExport.open, this.plainGfm.open);
    const basePromotionService = new BasePromotionService(this.app, this.manifest.version);
    this.basePromotionService = basePromotionService;
    this.basePropertyMigrationService = new BasePropertyMigrationService(this.app);
    this.registerEditorExtension(this.editorController.createExtension());
    const reading = new StructuralTableReadingProcessor(this.app, () => this.settings, this.imageExport.open, this.plainGfm.open);
    this.registerMarkdownPostProcessor((element, context) => reading.process(element, context));
    new NativeTableMenuBridge(this.app, () => this.settings, promote, this.imageExport.open, this.plainGfm.open).register(this);
    this.addSettingTab(new StructuralTablesSettingTab(this.app, this));
    this.registerCommands();
    this.localizedCommands.push(this.addCommand({
      id: "recover-cell-drafts",
      name: createTranslator(this.settings.language)("command.recoverDrafts"),
      callback: () => { if (isActive()) showRecoveredCellDrafts(this.app, createTranslator(this.settings.language)); },
    }));
    this.registerEditorMenu();
    this.registerHtmlTablePaste();
    this.app.workspace.onLayoutReady(() => {
      if (isActive()) this.warnAboutPluginConflicts();
    });
  }

  private captureRuntime(): () => boolean {
    const epoch = this.runtimeEpoch;
    return () => this.transposeRequestsActive !== false && this.runtimeEpoch === epoch;
  }

  override onunload(): void {
    this.transposeRequestsActive = false;
    this.clipboardCopySession?.dispose();
    this.basePromotionService?.dispose();
    this.basePropertyMigrationService?.dispose();
    this.imageExport?.dispose();
    for (const modal of this.operationPreviews ?? []) modal.close();
    this.operationPreviews?.clear();
    void this.settingsPersistence?.close().catch((error: unknown) => {
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
    const isActive = this.captureRuntime();
    const register = (command: Command): Command => this.addCommand({
      ...command,
      ...(command.callback === undefined ? {} : { callback: () => { if (isActive()) command.callback!(); } }),
      ...(command.editorCallback === undefined ? {} : {
        editorCallback: ((editor, info) => { if (isActive()) command.editorCallback!(editor, info); }) as NonNullable<Command["editorCallback"]>,
      }),
    });
    const t = createTranslator(this.settings.language);
    this.localizedCommands.push(register({
      id: "export-current-table-as-image", name: t("command.exportImage"),
      editorCallback: (editor, info) => {
        const current = this.currentTable(editor);
        if (current === null) return this.noTable();
        if (!current.table.valid) {
          const translator = createTranslator(this.settings.language);
          const diagnostic = current.table.diagnostics[0];
          new Notice(diagnostic === undefined ? translator("operation.tableInvalid") : diagnosticNotice(translator, diagnostic));
          return;
        }
        this.exportImage(editor, () => info, current.table);
      },
    }));
    this.localizedCommands.push(register({
      id: "transpose-current-table", name: t("command.transpose"),
      editorCallback: (editor, context) => {
        const current = this.currentTable(editor);
        if (current === null) return this.noTable();
        const translator = createTranslator(this.settings.language);
        openEditorTableTranspose(this.app, editor, current.table, translator,
          context instanceof MarkdownView ? context : undefined,
          isActive);
      },
    }));
    this.localizedCommands.push(register({
      id: "insert-structural-table",
      name: t("command.insert"),
      editorCallback: (editor) => {
        editor.replaceSelection(TEMPLATE);
        new Notice(createTranslator(this.settings.language)("notice.inserted"));
      },
    }));
    this.localizedCommands.push(register({
      id: "migrate-legacy-base-properties",
      name: t("command.migrateBaseProperties"),
      callback: () => { void this.previewBasePropertyMigration(); },
    }));
    this.localizedCommands.push(register({
      id: "promote-current-table-to-base",
      name: t("command.promoteBase"),
      editorCallback: (editor, context) => this.previewBasePromotion(editor, () => context),
    }));
    this.localizedCommands.push(register({
      id: "restore-current-promoted-base-to-table",
      name: t("command.restorePromotedTable"),
      editorCallback: (editor, info) => { void this.previewPromotedTableRestore(editor, () => info); },
    }));
    this.localizedCommands.push(register({
      id: "create-record-for-current-promoted-base",
      name: t("command.createBaseRecord"),
      editorCallback: (editor, context) => { void this.createPromotedBaseRecord(editor, context.file); },
    }));
    this.localizedCommands.push(register({
      id: "copy-current-table-as-html",
      name: t("command.copyHtml"),
      editorCallback: (editor, context) => this.copyCurrentTable(editor, "HTML", context.file?.path ?? "", context instanceof MarkdownView ? context : undefined),
    }));
    this.localizedCommands.push(register({
      id: "copy-current-table-as-plain-gfm",
      name: t("command.copyGfm"),
      editorCallback: (editor) => this.copyCurrentTable(editor, "GFM"),
    }));
    this.localizedCommands.push(register({
      id: "copy-current-table-as-tsv",
      name: t("command.copyTsv"),
      editorCallback: (editor) => this.copyCurrentTable(editor, "TSV"),
    }));
    this.localizedCommands.push(register({
      id: "copy-current-table-as-csv",
      name: t("command.copyCsv"),
      editorCallback: (editor) => this.copyCurrentTable(editor, "CSV"),
    }));
    this.localizedCommands.push(register({
      id: "convert-current-table-to-plain-gfm",
      name: t("command.convertGfm"),
      editorCallback: (editor, context) => this.previewPlainGfmConversion(editor, context.file),
    }));
    this.localizedCommands.push(register({
      id: "convert-current-sheets-extended-table",
      name: t("command.migrateSheets"),
      editorCallback: (editor) => this.migrateSheetsExtended(editor),
    }));
    this.localizedCommands.push(register({
      id: "format-current-structural-table",
      name: t("command.format"),
      editorCallback: (editor, context) => this.formatCurrent(editor, context.file),
    }));
    this.localizedCommands.push(register({ id: "merge-current-cell-left", name: t("command.mergeLeft"), editorCallback: (editor) => this.editMerge(editor, "left") }));
    this.localizedCommands.push(register({ id: "merge-current-cell-up", name: t("command.mergeUp"), editorCallback: (editor) => this.editMerge(editor, "up") }));
    this.localizedCommands.push(register({ id: "split-current-merged-cell", name: t("command.split"), editorCallback: (editor) => this.editSplit(editor) }));
    this.localizedCommands.push(register({
      id: "validate-current-note",
      name: t("command.validate"),
      editorCallback: (editor) => {
        const t = createTranslator(this.settings.language);
        const tables = parseStructuralTables(editor.getValue()).tables;
        const diagnostics = tables.flatMap((table) => table.diagnostics);
        new Notice(diagnostics.length === 0
          ? t("notice.valid")
          : diagnostics.map((diagnostic) => t("notice.validationLine")
            .replace("{line}", String(diagnostic.row + 1))
            .replace("{message}", diagnosticNotice(t, diagnostic))).join("\n"));
      },
    }));
  }

  private refreshCommandNames(): void {
    const t = createTranslator(this.settings.language);
    const names: Record<string, string> = {
      "export-current-table-as-image": t("command.exportImage"),
      "transpose-current-table": t("command.transpose"),
      "recover-cell-drafts": t("command.recoverDrafts"),
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
    const idPrefix = `${this.manifest.id}:`;
    const namePrefix = `${this.manifest.name}: `;
    for (const command of this.localizedCommands) {
      const localId = command.id.startsWith(idPrefix) ? command.id.slice(idPrefix.length) : command.id;
      const localizedName = names[localId];
      if (localizedName === undefined) continue;
      command.name = command.name.startsWith(namePrefix)
        ? `${namePrefix}${localizedName}`
        : localizedName;
    }
  }

  private registerEditorMenu(): void {
    const isActive = this.captureRuntime();
    this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => {
      if (!isActive()) return;
      const t = createTranslator(this.settings.language);
      const sourceAtOpen = editor.getValue();
      const fileAtOpen = info.file;
      const pathAtOpen = fileAtOpen?.path;
      const owner = attachedEditorContext(this.app, editor, info instanceof MarkdownView ? info : undefined);
      const menuIsCurrent = (): boolean => isActive() && editor.getValue() === sourceAtOpen
        && owner !== null && owner.isCurrent()
        && info.file === fileAtOpen && fileAtOpen?.path === pathAtOpen
        && (fileAtOpen == null || this.app.vault.getFileByPath(pathAtOpen!) === fileAtOpen)
        && (!(info instanceof MarkdownView) || (info.editor === editor && info.containerEl.isConnected));
      const requireMenu = (action: () => void): void => {
        if (menuIsCurrent()) action();
        else new Notice(t("notice.staleTable"));
      };
      const offset = editor.posToOffset(editor.getCursor());
      const promoted = promotionBlockAt(editor.getValue(), offset, info.file?.path);
      if (promoted !== null) {
        menu.addItem((item) => item
          .setSection("structural-tables-base")
          .setIcon("file-plus-2")
          .setTitle(t("menu.createBaseRecord"))
          .onClick(() => { requireMenu(() => { void this.createPromotedBaseRecord(editor, fileAtOpen); }); }));
        menu.addItem((item) => item
          .setSection("structural-tables-base")
          .setIcon("rotate-ccw")
          .setTitle(t("menu.restorePromotedTable"))
          .onClick(() => { requireMenu(() => { void this.previewPromotedTableRestore(editor, () => menuIsCurrent() ? info : null); }); }));
        return;
      }
      const current = this.currentTable(editor);
      const selection = selectedStructuralTableCells(editor);
      if (selection !== null && selection.table.valid && selection.rectangular && hasSelectionMenuItems(selection)) {
        const target = captureEditorTableCommandTarget(this.app, editor, selection.table,
          info instanceof MarkdownView ? info : undefined, isActive);
        addSelectionMenuItems(
          menu, t, selection,
          (operation) => {
            if (!isActive()) return;
            const result = target?.apply((_source, table) => operation(table));
            new Notice(result == null ? t("notice.staleTable") : operationNotice(t, result.code));
          },
          { direction: editorTableDirection(this.app, editor, selection.table, info instanceof MarkdownView ? info : undefined) },
        );
      }
      if (current === null || !current.table.valid) return;
      // Capture editor/file ownership at menu creation; a later view rebind
      // with byte-identical Markdown must not redirect this action.
      const targetView = info instanceof MarkdownView ? info : undefined;
      const transposeTarget = captureEditorTransposeTarget(
        this.app, editor, current.table, t, targetView, isActive,
      );
      addWholeTableTransposeMenuItem(menu, t, () => {
        if (!isActive()) return;
        if (transposeTarget === null) { new Notice(t("notice.staleTable")); return; }
        requestWholeTableTranspose(this.app, t, current.table, transposeTarget);
      });
      const gfmTarget = captureEditorPlainGfmTarget(this.app, editor, current.table, targetView,
        isActive);
      addPlainGfmMenuItem(menu, t, () => {
        if (!isActive()) return;
        if (gfmTarget === null) { new Notice(t("notice.staleTable")); return; }
        this.plainGfm?.open(current.table, gfmTarget);
      });
      addEditorTableHtmlCopyMenuItem(menu, this.app, editor, current.table, () => this.settings, targetView,
        isActive);
      addImageExportMenuItem(menu, t, () => requireMenu(() => this.exportImage(editor, () => menuIsCurrent() ? info : null, current.table)));
      addBasePromotionMenuItem(menu, t, current.table, () => {
        requireMenu(() => this.previewBasePromotion(editor, () => menuIsCurrent() ? info : null, current.table));
      });
    }));
  }

  private registerHtmlTablePaste(): void {
    const isActive = this.captureRuntime();
    this.registerEvent(this.app.workspace.on("editor-paste", (event, editor) => {
      if (!isActive()) return;
      if (!this.settings.convertHtmlTablePaste || event.defaultPrevented || event.clipboardData === null) return;
      const result = replaceSelectionFromClipboardTable(event.clipboardData, editor);
      if (result === "native") return;
      event.preventDefault();
      const t = createTranslator(this.settings.language);
      if (result === "table") new Notice(t("notice.htmlTableImported"));
      else if (result === "plain") new Notice(t("notice.clipboardPlainFallback"));
      else if (result === "blocked-empty") new Notice(t("notice.htmlEmptyTableBlocked"));
      else if (result === "blocked-boundary") new Notice(t("operation.invalidResult"));
      else new Notice(t("notice.htmlTextSemanticsBlocked"));
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
    const column = cellColumnAt(editor.getLine(cursor.line), cursor.ch, table);
    return { table, row, column: Math.min(column ?? 0, table.columnCount - 1) };
  }

  private exportImage(editor: Editor, getInfo: BaseEditorInfo, table: StructuralTable): void {
    if (this.transposeRequestsActive === false) return;
    const info = getInfo();
    const sourcePath = info?.file?.path;
    if (sourcePath === undefined) { new Notice(createTranslator(this.settings.language)("notice.noFile")); return; }
    const context = editorTableContext(this.app, editor, table);
    if (context === null || context.file !== info?.file) { new Notice(createTranslator(this.settings.language)("notice.staleTable")); return; }
    this.imageExport?.open(table, sourcePath, () => getInfo()?.file === context.file && context.isCurrent(), context.element);
  }

  private replaceTable(editor: Editor, table: StructuralTable, source: string): void {
    replaceTableSource(editor, table, source);
  }

  private blockUnsafeTableWrite(table: StructuralTable): boolean {
    if (!hasHiddenGfmOverflow(table)) return false;
    const t = createTranslator(this.settings.language);
    new Notice(operationNotice(t, "gfm-overflow-readonly"), 8000);
    return true;
  }


  private captureConversionTarget(editor: Editor, sourceFile: TFile | null): (() => boolean) | null {
    if (sourceFile === null) return null;
    const sourcePath = sourceFile.path;
    const isActive = this.captureRuntime();
    return () => {
      if (!isActive()) return false;
      if (sourceFile.path !== sourcePath || this.app.vault.getFileByPath(sourcePath) !== sourceFile) return false;
      let current = false;
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (
          leaf.view instanceof MarkdownView
          && leaf.view.editor === editor
          && leaf.view.file === sourceFile
        ) current = true;
      });
      return current;
    };
  }

  private formatCurrent(editor: Editor, sourceFile: TFile | null): void {
    const t = createTranslator(this.settings.language);
    const current = this.currentTable(editor);
    if (current === null) return this.noTable();
    if (!current.table.valid) {
      new Notice(current.table.diagnostics[0] === undefined ? t("operation.tableInvalid") : diagnosticNotice(t, current.table.diagnostics[0]));
      return;
    }
    if (this.blockUnsafeTableWrite(current.table)) return;
    const targetIsCurrent = this.captureConversionTarget(editor, sourceFile);
    if (targetIsCurrent === null) {
      new Notice(t("notice.noFile"));
      return;
    }
    const source = serializeStructuralTable(current.table);
    this.openOperationPreview((onClose) => new ConversionPreviewModal(this.app, {
      language: t.locale ?? "en",
      title: t("modal.format.title"),
      description: t("modal.format.desc"),
      source,
      cancelLabel: t("modal.cancel"),
      confirmLabel: t("modal.format.confirm"),
      onClose,
      onConfirm: () => {
        if (!targetIsCurrent()) {
          new Notice(t("notice.staleTable"));
          return;
        }
        const reparsed = reparseUnchangedTable(editor.getValue(), current.table);
        if (reparsed === null) {
          new Notice(t("notice.staleTable"));
          return;
        }
        this.replaceTable(editor, reparsed, source);
        new Notice(t("notice.formatted"));
      },
    }));
  }

  private copyCurrentTable(editor: Editor, format: "HTML" | "GFM" | "TSV" | "CSV", sourcePath = "", viewHint?: MarkdownView): void {
    this.clipboardCopySession ??= tableCopySession(this.app);
    const t = createTranslator(this.settings.language);
    const current = this.currentTable(editor);
    if (current === null) return this.noTable();
    if (!current.table.valid) {
      new Notice(current.table.diagnostics[0] === undefined ? t("operation.tableInvalid") : diagnosticNotice(t, current.table.diagnostics[0]));
      return;
    }
    const direction = format === "HTML" ? editorTableDirection(this.app, editor, current.table, viewHint) : "ltr";
    if (format === "HTML") {
      // A command deliberately copies its invocation snapshot; unlike a menu
      // target it does not follow or reject subsequent source edits.
      void copyTableForWord(this.app, current.table, this.settings.appearance, {
        sourcePath, direction, isCurrent: () => true,
      }, t, this.clipboardCopySession);
      return;
    }
    const isCurrent = this.clipboardCopySession.begin();
    const write = Promise.resolve().then(async () => {
      if (!isCurrent()) return;
      const text = format === "GFM"
        ? (() => { const conversion = planPlainGfmConversion(current.table)!; return conversion[conversion.recommended]!.source; })()
        : structuralTableToDelimited(current.table, format === "CSV" ? "," : "\t");
      await copyText(text);
    });
    void write.then(() => {
      if (!isCurrent()) return;
      const t = createTranslator(this.settings.language);
      new Notice(t("notice.copied").replace("{format}", format));
    }).catch(() => { if (isCurrent()) new Notice(createTranslator(this.settings.language)("notice.clipboardFailed")); });
  }

  private previewPlainGfmConversion(editor: Editor, sourceFile: TFile | null): void {
    const t = createTranslator(this.settings.language);
    const current = this.currentTable(editor);
    if (current === null) return this.noTable();
    if (!current.table.valid) {
      new Notice(current.table.diagnostics[0] === undefined ? t("operation.tableInvalid") : diagnosticNotice(t, current.table.diagnostics[0]));
      return;
    }
    if (sourceFile === null) { new Notice(t("notice.noFile")); return; }
    const target = captureEditorPlainGfmTarget(this.app, editor, current.table, undefined, () => this.transposeRequestsActive);
    if (target === null || this.app.vault.getFileByPath(target.sourcePath) !== sourceFile) {
      new Notice(t("notice.staleTable")); return;
    }
    this.plainGfm?.open(current.table, target);
  }

  private migrateSheetsExtended(editor: Editor): void {
    const current = this.currentTable(editor);
    if (current === null) return this.noTable();
    const t = createTranslator(this.settings.language);
    if (this.blockUnsafeTableWrite(current.table)) return;
    const migration = migrateSheetsExtendedTable(current.table);
    if (migration === null) {
      new Notice(t("notice.sheetsNotDetected"));
      return;
    }
    // Removing the separator column must not absorb neighboring pipe rows
    // that did not belong to the original table.
    const validated = validateTableOperationInDocument(editor.getValue(), current.table, {
      changed: true,
      code: "table-converted",
      message: "Sheets Extended table converted.",
      source: migration.source,
    });
    if (!validated.changed) {
      new Notice(operationNotice(t, validated.code));
      return;
    }
    this.replaceTable(editor, current.table, validated.source);
    new Notice(t("notice.sheetsMigrated"));
  }

  private previewBasePromotion(
    editor: Editor,
    getInfo: BaseEditorInfo,
    expectedTable?: StructuralTable,
  ): void {
    if (this.transposeRequestsActive === false) return;
    const sourceFile = getInfo()?.file ?? null;
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
    if (this.blockUnsafeTableWrite(table)) return;
    try {
      const target = captureBaseEditorTarget(editor, getInfo);
      const service = this.basePromotionService;
      const prepared = service.prepare(table, sourceFile);
      const expandsStructure = table.structural;
      this.openOperationPreview((onClosed) => new BasePromotionModal(
        this.app,
        prepared,
        {
          language: t.locale ?? "en",
          title: t(expandsStructure ? "modal.promoteBase.structuralTitle" : "modal.promoteBase.title"),
          description: t(expandsStructure ? "modal.promoteBase.structuralDesc" : "modal.promoteBase.desc"),
          target: t("modal.promoteBase.target"),
          records: t("modal.promoteBase.records"),
          columns: t("modal.promoteBase.columns"),
          warning: (warning) => promotionWarningText(t, warning),
          blockingIssues: t("modal.promoteBase.blockingIssues"),
          blocker: (blocker) => promotionBlockerText(t, blocker),
          contentDifferences: t("modal.promoteBase.contentDifferences"),
          contentSummary: t("modal.promoteBase.contentSummary"),
          contentSource: t("modal.promoteBase.contentSource"),
          contentKind: (kind) => promotionContentKindText(t, kind),
          contentHeaderTarget: t("modal.promoteBase.contentHeaderTarget"),
          contentRecordTarget: t("modal.promoteBase.contentRecordTarget"),
          recordPreviews: t("modal.promoteBase.recordPreviews"),
          acceptContentDifferences: t("modal.promoteBase.acceptContentDifferences"),
          cancel: t("modal.cancel"),
          confirm: t("modal.promoteBase.confirm"),
        },
        async (acceptance?: BasePromotionContentAcceptance) => {
          await service.execute(editor, table, prepared, target, acceptance);
          new Notice(t("notice.promoted").replace("{path}", displayPathText(prepared.manifestPath, t.locale)), 8000);
        },
        (error) => new Notice(t("notice.promoteFailed").replace("{message}", errorMessage(error)), 8000),
        onClosed,
      ));
    } catch (error) {
      new Notice(t("notice.promoteFailed").replace("{message}", errorMessage(error)), 8000);
    }
  }

  private async previewPromotedTableRestore(editor: Editor, getInfo: BaseEditorInfo): Promise<void> {
    if (this.transposeRequestsActive === false) return;
    const sourceFile = getInfo()?.file ?? null;
    const service = this.basePromotionService;
    const t = createTranslator(this.settings.language);
    const offset = editor.posToOffset(editor.getCursor());
    const metadata = promotionBlockAt(editor.getValue(), offset, sourceFile?.path);
    if (metadata === null || service === null) {
      new Notice(t("notice.noPromotedBase"));
      return;
    }
    try {
      const target = captureBaseEditorTarget(editor, getInfo);
      const source = await service.restorationSource(metadata);
      service.assertActive();
      target.assertCurrent();
      this.openOperationPreview((onClose) => new ConversionPreviewModal(this.app, {
        language: t.locale ?? "en",
        title: t("modal.restoreBase.title"),
        description: t("modal.restoreBase.desc"),
        source,
        cancelLabel: t("modal.cancel"),
        confirmLabel: t("modal.restoreBase.confirm"),
        onClose,
        onConfirm: () => {
          void service.restore(editor, metadata, target, source)
            .then(() => new Notice(t("notice.restored"), 8000))
            .catch((error: unknown) => new Notice(
              t("notice.restoreFailed").replace("{message}", errorMessage(error)),
              8000,
            ));
        },
      }));
    } catch (error) {
      new Notice(t("notice.restoreFailed").replace("{message}", errorMessage(error)), 8000);
    }
  }

  private async previewBasePropertyMigration(): Promise<void> {
    if (this.transposeRequestsActive === false) return;
    const service = this.basePropertyMigrationService;
    const t = createTranslator(this.settings.language);
    if (service === null) return;
    try {
      const prepared = await service.prepare();
      service.assertActive();
      if (
        prepared.membershipNoteCount === 0
        && prepared.legacyBaseCount === 0
        && prepared.legacyRecordIdCount === 0
      ) {
        new Notice(t("notice.noBasePropertiesToMigrate"));
        return;
      }
      this.openOperationPreview((onClosed) => new BasePropertyMigrationModal(
        this.app,
        prepared,
        {
          language: t.locale ?? "en",
          title: t("modal.migrateBaseProperties.title"),
          description: t("modal.migrateBaseProperties.desc"),
          membershipNotes: t("modal.migrateBaseProperties.membershipNotes"),
          promotedBases: t("modal.migrateBaseProperties.promotedBases"),
          retiredRecordIdCandidates: t("modal.migrateBaseProperties.retiredRecordIdCandidates"),
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
        onClosed,
      ));
    } catch (error) {
      new Notice(
        t("notice.basePropertyMigrationFailed").replace("{message}", errorMessage(error)),
        8000,
      );
    }
  }

  private openOperationPreview(create: (onClose: () => void) => Modal): void {
    if (this.transposeRequestsActive === false) return;
    const previews = this.operationPreviews ??= new Set<Modal>();
    const modal = create(() => previews.delete(modal));
    previews.add(modal);
    modal.open();
  }

  private async createPromotedBaseRecord(editor: Editor, sourceFile: TFile | null): Promise<void> {
    if (this.transposeRequestsActive === false) return;
    const t = createTranslator(this.settings.language);
    const service = this.basePromotionService;
    if (sourceFile === null || service === null) {
      new Notice(t("notice.noFile"));
      return;
    }
    const metadata = promotionBlockAt(editor.getValue(), editor.posToOffset(editor.getCursor()), sourceFile.path);
    if (metadata === null) {
      new Notice(t("notice.noPromotedBase"));
      return;
    }
    try {
      const created = await service.createRecord(sourceFile, metadata);
      new Notice(t("notice.recordCreated").replace("{path}", displayPathText(created.path, t.locale)));
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
    const verified = validateTableOperationInDocument(editor.getValue(), table, result);
    if (verified.changed) this.replaceTable(editor, table, verified.source);
    new Notice(operationNotice(createTranslator(this.settings.language), verified.code));
  }


  private noTable(): void {
    new Notice(createTranslator(this.settings.language)("notice.noTable"));
  }
}
