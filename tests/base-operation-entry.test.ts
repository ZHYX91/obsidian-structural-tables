// @vitest-environment happy-dom

import type { App, Command, Editor, MarkdownFileInfo, TAbstractFile, TFile } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BasePromotionModal } from "../src/app/base-promotion-modal";
import { BasePromotionService, type BasePromotionContentAcceptance } from "../src/app/base-promotion-service";
import { BasePropertyMigrationModal } from "../src/app/base-property-migration-modal";
import { BasePropertyMigrationService } from "../src/app/base-property-migration-service";
import { ConversionPreviewModal } from "../src/app/conversion-preview-modal";
import { StructuralTablesPlugin } from "../src/app/plugin";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { TFile as MockFile, TFolder, notices } from "./mocks/obsidian";

const SOURCE = "| Name | Status |\n| --- | --- |\n| Alice | Doing |";

function fixture() {
  let source = SOURCE;
  const file = new MockFile("People.md") as unknown as TFile;
  const files = new Map<string, TAbstractFile>([[file.path, file]]);
  const contents = new Map([[file.path, SOURCE]]);
  const editor = {
    getValue: () => source,
    getLine: (line: number) => source.split("\n")[line] ?? "",
    getCursor: () => ({ line: 0, ch: 1 }),
    posToOffset: () => 1,
    offsetToPos: (offset: number) => ({ line: 0, ch: offset }),
    setCursor: () => {},
    replaceRange: vi.fn((value: string) => { source = value; }),
  } as unknown as Editor;
  const create = vi.fn(async (path: string, content: string) => {
    const created = new MockFile(path) as unknown as TFile;
    files.set(path, created); contents.set(path, content);
    return created;
  });
  const app = {
    internalPlugins: { getPluginById: () => ({ enabled: true }) },
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getFileByPath: (path: string) => files.get(path) ?? null,
      getMarkdownFiles: () => [file],
      read: vi.fn(async (target: TFile) => contents.get(target.path) ?? ""),
      create,
      createFolder: vi.fn(async (path: string) => {
        const folder = new TFolder(path) as unknown as TAbstractFile;
        files.set(path, folder); return folder;
      }),
    },
    metadataCache: { getFileCache: () => null },
    workspace: { iterateAllLeaves: () => {} },
  } as unknown as App;
  const promotion = new BasePromotionService(app);
  const migration = new BasePropertyMigrationService(app);
  const commands: Command[] = [];
  const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
    app, settings: { ...DEFAULT_SETTINGS, language: "en" }, transposeRequestsActive: true, runtimeEpoch: {},
    basePromotionService: promotion, basePropertyMigrationService: migration, localizedCommands: [],
    addCommand: (command: Command) => { commands.push(command); return command; },
  }) as unknown as { registerCommands: () => void; onunload: () => void };
  plugin.registerCommands();
  const info = { editor, file } as MarkdownFileInfo;
  return { app, file, files, contents, editor, promotion, migration, plugin, create, commands,
    setSource: (value: string) => { source = value; },
    command: (id: string) => commands.find((command) => command.id === id)!, info };
}

beforeAll(() => {
  HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); notices.length = 0; document.body.replaceChildren(); });

describe("Base command instance ownership", () => {
  it("closes the promotion preview on unload and rejects its captured confirmation", async () => {
    vi.stubGlobal("activeWindow", { crypto: { randomUUID: () => "10000000-0000-4000-8000-000000000001" } });
    const f = fixture();
    const open = vi.spyOn(BasePromotionModal.prototype, "open").mockImplementation(() => {});
    const close = vi.spyOn(BasePromotionModal.prototype, "close");
    const command = f.command("promote-current-table-to-base");
    command.editorCallback!(f.editor, f.info);
    expect(open).toHaveBeenCalledOnce();
    const preview = open.mock.instances[0]!;
    f.plugin.onunload();
    expect(close).toHaveBeenCalledOnce();
    await expect((preview as unknown as { onConfirm: (acceptance?: BasePromotionContentAcceptance) => Promise<void> }).onConfirm())
      .rejects.toThrow("unloaded");
    command.editorCallback!(f.editor, f.info);
    expect(open).toHaveBeenCalledOnce();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.editor.getValue()).toBe(SOURCE);
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
  });

  it("does not open a restore preview when unload happens during its manifest read", async () => {
    vi.stubGlobal("activeWindow", { crypto: { randomUUID: () => "10000000-0000-4000-8000-000000000002" } });
    const f = fixture();
    const table = parseEditableTables(SOURCE).tables[0]!;
    const prepared = f.promotion.prepare(table, f.file);
    f.contents.set(prepared.manifestPath, prepared.manifestContent);
    f.files.set(prepared.manifestPath, new MockFile(prepared.manifestPath) as unknown as TFile);
    f.setSource(prepared.replacementSource);
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    const read = vi.spyOn(f.app.vault, "read").mockImplementation(async () => { await pending; return prepared.manifestContent; });
    const open = vi.spyOn(ConversionPreviewModal.prototype, "open");
    f.command("restore-current-promoted-base-to-table").editorCallback!(f.editor, f.info);
    expect(read).toHaveBeenCalledOnce();
    f.plugin.onunload(); resume();
    await vi.waitFor(() => expect(notices.some((notice) => notice.includes("unloaded"))).toBe(true));
    expect(open).not.toHaveBeenCalled();
    expect(f.editor.getValue()).toBe(prepared.replacementSource);
    expect(f.create).not.toHaveBeenCalled();
  });

  it("does not open a migration preview after an old preparation completes", async () => {
    const f = fixture();
    let resume!: () => void;
    const pending = new Promise<void>((resolve) => { resume = resolve; });
    vi.spyOn(f.migration, "prepare").mockImplementation(async () => {
      await pending;
      return { files: [], membershipNoteCount: 1, legacyBaseCount: 0, legacyRecordIdCount: 0 };
    });
    const open = vi.spyOn(BasePropertyMigrationModal.prototype, "open");
    f.command("migrate-legacy-base-properties").callback!();
    f.plugin.onunload(); resume();
    await vi.waitFor(() => expect(notices.some((notice) => notice.includes("unloaded"))).toBe(true));
    expect(open).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.editor.getValue()).toBe(SOURCE);
  });

  it("closes migration previews and rejects old confirmation after unload", async () => {
    const f = fixture();
    vi.spyOn(f.migration, "prepare").mockResolvedValue({ files: [], membershipNoteCount: 1, legacyBaseCount: 0, legacyRecordIdCount: 0 });
    const open = vi.spyOn(BasePropertyMigrationModal.prototype, "open").mockImplementation(() => {});
    const close = vi.spyOn(BasePropertyMigrationModal.prototype, "close");
    f.command("migrate-legacy-base-properties").callback!();
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const preview = open.mock.instances[0]!;
    f.plugin.onunload();
    expect(close).toHaveBeenCalledOnce();
    await expect((preview as unknown as { onConfirm: (remove: boolean) => Promise<void> }).onConfirm(false)).rejects.toThrow("unloaded");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.editor.getValue()).toBe(SOURCE);
  });

  it("closes restoration previews and prevents old confirmation or new-record callbacks from writing", async () => {
    vi.stubGlobal("activeWindow", { crypto: { randomUUID: () => "10000000-0000-4000-8000-000000000003" } });
    const f = fixture();
    const prepared = f.promotion.prepare(parseEditableTables(SOURCE).tables[0]!, f.file);
    f.contents.set(prepared.manifestPath, prepared.manifestContent);
    f.files.set(prepared.manifestPath, new MockFile(prepared.manifestPath) as unknown as TFile);
    f.setSource(prepared.replacementSource);
    const open = vi.spyOn(ConversionPreviewModal.prototype, "open").mockImplementation(() => {});
    const close = vi.spyOn(ConversionPreviewModal.prototype, "close");
    f.command("restore-current-promoted-base-to-table").editorCallback!(f.editor, f.info);
    await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
    const preview = open.mock.instances[0]!;
    f.plugin.onunload();
    expect(close).toHaveBeenCalledOnce();
    (preview as unknown as { options: { onConfirm: () => void } }).options.onConfirm();
    f.command("create-record-for-current-promoted-base").editorCallback!(f.editor, f.info);
    await vi.waitFor(() => expect(notices.some((notice) => notice.includes("unloaded"))).toBe(true));
    expect(f.create).not.toHaveBeenCalled();
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
    expect(f.editor.getValue()).toBe(prepared.replacementSource);
  });
  it("does not let an old promotion command borrow a replacement runtime", () => {
    vi.stubGlobal("activeWindow", { crypto: { randomUUID: () => "10000000-0000-4000-8000-000000000004" } });
    const f = fixture();
    const oldCommand = f.command("promote-current-table-to-base");
    const open = vi.spyOn(BasePromotionModal.prototype, "open").mockImplementation(() => {});
    f.plugin.onunload();
    const replacement = new BasePromotionService(f.app);
    const prepare = vi.spyOn(replacement, "prepare");
    Object.assign(f.plugin, { runtimeEpoch: {}, transposeRequestsActive: true, basePromotionService: replacement });
    oldCommand.editorCallback!(f.editor, f.info);
    expect(prepare).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    f.plugin.registerCommands();
    const newCommand = [...f.commands].reverse().find((command) => command.id === oldCommand.id)!;
    newCommand.editorCallback!(f.editor, f.info);
    expect(prepare).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.editor.getValue()).toBe(SOURCE);
    f.plugin.onunload();
  });

  it("keeps old restore, record and migration commands inactive when services are replaced", async () => {
    vi.stubGlobal("activeWindow", { crypto: { randomUUID: () => "10000000-0000-4000-8000-000000000005" } });
    const f = fixture();
    const prepared = f.promotion.prepare(parseEditableTables(SOURCE).tables[0]!, f.file);
    f.setSource(prepared.replacementSource);
    const oldRestore = f.command("restore-current-promoted-base-to-table");
    const oldRecord = f.command("create-record-for-current-promoted-base");
    const oldMigration = f.command("migrate-legacy-base-properties");
    f.plugin.onunload();
    const promotion = new BasePromotionService(f.app);
    const migration = new BasePropertyMigrationService(f.app);
    const restoration = vi.spyOn(promotion, "restorationSource").mockResolvedValue(SOURCE);
    const record = vi.spyOn(promotion, "createRecord").mockResolvedValue(f.file);
    const prepare = vi.spyOn(migration, "prepare").mockResolvedValue({ files: [], membershipNoteCount: 1, legacyBaseCount: 0, legacyRecordIdCount: 0 });
    const restorePreview = vi.spyOn(ConversionPreviewModal.prototype, "open").mockImplementation(() => {});
    const migrationPreview = vi.spyOn(BasePropertyMigrationModal.prototype, "open").mockImplementation(() => {});
    Object.assign(f.plugin, {
      runtimeEpoch: {}, transposeRequestsActive: true,
      basePromotionService: promotion, basePropertyMigrationService: migration,
    });
    oldRestore.editorCallback!(f.editor, f.info);
    oldRecord.editorCallback!(f.editor, f.info);
    oldMigration.callback!();
    await Promise.resolve();
    expect(restoration).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(restorePreview).not.toHaveBeenCalled();
    expect(migrationPreview).not.toHaveBeenCalled();
    f.plugin.registerCommands();
    const current = (id: string) => [...f.commands].reverse().find((command) => command.id === id)!;
    current(oldRestore.id).editorCallback!(f.editor, f.info);
    current(oldRecord.id).editorCallback!(f.editor, f.info);
    current(oldMigration.id).callback!();
    await vi.waitFor(() => expect(migrationPreview).toHaveBeenCalledOnce());
    expect(restoration).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(restorePreview).toHaveBeenCalledOnce();
    expect(f.create).not.toHaveBeenCalled();
    expect(f.editor.replaceRange).not.toHaveBeenCalled();
    f.plugin.onunload();
  });

  it.each([false, true])("does not install an obsolete runtime after delayed loadData (reload=%s)", async (reload) => {
    const f = fixture();
    const resolvers: Array<(value: unknown) => void> = [];
    const loadData = vi.fn(() => new Promise<unknown>((resolve) => { resolvers.push(resolve); }));
    const saveData = vi.fn(async () => {});
    const install = vi.fn();
    Object.assign(f.plugin, { loadData, saveData, registerEditorExtension: install });
    const plugin = f.plugin as unknown as StructuralTablesPlugin;
    const originalService = (plugin as unknown as { basePromotionService: BasePromotionService }).basePromotionService;
    const oldLoad = plugin.onload();
    expect(loadData).toHaveBeenCalledOnce();
    plugin.onunload();
    const newLoad = reload ? plugin.onload() : null;
    resolvers[0]!(null);
    await oldLoad;
    expect(install).not.toHaveBeenCalled();
    expect(saveData).not.toHaveBeenCalled();
    expect((plugin as unknown as { basePromotionService: BasePromotionService }).basePromotionService).toBe(originalService);
    if (newLoad !== null) {
      expect(loadData).toHaveBeenCalledTimes(2);
      plugin.onunload();
      resolvers[1]!(null);
      await newLoad;
      expect(install).not.toHaveBeenCalled();
      expect(saveData).not.toHaveBeenCalled();
    }
  });

});
