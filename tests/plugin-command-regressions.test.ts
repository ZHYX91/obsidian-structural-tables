// @vitest-environment happy-dom

import type { App, Editor, TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StructuralTablesPlugin } from "../src/app/plugin";
import { ConversionPreviewModal } from "../src/app/conversion-preview-modal";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { MarkdownView, TFile as MockTFile, notices } from "./mocks/obsidian";

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
      copyCurrentTable: (editor: Editor, format: "GFM", sourcePath?: string) => void;
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

beforeEach(() => {
  notices.splice(0);
  vi.restoreAllMocks();
});

describe("registered conversion command entry", () => {
  it("passes the current source file into both preview commands", () => {
    const formatCurrent = vi.fn();
    const previewPlainGfmConversion = vi.fn();
    const commands: Array<{
      id: string;
      editorCallback?: (editor: Editor, context: { file: TFile | null }) => void;
    }> = [];
    const surface = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
      settings: { ...DEFAULT_SETTINGS, language: "en" },
      localizedCommands: [],
      formatCurrent,
      previewPlainGfmConversion,
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

    expect(formatCurrent).toHaveBeenCalledWith(editor, file);
    expect(previewPlainGfmConversion).toHaveBeenCalledWith(editor, file);
  });
});

describe.each([
  [
    "format",
    (surface: ReturnType<typeof pluginHarness>["plugin"], editor: Editor, file: TFile) => surface.formatCurrent(editor, file),
    "Structural table formatted.",
  ],
  [
    "GFM",
    (surface: ReturnType<typeof pluginHarness>["plugin"], editor: Editor, file: TFile) => surface.previewPlainGfmConversion(editor, file),
    "Table converted to plain GFM.",
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
  it.each([
    "$5",
    String.raw`$\lvert x\rvert$`,
    String.raw`$P(A\mid B)$`,
  ])("opens and copies existing source containing %s", async (content) => {
    const source = `| Label | Amount |\n| --- | --- |\n| A | ${content} |`;
    const editor = editorHarness(source);
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);
    const preview = capturePreview();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

    harness.plugin.previewPlainGfmConversion(editor.editor, file as unknown as TFile);
    expect(preview().source).toContain(content);
    expect(notices).toEqual([]);

    harness.plugin.copyCurrentTable(editor.editor, "GFM");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0]?.[0]).toContain(content);
    expect(notices).toContain("Table copied as GFM.");
  });

  it("blocks destructive rewrites with hidden GFM overflow while keeping copy non-destructive", async () => {
    const source = "| A | B |\n| --- | --- |\n| 1 | 2 | KEEP |";
    const editor = editorHarness(source);
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);
    const open = vi.spyOn(ConversionPreviewModal.prototype, "open");
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();

    harness.plugin.formatCurrent(editor.editor, file as unknown as TFile);
    harness.plugin.previewPlainGfmConversion(editor.editor, file as unknown as TFile);

    expect(open).not.toHaveBeenCalled();
    expect(editor.source()).toBe(source);
    expect(editor.replaceRange).not.toHaveBeenCalled();
    expect(notices.filter((notice) => notice.includes("extra source cells"))).toHaveLength(2);

    harness.plugin.copyCurrentTable(editor.editor, "GFM");
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(editor.source()).toBe(source);
    expect(writeText.mock.calls[0]?.[0]).not.toContain("KEEP");
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

  it("reports a synchronous failure while confirming GFM replacement", () => {
    const editor = editorHarness();
    const file = new MockTFile("A.md");
    const harness = pluginHarness(editor.editor, file);
    const preview = capturePreview();
    harness.plugin.previewPlainGfmConversion(editor.editor, file as unknown as TFile);
    editor.replaceRange.mockImplementation(() => { throw new Error("write failed"); });

    preview().onConfirm();
    expect(notices).toContain("Could not convert the table: write failed");
  });
});
