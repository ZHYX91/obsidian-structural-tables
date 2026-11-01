// @vitest-environment happy-dom
import { isolateHistory, undo, redo } from "@codemirror/commands";
import type { Command, MarkdownFileInfo, TFile } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import MarkdownIt from "markdown-it";

import { BasePromotionService } from "../src/app/base-promotion-service";
import { StructuralTablesPlugin } from "../src/app/plugin";
import { ConversionPreviewModal } from "../src/app/conversion-preview-modal";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import { parseEditableTables } from "../src/core/parser";
import { tableCommandEditor } from "./helpers/table-command-editor";
import { notices, TFile as MockFile } from "./mocks/obsidian";

const TABLE = "| Name | Status |\n| --- | --- |\n| Alice | Done |";
beforeAll(() => { HTMLElement.prototype.empty = function(): void { this.replaceChildren(); }; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); notices.length = 0; });

describe("registered Base restoration boundary", () => {
  it.each([false, true])("validates the complete note at confirmation (blank=%s)", async (blank) => {
    vi.stubGlobal("activeWindow", window);
    const f = tableCommandEditor(TABLE);
    try {
      const service = new BasePromotionService(f.app);
      const prepared = service.prepare(parseEditableTables(TABLE).tables[0]!, f.file as unknown as TFile);
      f.files.set(prepared.manifestPath, new MockFile(prepared.manifestPath));
      for (const record of prepared.records) f.files.set(record.path, new MockFile(record.path));
      Object.assign(f.app.vault, { read: async () => prepared.manifestContent });
      const prose = "| Later prose | stays visible | IMPORTANT THIRD CELL |";
      const before = `${prepared.replacementSource}${blank ? "\n\n" : "\n"}${prose}`;
      f.cm.dispatch({ changes: { from: 0, to: TABLE.length, insert: before }, annotations: isolateHistory.of("full") });
      f.editor.setCursor({ line: 0, ch: 2 });
      const commands: Command[] = [];
      const plugin = Object.assign(Object.create(StructuralTablesPlugin.prototype) as StructuralTablesPlugin, {
        app: f.app, settings: { ...DEFAULT_SETTINGS, language: "en" }, localizedCommands: [],
        transposeRequestsActive: true, runtimeEpoch: {}, basePromotionService: service,
        addCommand: (command: Command) => { commands.push(command); return command; },
      }) as unknown as StructuralTablesPlugin;
      (plugin as unknown as { registerCommands: () => void }).registerCommands();
      const open = vi.spyOn(ConversionPreviewModal.prototype, "open").mockImplementation(() => {});
      commands.find(({ id }) => id === "restore-current-promoted-base-to-table")!.editorCallback!(f.editor, f.view as MarkdownFileInfo);
      await vi.waitFor(() => expect(open).toHaveBeenCalledOnce());
      const writes = f.writes();
      const selection = f.cm.state.selection;
      (open.mock.instances[0] as unknown as { options: { onConfirm: () => void } }).options.onConfirm();
      await vi.waitFor(() => expect(notices).toHaveLength(1));
      expect(prepared.records.every((record) => f.files.has(record.path))).toBe(true);
      if (!blank) {
        expect(f.source()).toBe(before);
        expect(f.cm.state.selection.eq(selection)).toBe(true);
        expect(f.writes()).toBe(writes);
        expect(notices[0]).toContain("neighboring content");
      } else {
        const result = `${TABLE}\n\n${prose}`;
        expect(f.source()).toBe(result);
        expect(f.writes()).toBe(writes + 1);
        const dom = new DOMParser().parseFromString(new MarkdownIt().render(result), "text/html");
        expect(dom.querySelectorAll("tbody tr")).toHaveLength(1);
        expect(dom.querySelector("p")?.textContent).toBe(prose);
        expect(undo(f.cm)).toBe(true); expect(f.source()).toBe(before);
        expect(redo(f.cm)).toBe(true); expect(f.source()).toBe(result);
      }
      plugin.onunload();
    } finally { f.destroy(); }
  });
});
