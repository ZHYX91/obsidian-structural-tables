import type { App, Editor, EditorPosition, TAbstractFile } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { BasePromotionService } from "../src/app/base-promotion-service";
import {
  LEGACY_TABLE_MEMBERSHIP_PROPERTY,
  promotionBlockAt,
  TABLE_MEMBERSHIP_PROPERTY,
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
  frontmatters: Map<string, Record<string, unknown>>;
  trashed: string[];
  opened: string[];
  renamed: { from: string; to: string }[];
  renameError?: Error;
  afterCreate?: (path: string) => void;
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
  const frontmatters = new Map<string, Record<string, unknown>>();
  const trashed: string[] = [];
  const opened: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  for (const folder of ["Folder", "Moved"]) files.set(folder, memoryFolder(folder));
  const host = { contents, files, frontmatters, trashed, opened, renamed } as MemoryHost;
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
    read: async (file: TFile) => contents.get(file.path) ?? "",
  };
  host.app = {
    vault,
    fileManager: {
      processFrontMatter: async (file: TFile, update: (frontmatter: Record<string, unknown>) => void) => {
        const frontmatter = { ...frontmatters.get(file.path) };
        update(frontmatter);
        frontmatters.set(file.path, frontmatter);
      },
      renameFile: async (file: TAbstractFile, newPath: string) => {
        if (host.renameError !== undefined) throw host.renameError;
        const oldPath = file.path;
        const content = contents.get(oldPath);
        const frontmatter = frontmatters.get(oldPath);
        files.delete(oldPath);
        contents.delete(oldPath);
        frontmatters.delete(oldPath);
        Object.assign(file, {
          path: newPath,
          name: newPath.split("/").pop() ?? "",
          basename: (newPath.split("/").pop() ?? "").replace(/\.[^.]+$/u, ""),
          extension: newPath.includes(".") ? newPath.split(".").pop() ?? "" : "",
        });
        files.set(newPath, file);
        if (content !== undefined) contents.set(newPath, content);
        if (frontmatter !== undefined) frontmatters.set(newPath, frontmatter);
        renamed.push({ from: oldPath, to: newPath });
      },
      trashFile: async (file: TAbstractFile) => {
        trashed.push(file.path);
        for (const path of [...files.keys()]) {
          if (path === file.path || path.startsWith(`${file.path}/`)) {
            files.delete(path);
            contents.delete(path);
            frontmatters.delete(path);
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

  it("organizes a native Base record without changing its properties or body", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Moved/People.md");
    const recordFile = memoryFile("Untitled.md");
    host.files.set(sourceFile.path, sourceFile);
    host.files.set(recordFile.path, recordFile);
    host.contents.set(recordFile.path, "---\nname: Alice\n---\nKept body\n");
    host.frontmatters.set(recordFile.path, {
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_native"],
      name: "Alice",
    });
    const collisionPath = "Moved/_structural-table-records/stb_native/Untitled.md";
    host.files.set(collisionPath, memoryFile(collisionPath));
    const service = new BasePromotionService(host.app);

    const result = await service.adoptCreatedRecord(recordFile, sourceFile, {
      tableId: "stb_native",
      manifestPath: "Moved/manifest.json",
      membershipProperty: TABLE_MEMBERSHIP_PROPERTY,
      propertyKeys: ["name"],
      range: { from: 0, to: 1 },
      source: "base",
    }, true);

    expect(result).toMatchObject({ adopted: true, moved: true });
    expect(recordFile.path).toBe("Moved/_structural-table-records/stb_native/Untitled 2.md");
    expect(host.frontmatters.get(recordFile.path)).toMatchObject({
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_native"],
      name: "Alice",
    });
    expect(host.contents.get(recordFile.path)).toBe("---\nname: Alice\n---\nKept body\n");
  });

  it("does not write identity or move a record the user already organized", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Moved/People.md");
    const recordFile = memoryFile("People/Sales/Alice.md");
    host.files.set(recordFile.path, recordFile);
    host.frontmatters.set(recordFile.path, { [TABLE_MEMBERSHIP_PROPERTY]: ["stb_native"] });
    const service = new BasePromotionService(host.app);

    const result = await service.adoptCreatedRecord(recordFile, sourceFile, {
      tableId: "stb_native",
      manifestPath: "Moved/manifest.json",
      membershipProperty: TABLE_MEMBERSHIP_PROPERTY,
      propertyKeys: [],
      range: { from: 0, to: 1 },
      source: "base",
    }, false);

    expect(result).toMatchObject({ adopted: true, moved: false });
    expect(recordFile.path).toBe("People/Sales/Alice.md");
    expect(host.renamed).toEqual([]);
    expect(host.frontmatters.get(recordFile.path)).toEqual({
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_native"],
    });
  });

  it("keeps the source note unchanged when moving it fails", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Moved/People.md");
    const recordFile = memoryFile("Untitled.md");
    host.files.set(recordFile.path, recordFile);
    host.contents.set(recordFile.path, "Body stays\n");
    host.frontmatters.set(recordFile.path, { [TABLE_MEMBERSHIP_PROPERTY]: ["stb_native"] });
    host.renameError = new Error("move failed");
    const service = new BasePromotionService(host.app);

    await expect(service.adoptCreatedRecord(recordFile, sourceFile, {
      tableId: "stb_native",
      manifestPath: "Moved/manifest.json",
      membershipProperty: TABLE_MEMBERSHIP_PROPERTY,
      propertyKeys: [],
      range: { from: 0, to: 1 },
      source: "base",
    }, true)).rejects.toThrow("move failed");

    expect(recordFile.path).toBe("Untitled.md");
    expect(host.contents.get(recordFile.path)).toBe("Body stays\n");
    expect(host.frontmatters.get(recordFile.path)).toEqual({
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_native"],
    });
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
