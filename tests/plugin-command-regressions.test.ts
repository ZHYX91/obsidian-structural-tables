// @vitest-environment happy-dom

import type { App, Command, Editor, TFile } from "obsidian";
import { MarkdownRenderer, Platform } from "obsidian";
import MarkdownIt from "markdown-it";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { BasePromotionService } from "../src/app/base-promotion-service";
import { StructuralTablesPlugin } from "../src/app/plugin";
import { ConversionPreviewModal } from "../src/app/conversion-preview-modal";
import { createTranslator } from "../src/config/i18n";
import { DEFAULT_SETTINGS, type StructuralTablesSettings } from "../src/config/settings";
import { MarkdownView, Menu, TFile as MockTFile, notices } from "./mocks/obsidian";

import { tableCommandEditor } from "./helpers/table-command-editor";
import { undo, redo } from "@codemirror/commands";

const SOURCE = "| A | B | < |\n| --- | --- | --- |\n| x | y | z |";

interface EditorHarness {
  editor: Editor;
  source: () => string;
  setSource: (value: string) => void;
  replaceRange: ReturnType<typeof vi.fn>;
}

function editorHarness(initial = SOURCE): EditorHarness {
  let source = initial;
  const lines = () => source.split(/\r\n|\r|\n/u);
  const posToOffset = ({ line, ch }: { line: number; ch: number }): number => {
    let offset = 0;
    for (let index = 0; index < line; index += 1) offset += (lines()[index]?.length ?? 0) + 1;
    return offset + ch;
  };
  const offsetToPos = (offset: number): { line: number; ch: number } => {
    let remaining = offset;
    for (const [line, text] of lines().entries()) {
      if (remaining <= text.length) return { line, ch: remaining };
      remaining -= text.length + 1;
    }
    const last = lines().length - 1;
    return { line: last, ch: lines()[last]?.length ?? 0 };
  };
  const replaceRange = vi.fn((insert: string, from: { line: number; ch: number }, to: { line: number; ch: number }) => {
    const start = posToOffset(from);
    const end = posToOffset(to);
    source = source.slice(0, start) + insert + source.slice(end);
  });
  const editor = {
    getValue: () => source,
    getCursor: () => ({ line: 0, ch: 2 }),
    getLine: (line: number) => lines()[line] ?? "",
    posToOffset,
    offsetToPos,
    replaceRange,
    setCursor: vi.fn(),
  } as unknown as Editor;
  return { editor, source: () => source, setSource: (value) => { source = value; }, replaceRange };
}

function pluginHarness(editor: Editor, sourceFile: MockTFile) {
  let open = true;
  let currentViewFile: MockTFile | null = sourceFile;
  let vaultFile: MockTFile | null = sourceFile;
  const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
    editor,
    file: sourceFile,
  });
  const app = {
    vault: {
      getFileByPath: (path: string) => vaultFile?.path === path ? vaultFile : null,
    },
    workspace: {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => {
        if (!open || currentViewFile === null) return;
        view.file = currentViewFile as unknown as TFile;
        callback({ view });
      },
    },
  } as unknown as App;
  const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
    app,
    settings: { ...DEFAULT_SETTINGS, language: "en" },
  });
  return {
    plugin: plugin as unknown as {
      formatCurrent: (editor: Editor, sourceFile: TFile | null) => void;
      previewPlainGfmConversion: (editor: Editor, sourceFile: TFile | null) => void;
      previewMarkdownAsHtml: (editor: Editor, sourceFile: TFile | null) => void;
      previewHtmlAsMarkdown: (editor: Editor, sourceFile: TFile | null) => void;
      copyCurrentTable: (editor: Editor, format: "HTML" | "GFM", sourcePath?: string) => void;
      settings: StructuralTablesSettings;
      migrateSheetsExtended: (editor: Editor) => void;
    },
    setViewFile: (file: MockTFile | null) => { currentViewFile = file; },
    setVaultFile: (file: MockTFile | null) => { vaultFile = file; },
    close: () => { open = false; },
  };
}

function capturePreview() {
  const opened: ConversionPreviewModal[] = [];
  vi.spyOn(ConversionPreviewModal.prototype, "open").mockImplementation(function (this: ConversionPreviewModal) {
    opened.push(this);
  });
  return () => {
    const modal = opened[opened.length - 1];
    if (modal === undefined) throw new Error("Expected a conversion preview.");
    return (modal as unknown as { options: { source: string; onConfirm: () => void } }).options;
  };
}

beforeAll(() => {
  HTMLElement.prototype.setCssStyles = function setCssStyles(styles: Partial<CSSStyleDeclaration>): void {
    Object.assign(this.style, styles);
  };
});

beforeEach(() => {
  notices.splice(0);
  vi.restoreAllMocks();
});

afterEach(() => {
  Platform.isMobileApp = false;
  vi.unstubAllGlobals();
});

describe("whole-table HTML command notices", () => {
  it.each(["zh-TW", "ja", "de", "es", "ar"] as const)("localizes invalid-table command diagnostics in %s without writes", (language) => {
    const source = "| A | B |\n| --- || --- |\n| x | < |";
    const editor = editorHarness(source);
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);
    harness.plugin.settings.language = language;
    for (const run of [
      () => harness.plugin.formatCurrent(editor.editor, file as unknown as TFile),
      () => harness.plugin.previewPlainGfmConversion(editor.editor, file as unknown as TFile),
      () => harness.plugin.copyCurrentTable(editor.editor, "HTML"),
    ]) {
      notices.length = 0;
      run();
      expect(notices).toEqual([createTranslator(language)("diagnostic.mergeBoundary")]);
      expect(editor.replaceRange).not.toHaveBeenCalled();
      expect(editor.source()).toBe(source);
    }
  });

  it.each(["en", "zh-CN"] as const)("reports flattened plain text on mobile in %s", async (language) => {
    const editor = editorHarness();
    const harness = pluginHarness(editor.editor, new MockTFile("A.md"));
    harness.plugin.settings.language = language;
    Platform.isMobileApp = true;
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => { element.textContent = text; });
    const write = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });

    harness.plugin.copyCurrentTable(editor.editor, "HTML", "A.md");
    await vi.waitFor(() => expect(notices).toContain(createTranslator(language)("notice.copiedHtmlPlain")));
    expect(writeText).toHaveBeenCalledExactlyOnceWith("A\tB\tB\nx\ty\tz");
    expect(write).not.toHaveBeenCalled();
    expect(notices).not.toContain(createTranslator(language)("notice.copied").replace("{format}", "HTML"));
    expect(editor.source()).toBe(SOURCE);
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it.each(["html", "plain", "failure"])("reports the actual desktop result: %s", async (mode) => {
    const editor = editorHarness();
    const harness = pluginHarness(editor.editor, new MockTFile("A.md"));
    vi.spyOn(MarkdownRenderer, "render").mockImplementation(async (_app, text, element) => { element.textContent = text; });
    class CopyItem { constructor(readonly data: Record<string, Blob>) {} }
    const write = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    if (mode === "failure") write.mockRejectedValueOnce(new Error("denied"));
    vi.stubGlobal("ClipboardItem", mode === "plain" ? undefined : CopyItem);
    vi.stubGlobal("navigator", { clipboard: { write, writeText } });

    harness.plugin.copyCurrentTable(editor.editor, "HTML", "A.md");
    const expected = mode === "html" ? "Table copied as HTML."
      : createTranslator("en")(mode === "plain" ? "notice.copiedHtmlPlain" : "notice.clipboardFailed");
    await vi.waitFor(() => expect(notices).toEqual([expected]));
    expect(writeText).toHaveBeenCalledTimes(mode === "plain" ? 1 : 0);
    expect(editor.source()).toBe(SOURCE);
  });
});

describe("registered conversion command entry", () => {
  it("keeps oversized HTML and the real editor selection unchanged without a preview", () => {
    const html = '<table><tbody><tr><td rowspan="40" colspan="1000">value</td></tr>'
      + "<tr></tr>".repeat(39) + "</tbody></table>";
    const source = html + "\n\nAfter";
    const f = tableCommandEditor(source);
    try {
      const commands: Array<{ id: string; editorCallback?: (editor: Editor, context: { file: TFile | null }) => void }> = [];
      const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
        app: f.app,
        settings: { ...DEFAULT_SETTINGS, language: "en" },
        localizedCommands: [],
        addCommand: (command: typeof commands[number]) => { commands.push(command); return command; },
      }) as unknown as { registerCommands: () => void };
      plugin.registerCommands();
      f.cm.dispatch({ selection: { anchor: html.indexOf("value"), head: html.indexOf("value") + 5 } });
      const selection = f.cm.state.selection;
      const opened = vi.spyOn(ConversionPreviewModal.prototype, "open");

      const command = commands.find(({ id }) => id === "convert-current-html-table-to-markdown");
      expect(command?.editorCallback).toBeDefined();
      command!.editorCallback!(f.editor, { file: f.file as unknown as TFile });

      expect(opened).not.toHaveBeenCalled();
      expect(f.source()).toBe(source);
      expect(f.cm.state.selection.eq(selection)).toBe(true);
      expect(f.writes()).toBe(0);
      expect(undo(f.cm)).toBe(false);
      expect(notices).toEqual([createTranslator("en")("notice.htmlFormatUnsupported")]);
    } finally { f.destroy(); }
  });

  it("passes the current source file into both preview commands", () => {
    const formatCurrent = vi.fn();
    const previewPlainGfmConversion = vi.fn();
    const previewMarkdownAsHtml = vi.fn();
    const previewHtmlAsMarkdown = vi.fn();
    const commands: Array<{
      id: string;
      editorCallback?: (editor: Editor, context: { file: TFile | null }) => void;
    }> = [];
    const surface = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
      settings: { ...DEFAULT_SETTINGS, language: "en" },
      localizedCommands: [],
      formatCurrent,
      previewPlainGfmConversion,
      previewMarkdownAsHtml,
      previewHtmlAsMarkdown,
      addCommand: (command: typeof commands[number]) => {
        commands.push(command);
        return command;
      },
    }) as unknown as { registerCommands: () => void };
    surface.registerCommands();

    const editor = editorHarness().editor;
    const file = new MockTFile("A.md") as unknown as TFile;
    commands.find(({ id }) => id === "format-current-structural-table")?.editorCallback?.(editor, { file });
    commands.find(({ id }) => id === "convert-current-table-to-plain-gfm")?.editorCallback?.(editor, { file });
    commands.find(({ id }) => id === "convert-current-markdown-table-to-html")?.editorCallback?.(editor, { file });
    commands.find(({ id }) => id === "convert-current-html-table-to-markdown")?.editorCallback?.(editor, { file });

    expect(formatCurrent).toHaveBeenCalledWith(editor, file);
    expect(previewPlainGfmConversion).toHaveBeenCalledWith(editor, file);
    expect(previewMarkdownAsHtml).toHaveBeenCalledWith(editor, file);
    expect(previewHtmlAsMarkdown).toHaveBeenCalledWith(editor, file);
  });
});

describe("registered structural commands preserve protected blocks", () => {
  const table = "| H | < |\n| --- | --- |\n| a | b |";
  const real = "| REAL | < |\n| --- | --- |\n| keep | safe |";
  it.each([
    "[link]:\n  /url\n<span>\n" + table + "\n</span>",
    "[link]: /url\n  \"title\"\n<span>\n" + table + "\n</span>",
    "-\n    ```\n" + table.split("\n").map((line) => "  " + line).join("\n") + "\n  ```",
    "> text\n    > ```\n" + table.split("\n").map((line) => "> " + line).join("\n") + "\n> ```",
  ])("leaves literal content intact and still edits the adjacent real table: %s", (block) => {
    const source = block + "\n\n" + real;
    expect(new MarkdownIt({ html: true }).parse(source, {}).filter((token) => token.type === "table_open")).toHaveLength(1);
    const f = tableCommandEditor(source);
    try {
      const commands: Array<{ id: string; editorCallback?: (editor: Editor, context: { file: TFile | null }) => void }> = [];
      const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
        app: f.app, settings: { ...DEFAULT_SETTINGS, language: "en" }, localizedCommands: [],
        addCommand: (command: typeof commands[number]) => { commands.push(command); return command; },
      }) as unknown as { registerCommands: () => void };
      plugin.registerCommands();
      const split = commands.find(({ id }) => id === "split-current-merged-cell");
      expect(split?.editorCallback).toBeDefined();
      f.cm.dispatch({ selection: { anchor: source.indexOf("| H") + 2 } });
      const selection = f.cm.state.selection;

      split!.editorCallback!(f.editor, { file: f.file as unknown as TFile });

      expect(f.source()).toBe(source);
      expect(f.cm.state.selection.eq(selection)).toBe(true);
      expect(f.writes()).toBe(0);
      expect(undo(f.cm)).toBe(false);
      expect(notices).toEqual([createTranslator("en")("notice.noTable")]);

      f.cm.dispatch({ selection: { anchor: source.indexOf("| REAL") + 2 } });
      split!.editorCallback!(f.editor, { file: f.file as unknown as TFile });
      expect(f.writes()).toBe(1);
      expect(f.source().slice(0, block.length + 2)).toBe(block + "\n\n");
      expect(f.source()).not.toBe(source);
      expect(undo(f.cm)).toBe(true);
      expect(f.source()).toBe(source);
      expect(undo(f.cm)).toBe(false);
    } finally { f.destroy(); }
  });
});

const localizedCommandKeys = [
  ["export-current-table-as-image", "command.exportImage"],
  ["transpose-current-table", "command.transpose"],
  ["insert-structural-table", "command.insert"],
  ["migrate-legacy-base-properties", "command.migrateBaseProperties"],
  ["promote-current-table-to-base", "command.promoteBase"],
  ["restore-current-promoted-base-to-table", "command.restorePromotedTable"],
  ["create-record-for-current-promoted-base", "command.createBaseRecord"],
  ["copy-current-table-as-html", "command.copyHtml"],
  ["copy-current-table-as-plain-gfm", "command.copyGfm"],
  ["copy-current-table-as-tsv", "command.copyTsv"],
  ["copy-current-table-as-csv", "command.copyCsv"],
  ["convert-current-table-to-plain-gfm", "command.convertGfm"],
  ["convert-current-markdown-table-to-html", "command.convertHtmlTable"],
  ["convert-current-html-table-to-markdown", "command.convertMarkdownTable"],
  ["convert-current-sheets-extended-table", "command.migrateSheets"],
  ["format-current-structural-table", "command.format"],
  ["merge-current-cell-left", "command.mergeLeft"],
  ["merge-current-cell-up", "command.mergeUp"],
  ["split-current-merged-cell", "command.split"],
  ["validate-current-note", "command.validate"],
  ["recover-cell-drafts", "command.recoverDrafts"],
] as const;

describe("live command localization", () => {
  it("refreshes every host-prefixed registered command zh -> en -> zh without re-registering", async () => {
    const registry = new Map<string, Command>();
    const addCommand = vi.fn((input: Command): Command => {
      // Match Obsidian's public addCommand contract closely: the registered
      // command is returned with plugin-prefixed id/name. Clone the input so
      // this test does not rely on the old pass-through mock identity.
      const registered = {
        ...input,
        id: `structural-tables:${input.id}`,
        name: `Structural Tables: ${input.name}`,
      };
      registry.set(registered.id, registered);
      return registered;
    });
    const save = vi.fn(async () => undefined);
    const refresh = vi.fn();
    const settingsPersistence = {
      assertWritable: vi.fn(),
      save,
    };
    const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
      manifest: { id: "structural-tables", name: "Structural Tables", version: "0.5.1" },
      app: {
        workspace: {
          iterateAllLeaves: vi.fn(),
        },
      } as unknown as App,
      settings: { ...DEFAULT_SETTINGS, language: "zh-CN" },
      settingsPersistence,
      editorController: { refresh },
      localizedCommands: [],
      addCommand,
    });
    const surface = plugin as unknown as {
      registerCommands: () => void;
      localizedCommands: Command[];
      updateSettings: (update: Partial<StructuralTablesSettings>) => Promise<void>;
    };

    surface.registerCommands();
    const zh = createTranslator("zh-CN");
    surface.localizedCommands.push(addCommand({
      id: "recover-cell-drafts",
      name: zh("command.recoverDrafts"),
      callback: () => undefined,
    }));

    const expectedIds = localizedCommandKeys.map(([id]) => `structural-tables:${id}`);
    expect([...registry.keys()]).toEqual(expectedIds);
    expect(surface.localizedCommands).toHaveLength(localizedCommandKeys.length);
    expect(addCommand).toHaveBeenCalledTimes(localizedCommandKeys.length);

    const assertLanguage = (language: "en" | "zh-CN"): void => {
      const t = createTranslator(language);
      for (const [id, key] of localizedCommandKeys) {
        const command = registry.get(`structural-tables:${id}`);
        expect(command?.id).toBe(`structural-tables:${id}`);
        expect(command?.name).toBe(`Structural Tables: ${t(key)}`);
        expect(command?.name.match(/Structural Tables: /gu)).toHaveLength(1);
      }
    };

    assertLanguage("zh-CN");
    await surface.updateSettings({ language: "en" });
    assertLanguage("en");
    await surface.updateSettings({ language: "zh-CN" });
    assertLanguage("zh-CN");

    expect(addCommand).toHaveBeenCalledTimes(localizedCommandKeys.length);
    expect([...registry.keys()]).toEqual(expectedIds);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

// GFM ownership/Undo tests now exercise the real modal and CodeMirror in plain-gfm-modal.test.ts.
describe.each([
  [
    "format",
    (surface: ReturnType<typeof pluginHarness>["plugin"], editor: Editor, file: TFile) => surface.formatCurrent(editor, file),
    "Structural table formatted.",
  ],
] as const)("conversion preview target identity (%s)", (_name, openPreview, successNotice) => {
  it("confirms an unchanged table while the original editor and file identity remain current", () => {
    const editor = editorHarness();
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);
    const preview = capturePreview();
    openPreview(harness.plugin, editor.editor, file as unknown as TFile);
    const expectedSource = preview().source;

    preview().onConfirm();

    expect(editor.replaceRange).toHaveBeenCalledOnce();
    expect(editor.source()).toBe(expectedSource);
    expect(notices).toContain(successNotice);
    expect(notices).not.toContain("The table changed. Reopen the cell or menu and try again.");
  });
  it.each(["other-file", "same-path-replacement", "rename", "close"] as const)(
    "refuses confirmation after %s",
    (change) => {
      const editor = editorHarness();
      const fileA = new MockTFile("A.md");
      const harness = pluginHarness(editor.editor, fileA);
      const preview = capturePreview();
      openPreview(harness.plugin, editor.editor, fileA as unknown as TFile);
      const original = editor.source();

      if (change === "other-file") {
        const fileB = new MockTFile("B.md");
        harness.setViewFile(fileB);
        harness.setVaultFile(fileB);
      } else if (change === "same-path-replacement") {
        const replacement = new MockTFile("A.md");
        harness.setViewFile(replacement);
        harness.setVaultFile(replacement);
      } else if (change === "rename") {
        fileA.path = "Renamed.md";
      } else {
        harness.close();
      }

      preview().onConfirm();
      expect(editor.source()).toBe(original);
      expect(editor.replaceRange).not.toHaveBeenCalled();
      expect(notices).toContain("The table changed. Reopen the cell or menu and try again.");
    },
  );

  it("refuses confirmation after the captured table changes", () => {
    const editor = editorHarness();
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);
    const preview = capturePreview();
    openPreview(harness.plugin, editor.editor, file as unknown as TFile);
    editor.setSource(editor.source().replace("| x | y | z |", "| changed | y | z |"));
    const changed = editor.source();

    preview().onConfirm();
    expect(editor.source()).toBe(changed);
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(notices).toContain("The table changed. Reopen the cell or menu and try again.");
  });
});

describe("GFM command boundaries", () => {
  it("copies a resolved reference from the invocation's note snapshot", async () => {
    const source = "| H | K |\n| --- || --- |\n| [Guide][`a|b`] | keep |\n\n[`a|b`]: old";
    const editor = editorHarness(source);
    const harness = pluginHarness(editor.editor, new MockTFile("A.md"));
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    harness.plugin.copyCurrentTable(editor.editor, "GFM");
    editor.setSource(source.replace(": old", ": new"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0]![0]).toContain("[Guide](<old>)");
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it.each([
    "$5",
    String.raw`$\lvert x\rvert$`,
    String.raw`$P(A\mid B)$`,
  ])("copies existing source containing %s", async (content) => {
    const source = `| Label | Amount |\n| --- | --- |\n| A | ${content} |`;
    const editor = editorHarness(source);
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

    harness.plugin.copyCurrentTable(editor.editor, "GFM");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0]?.[0]).toContain(content);
    expect(notices).toContain("Table copied as GFM.");
  });

  it("blocks formatting hidden GFM overflow while keeping quick copy non-destructive", async () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 | KEEP |";
    const editor = editorHarness(source);
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);
    const open = vi.spyOn(ConversionPreviewModal.prototype, "open");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

    harness.plugin.formatCurrent(editor.editor, file as unknown as TFile);

    expect(open).not.toHaveBeenCalled();
    expect(editor.source()).toBe(source);
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(notices.filter((notice) => notice.includes("extra source cells"))).toHaveLength(1);

    harness.plugin.copyCurrentTable(editor.editor, "GFM");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(editor.source()).toBe(source);
    expect(writeText.mock.calls[0]?.[0]).not.toContain("KEEP");
  });

  it("migrates a standalone Sheets Extended table without altering its boundaries", () => {
    const source = "| Person | - | Q1 |\n| --- | --- | --- |\n| Alice | - | 1 |";
    const editor = editorHarness(source);
    const harness = pluginHarness(editor.editor, new MockTFile("A.md"));

    harness.plugin.migrateSheetsExtended(editor.editor);

    expect(editor.replaceRange).toHaveBeenCalledOnce();
    expect(editor.source()).toContain("||");
    expect(notices).toContain(createTranslator("en")("notice.sheetsMigrated"));
  });

  it("refuses Sheets migration that would absorb a preceding pipe row", () => {
    const source = "| Note | Text |\n| Person | - | Q1 |\n| --- | --- | --- |\n| Alice | - | 1 |";
    const editor = editorHarness(source);
    vi.spyOn(editor.editor, "getCursor").mockReturnValue({ line: 1, ch: 4 });
    const harness = pluginHarness(editor.editor, new MockTFile("A.md"));

    harness.plugin.migrateSheetsExtended(editor.editor);

    expect(editor.source()).toBe(source);
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(notices).toContain(createTranslator("en")("operation.invalidResult"));
  });

  it("blocks Sheets migration when a hidden GFM overflow cell would be discarded", () => {
    const source = "| Person | - | Q1 |\n| --- | --- | --- |\n| Alice | - | 1 | KEEP |";
    const editor = editorHarness(source);
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);

    harness.plugin.migrateSheetsExtended(editor.editor);

    expect(editor.source()).toBe(source);
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(notices).toContain(
      "This GFM table has extra source cells that Obsidian does not render. Edit those extra cells in Markdown before using Structural Tables to write the table.",
    );
  });

  it("reports asynchronous clipboard failures", async () => {
    const editor = editorHarness();
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("clipboard denied"));

    harness.plugin.copyCurrentTable(editor.editor, "GFM");
    await vi.waitFor(() => expect(notices).toContain("Could not write to the clipboard."));
  });


});

describe("bidirectional in-note source conversion entry", () => {
  const cleanup: (() => void)[] = [];
  afterEach(() => { for (const close of cleanup.splice(0)) close(); });
  function fixture(source = SOURCE) {
    const f = tableCommandEditor(source);
    cleanup.push(f.destroy);
    const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
      app: f.app, settings: { ...DEFAULT_SETTINGS, language: "en" },
    }) as unknown as ReturnType<typeof pluginHarness>["plugin"];
    return { ...f, plugin };
  }
  const HTML = "<table><thead><tr><th>Item</th><th>Cost</th></tr></thead>"
    + "<tbody><tr><td>A</td><td>10</td></tr></tbody></table>";

  it.each(["html", "markdown"] as const)("isolates %s conversion from typing with complete Undo/Redo", (direction) => {
    const initial = (direction === "html" ? SOURCE : HTML) + "\n\nafter";
    const f = fixture(initial);
    f.cm.dispatch({ changes: { from: initial.length, insert: " typed" } });
    const before = f.source();
    const preview = capturePreview();
    if (direction === "html") f.plugin.previewMarkdownAsHtml(f.editor, f.file as unknown as TFile);
    else f.plugin.previewHtmlAsMarkdown(f.editor, f.file as unknown as TFile);
    const option = preview();
    expect(f.source()).toBe(before);
    expect(f.writes()).toBe(1);
    option.onConfirm();
    const converted = f.source();
    expect(converted).toBe(option.source + "\n\nafter typed");
    expect(f.writes()).toBe(2);
    f.cm.dispatch({ changes: { from: converted.length, insert: " later" } });
    expect(undo(f.cm)).toBe(true); expect(f.source()).toBe(converted);
    expect(undo(f.cm)).toBe(true); expect(f.source()).toBe(before);
    expect(undo(f.cm)).toBe(true); expect(f.source()).toBe(initial);
    expect(redo(f.cm)).toBe(true); expect(f.source()).toBe(before);
    expect(redo(f.cm)).toBe(true); expect(f.source()).toBe(converted);
  });

  it.each(["source", "file", "detach", "draft", "unload"] as const)("refuses a stale %s preview", (change) => {
    const f = fixture(HTML);
    const preview = capturePreview();
    f.plugin.previewHtmlAsMarkdown(f.editor, f.file as unknown as TFile);
    const option = preview();
    if (change === "source") f.cm.dispatch({ changes: { from: HTML.indexOf("10"), to: HTML.indexOf("10") + 2, insert: "20" } });
    if (change === "file") f.view.file = new MockTFile("B.md") as unknown as TFile;
    if (change === "detach") f.containerEl.remove();
    if (change === "draft") {
      const draft = f.containerEl.appendChild(document.createElement("textarea"));
      draft.className = "structural-tables-cell-editor";
    }
    if (change === "unload") (f.plugin as unknown as { transposeRequestsActive: boolean }).transposeRequestsActive = false;
    const before = f.source(); const writes = f.writes();
    option.onConfirm();
    expect(f.source()).toBe(before); expect(f.writes()).toBe(writes);
    expect(notices).toContain(createTranslator("en")("notice.staleTable"));
  });

  it("refuses unsupported Markdown without opening a destructive preview", () => {
    const source = "| Item | Value |\n| --- | --- |\n| [[Note]] | 2 |";
    const f = fixture(source);
    const opened = vi.spyOn(ConversionPreviewModal.prototype, "open");
    f.plugin.previewMarkdownAsHtml(f.editor, f.file as unknown as TFile);
    expect(opened).not.toHaveBeenCalled();
    expect(f.source()).toBe(source); expect(f.writes()).toBe(0);
    expect(notices).toContain(createTranslator("en")("notice.tableFormatUnsupported"));
  });
});


describe("source conversion menu target", () => {
  it.each(["html", "markdown"] as const)("keeps the %s conversion bound to the table at menu opening", (direction) => {
    const table = direction === "html" ? "| FIRST | V |\n| --- | --- |\n| A | B |"
      : "<table><tr><td>FIRST</td><td>V</td></tr></table>";
    const source = table + "\n\n" + table.replace("FIRST", "SECOND");
    const f = tableCommandEditor(source);
    f.editor.listSelections = () => [{ anchor: f.editor.getCursor(), head: f.editor.getCursor() }];
    let callback!: (menu: Menu, editor: Editor, view: MarkdownView) => void;
    vi.spyOn(f.app.workspace, "on").mockImplementation(((_event: string, handler: typeof callback) => {
      callback = handler; return {};
    }) as typeof f.app.workspace.on);
    const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
      app: f.app, settings: { ...DEFAULT_SETTINGS, language: "en" },
    }) as unknown as { registerEditorMenu: () => void };
    const previews = capturePreview();
    try {
      f.editor.setCursor(f.editor.offsetToPos(source.indexOf("FIRST")));
      plugin.registerEditorMenu();
      const menu = new Menu(); callback(menu, f.editor, f.view);
      f.editor.setCursor(f.editor.offsetToPos(source.indexOf("SECOND")));
      const title = createTranslator("en")(direction === "html" ? "menu.convertHtmlTable" : "menu.convertMarkdownTable");
      menu.items.find((item) => item.title === title)!.callback!();
      expect(previews().source).toContain("FIRST");
      expect(previews().source).not.toContain("SECOND");
      expect(f.source()).toBe(source); expect(f.writes()).toBe(0);
      previews().onConfirm();
      expect(f.source()).toContain(table.replace("FIRST", "SECOND"));
      expect(f.writes()).toBe(1);
    } finally { f.destroy(); }
  });
});

describe("promoted Base menu target", () => {
  it.each(["create", "restore", "create-error", "open-error", "switch-pane", "reuse-pane"] as const)("keeps %s bound to the Base where the menu opened", async (action) => {
    const base = (id: string) => [
      "```base",
      `# structural-tables-promotion: stb_${id}`,
      `# structural-tables-manifest: "Records/${id}/_promotion.json"`,
      `filters: 'list(note.structural_table_ids).contains("stb_${id}")'`,
      "```",
    ].join("\n");
    const table = (id: string) => `| Name |\n| --- |\n| ${id} |`;
    const source = base("first") + "\n\n" + base("second");
    const f = tableCommandEditor(source);
    const contents = new Map<string, string>();
    for (const id of ["first", "second"]) {
      const path = `Records/${id}/_promotion.json`;
      f.files.set(path, new MockTFile(path));
      contents.set(path, JSON.stringify({
        version: 2, pluginVersion: "0.11.5", tableId: `stb_${id}`, sourceFilePath: f.file.path,
        originalTableSource: table(id), replacementSource: base(id), records: [],
      }));
    }
    Object.assign(f.app.vault, {
      read: async (file: MockTFile) => contents.get(file.path),
      create: async (path: string, content: string) => {
        if (action === "create-error") throw new Error("Storage unavailable");
        contents.set(path, content);
        return new MockTFile(path);
      },
    });
    const openFile = vi.fn(async () => {
      if (action === "open-error") throw new Error("Pane unavailable");
    });
    let active = { view: f.view };
    Object.assign(f.app.workspace, {
      getLeaf: () => ({ openFile }), getMostRecentLeaf: () => active, getActiveFile: () => active.view.file,
    });
    let callback!: (menu: Menu, editor: Editor, view: MarkdownView) => void;
    vi.spyOn(f.app.workspace, "on").mockImplementation(((_event: string, handler: typeof callback) => {
      callback = handler;
      return {};
    }) as typeof f.app.workspace.on);
    const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
      app: f.app, settings: { ...DEFAULT_SETTINGS, language: "en" }, basePromotionService: new BasePromotionService(f.app),
    }) as unknown as { registerEditorMenu: () => void };
    const preview = capturePreview();
    try {
      f.editor.setCursor(f.editor.offsetToPos(source.indexOf("first")));
      plugin.registerEditorMenu();
      const menu = new Menu();
      callback(menu, f.editor, f.view);
      f.editor.setCursor(f.editor.offsetToPos(source.indexOf("second")));
      const title = createTranslator("en")(action === "restore" ? "menu.restorePromotedTable" : "menu.createBaseRecord");
      menu.items.find((item) => item.title === title)!.callback!();
      if (action === "switch-pane") active = { view: new MarkdownView() as typeof f.view };
      if (action === "reuse-pane") Object.assign(active.view, { file: new MockTFile("Notes/other.md") });
      if (action === "restore") {
        await vi.waitFor(() => expect(preview().source).toBe(table("first")));
        preview().onConfirm();
        await vi.waitFor(() => expect(f.source()).toBe(table("first") + "\n\n" + base("second")));
        expect(f.writes()).toBe(1);
      } else if (action === "create-error") {
        await vi.waitFor(() => expect(notices).toContain("Could not create the Base record: Storage unavailable"));
        expect([...contents.keys()].filter(path => path.endsWith(".md"))).toEqual([]);
        expect(openFile).not.toHaveBeenCalled();
      } else {
        const path = "Notes/_structural-table-records/stb_first/Record.md";
        const switched = action === "switch-pane" || action === "reuse-pane";
        if (action === "open-error" || switched) {
          await vi.waitFor(() => expect(notices).toContain("Base record saved. Open it from the file explorer: " + path));
        }
        await vi.waitFor(() => expect(contents.get("Notes/_structural-table-records/stb_first/Record.md")).toContain("stb_first"));
        expect([...contents.keys()].filter(key => key.endsWith(".md"))).toEqual([path]);
        expect(openFile).toHaveBeenCalledTimes(switched ? 0 : 1);
        expect(f.writes()).toBe(0);
      }
    } finally { f.destroy(); }
  });
});
