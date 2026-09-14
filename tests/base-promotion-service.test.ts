import type { App, Editor, EditorPosition, TAbstractFile } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

import { BasePromotionService } from "../src/app/base-promotion-service";
import {
  LEGACY_TABLE_MEMBERSHIP_PROPERTY,
  promotionBlockAt,
} from "../src/core/base-promotion";
import { parseEditableTables } from "../src/core/parser";

let testUuid = 0;
vi.stubGlobal("activeWindow", {
  crypto: {
    randomUUID: () => {
      testUuid += 1;
      return `10000000-0000-4000-8000-${String(testUuid).padStart(12, "0")}`;
    },
  },
});

class MemoryEditor {
  constructor(private source: string) {}

  getValue(): string { return this.source; }

  offsetToPos(offset: number): EditorPosition {
    const before = this.source.slice(0, offset);
    const lines = before.split("\n");
    return { line: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 };
  }

  replaceRange(replacement: string, from: EditorPosition, to: EditorPosition): void {
    const start = this.posToOffset(from);
    const end = this.posToOffset(to);
    this.source = `${this.source.slice(0, start)}${replacement}${this.source.slice(end)}`;
  }

  setCursor(_position: EditorPosition): void {}

  mutate(source: string): void { this.source = source; }

  private posToOffset(position: EditorPosition): number {
    const lines = this.source.split("\n");
    let offset = 0;
    for (let line = 0; line < position.line; line += 1) offset += (lines[line]?.length ?? 0) + 1;
    return offset + position.ch;
  }
}

interface MemoryHost {
  app: App;
  contents: Map<string, string>;
  files: Map<string, TAbstractFile>;
  trashed: string[];
  opened: string[];
  afterCreate?: (path: string) => void;
  afterRead?: (path: string) => void;
}

function memoryFile(path: string): TFile {
  const value = Object.create(TFile.prototype) as TFile;
  return Object.assign(value, {
    path,
    name: path.split("/").pop() ?? "",
    basename: (path.split("/").pop() ?? "").replace(/\.[^.]+$/u, ""),
    extension: path.includes(".") ? path.split(".").pop() ?? "" : "",
    parent: null,
  });
}

function memoryFolder(path: string): TFolder {
  const value = Object.create(TFolder.prototype) as TFolder;
  return Object.assign(value, { path, name: path.split("/").pop() ?? "", parent: null, children: [] });
}

function memoryHost(): MemoryHost {
  const contents = new Map<string, string>();
  const files = new Map<string, TAbstractFile>();
  const trashed: string[] = [];
  const opened: string[] = [];
  for (const folder of ["Folder", "Moved"]) files.set(folder, memoryFolder(folder));
  const host = { contents, files, trashed, opened } as MemoryHost;
  const vault = {
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    getFileByPath: (path: string) => {
      const file = files.get(path);
      return file instanceof TFile ? file : null;
    },
    createFolder: async (path: string) => {
      const folder = memoryFolder(path);
      files.set(path, folder);
      return folder;
    },
    create: async (path: string, content: string) => {
      const file = memoryFile(path);
      files.set(path, file);
      contents.set(path, content);
      host.afterCreate?.(path);
      return file;
    },
    read: async (file: TFile) => {
      const content = contents.get(file.path) ?? "";
      host.afterRead?.(file.path);
      return content;
    },
  };
  host.app = {
    vault,
    fileManager: {
      trashFile: async (file: TAbstractFile) => {
        trashed.push(file.path);
        for (const path of [...files.keys()]) {
          if (path === file.path || path.startsWith(`${file.path}/`)) {
            files.delete(path);
            contents.delete(path);
          }
        }
      },
    },
    workspace: {
      getLeaf: () => ({
        openFile: async (file: TFile) => { opened.push(file.path); },
      }),
    },
  } as unknown as App;
  return host;
}

const SOURCE = `| Name | Status |
| --- | --- |
| Alice | Doing |
| Bob | Done |`;

function sourceTable() {
  const parsed = parseEditableTables(SOURCE).tables[0];
  if (parsed === undefined) throw new Error("Expected table fixture.");
  return parsed;
}

describe("Base promotion file transaction", () => {
  it("recovers an unmarked saved Base only through its exact original manifest", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared);
    const config = parse(editor.getValue().split("\n").slice(1, -1).join("\n"));
    delete config["structural-tables"];
    editor.mutate(`\`\`\`base\n${stringify(config)}\`\`\``);
    const metadata = promotionBlockAt(editor.getValue(), 1, sourceFile.path)!;
    expect(metadata.recoveredSourcePath).toBe(sourceFile.path);
    expect(await service.restorationSource(metadata)).toBe(SOURCE);
    const manifest = JSON.parse(prepared.manifestContent);
    host.contents.set(prepared.manifestPath, JSON.stringify({ ...manifest, sourceFilePath: "Unrelated.md" }));
    const before = [...host.contents];
    await expect(service.createRecord(sourceFile, metadata)).rejects.toThrow("does not prove ownership");
    expect([...host.contents]).toEqual(before);
    host.contents.set(prepared.manifestPath, prepared.manifestContent);
    await service.restore(editor as unknown as Editor, metadata);
    expect(editor.getValue()).toBe(SOURCE);
    expect(prepared.records.every(({ path }) => host.contents.has(path))).toBe(true);
  });

  it("creates records and a manifest before replacing the source table", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);

    await service.execute(editor as unknown as Editor, sourceTable(), prepared);

    expect(prepared.records.map((record) => record.path)).toEqual([
      `${prepared.directoryPath}/Alice.md`,
      `${prepared.directoryPath}/Bob.md`,
    ]);
    expect(host.contents.get(prepared.records[0]?.path ?? "")).toContain("structural-tables:");
    expect(host.contents.get(prepared.records[0]?.path ?? "")).not.toContain("structural_record_id:");
    expect(host.contents.get(prepared.records[0]?.path ?? "")).toContain('Name: "Alice"');
    expect(host.contents.has(prepared.manifestPath)).toBe(true);
    expect(host.contents.get(prepared.manifestPath)).toContain('"version": 2');
    expect(host.contents.get(prepared.manifestPath)).toContain('"pluginVersion": "0.4.0"');
    expect(host.contents.get(prepared.manifestPath)).not.toContain('"recordId"');
    expect(editor.getValue()).toBe(prepared.replacementSource);
  });

  it("trashes the generated directory when the table changes during creation", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    host.afterCreate = (path) => {
      if (path.endsWith(".md")) editor.mutate(SOURCE.replace("Alice", "Alicia"));
    };

    await expect(service.execute(editor as unknown as Editor, sourceTable(), prepared))
      .rejects.toThrow("changed while records were being created");
    expect(host.trashed).toEqual([prepared.directoryPath]);
    expect(host.files.has(prepared.directoryPath)).toBe(false);
  });

  it("keeps a merged-data preview non-executable without creating files", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const source = `| Name | Q1 | Q2 |
| --- | --- | --- |
| Alice | 1 | < |`;
    const merged = parseEditableTables(source).tables[0]!;
    const editor = new MemoryEditor(source);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(merged, sourceFile);

    expect(prepared.plan.blockers).toHaveLength(1);
    await expect(service.execute(editor as unknown as Editor, merged, prepared))
      .rejects.toThrow("blocking structural conversion issue");
    expect(editor.getValue()).toBe(source);
    expect(host.files.has(prepared.directoryPath)).toBe(false);
    expect(host.trashed).toEqual([]);
  });

  it("relocates an unchanged Base after concurrent prose shifts during manifest read", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared);
    const metadata = promotionBlockAt(editor.getValue(), editor.getValue().indexOf("filters:"));
    if (metadata === null) throw new Error("Expected promotion metadata.");
    let shifted = false;
    host.afterRead = (path) => {
      if (!shifted && path === prepared.manifestPath) {
        shifted = true;
        editor.mutate(`Concurrent prose\n${editor.getValue()}`);
      }
    };

    await service.restore(editor as unknown as Editor, metadata);

    expect(editor.getValue()).toBe(`Concurrent prose\n${SOURCE}`);
  });

  it("refuses restoration when the Base changes during manifest read", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared);
    const metadata = promotionBlockAt(editor.getValue(), editor.getValue().indexOf("filters:"));
    if (metadata === null) throw new Error("Expected promotion metadata.");
    let changed = false;
    host.afterRead = (path) => {
      if (!changed && path === prepared.manifestPath) {
        changed = true;
        editor.mutate(editor.getValue().replace("name: Table", "name: Changed"));
      }
    };

    await expect(service.restore(editor as unknown as Editor, metadata))
      .rejects.toThrow("changed while its recovery manifest was being read");
    expect(editor.getValue()).toContain("name: Changed");
  });

  it("restores the original table without deleting generated notes", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared);
    const metadata = promotionBlockAt(editor.getValue(), editor.getValue().indexOf("filters:"));
    if (metadata === null) throw new Error("Expected promotion metadata.");

    await service.restore(editor as unknown as Editor, metadata);

    expect(editor.getValue()).toBe(SOURCE);
    expect(host.files.has(prepared.records[0]?.path ?? "")).toBe(true);
  });

  it("restores schema version 1 manifests regardless of their producer version", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared);
    const metadata = promotionBlockAt(editor.getValue(), editor.getValue().indexOf("filters:"));
    if (metadata === null) throw new Error("Expected promotion metadata.");
    const manifest = JSON.parse(host.contents.get(prepared.manifestPath) ?? "") as { pluginVersion: string };
    manifest.pluginVersion = "0.1.0-development";
    host.contents.set(prepared.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await service.restore(editor as unknown as Editor, metadata);

    expect(editor.getValue()).toBe(SOURCE);
  });

  it("creates later records beside the host note's current folder", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared);
    const metadata = promotionBlockAt(editor.getValue(), editor.getValue().indexOf("filters:"));
    if (metadata === null) throw new Error("Expected promotion metadata.");
    const movedHost = memoryFile("Moved/People.md");
    host.files.set(movedHost.path, movedHost);

    const created = await service.createRecord(movedHost, metadata);

    expect(created.path).toBe(`Moved/_structural-table-records/${metadata.tableId}/Record.md`);
    expect(host.contents.get(created.path)).toContain(`- "${metadata.tableId}"`);
    expect(host.contents.get(created.path)).not.toContain("structural_record_id:");
    expect(host.opened).toEqual([created.path]);
  });

  it("keeps plugin-created records visible in an unmigrated legacy Base", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const source = `\`\`\`base
# structural-tables-promotion: stb_legacy
# structural-tables-manifest: "Folder/manifest.json"
filters:
  and:
    - 'list(note.structural_table_ids).contains("stb_legacy")'
properties:
views:
  - type: table
    name: Table
    order:
\`\`\``;
    const metadata = promotionBlockAt(source, source.indexOf("filters:"));
    if (metadata === null) throw new Error("Expected legacy promotion metadata.");
    const service = new BasePromotionService(host.app);

    const created = await service.createRecord(sourceFile, metadata);

    expect(metadata.membershipProperty).toBe(LEGACY_TABLE_MEMBERSHIP_PROPERTY);
    expect(host.contents.get(created.path)).toContain("structural_table_ids:");
    expect(host.contents.get(created.path)).not.toContain("structural-tables:");
  });

  it("refuses a target collision before creating or trashing anything", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    host.files.set(prepared.directoryPath, memoryFolder(prepared.directoryPath));

    await expect(service.execute(editor as unknown as Editor, sourceTable(), prepared))
      .rejects.toThrow("already exists");
    expect(editor.getValue()).toBe(SOURCE);
    expect(host.trashed).toEqual([]);
  });

  it("refuses restoration when the recovery manifest is missing", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared);
    const metadata = promotionBlockAt(editor.getValue(), editor.getValue().indexOf("filters:"));
    if (metadata === null) throw new Error("Expected promotion metadata.");
    host.files.delete(prepared.manifestPath);
    host.contents.delete(prepared.manifestPath);

    await expect(service.restore(editor as unknown as Editor, metadata)).rejects.toThrow("could not be found");
    expect(editor.getValue()).toBe(prepared.replacementSource);
  });
});
