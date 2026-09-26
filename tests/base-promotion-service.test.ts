import type { App, Editor, EditorPosition, TAbstractFile } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

import { BasePromotionService } from "../src/app/base-promotion-service";
import {
  LEGACY_TABLE_MEMBERSHIP_PROPERTY,
  promotionBlockAt,
  TABLE_MEMBERSHIP_PROPERTY,
  type PromotionBlockMetadata,
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

function memoryParentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
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
      const parent = files.get(memoryParentPath(path));
      if (parent instanceof TFolder) {
        Object.assign(folder, { parent });
        parent.children.push(folder);
      }
      files.set(path, folder);
      return folder;
    },
    create: async (path: string, content: string) => {
      const file = memoryFile(path);
      const parent = files.get(memoryParentPath(path));
      if (parent instanceof TFolder) {
        Object.assign(file, { parent });
        parent.children.push(file);
      }
      files.set(path, file);
      contents.set(path, content);
      host.afterCreate?.(path);
      return file;
    },
    read: async (file: TFile) => {
      host.afterRead?.(file.path);
      return contents.get(file.path) ?? "";
    },
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
        if (file.parent instanceof TFolder) {
          const index = file.parent.children.indexOf(file);
          if (index >= 0) file.parent.children.splice(index, 1);
        }
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
    expect(host.renamed).toEqual([]);
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

  it("retains the generated directory when the table changes during creation", async () => {
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
    expect(host.trashed).toEqual([]);
    expect(host.files.has(prepared.directoryPath)).toBe(true);
    expect(host.contents.get(prepared.manifestPath)).toBe(prepared.manifestContent);
    expect(editor.getValue()).toBe(SOURCE.replace("Alice", "Alicia"));
  });

  it("preserves a generated folder when a created record changes before rollback", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    host.afterCreate = (path) => {
      if (path.endsWith("/Alice.md")) {
        host.contents.set(path, "external edit");
        editor.mutate(SOURCE.replace("Alice", "Alicia"));
      }
    };

    await expect(service.execute(editor as unknown as Editor, sourceTable(), prepared))
      .rejects.toThrow("generated files were left in place for review");
    expect(host.contents.get(prepared.records[0]?.path ?? "")).toBe("external edit");
    expect(host.files.get(prepared.directoryPath)).toBeInstanceOf(TFolder);
    expect(host.trashed).toEqual([]);
  });

  it("does not trash a replacement folder that appears at the generated path", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    let replaced = false;
    host.afterCreate = (path) => {
      if (!replaced && path.endsWith("/Alice.md")) {
        replaced = true;
        host.files.set(prepared.directoryPath, memoryFolder(prepared.directoryPath));
        editor.mutate(SOURCE.replace("Alice", "Alicia"));
      }
    };

    await expect(service.execute(editor as unknown as Editor, sourceTable(), prepared))
      .rejects.toThrow("generated files were left in place for review");
    expect(host.files.get(prepared.directoryPath)).toBeInstanceOf(TFolder);
    expect(host.trashed).toEqual([]);
  });

  it.each(["edit", "replace"] as const)("preserves a concurrent %s during failure handling", async (mode) => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    const alicePath = prepared.records[0]!.path;
    const retainedPath = mode === "edit" ? alicePath : `${prepared.directoryPath}/User note.md`;
    let changed = false;
    host.afterCreate = (path) => {
      if (path !== prepared.manifestPath) return;
      editor.mutate(SOURCE.replace("Alice", "Alicia"));
      // Interleave after failure handling starts, while the old cleanup awaited its first read.
      queueMicrotask(() => queueMicrotask(() => {
        if (mode === "replace") {
          const folder = host.files.get(prepared.directoryPath) as TFolder;
          const previous = host.files.get(alicePath)!;
          const replacement = memoryFile(retainedPath);
          Object.assign(replacement, { parent: folder });
          folder.children.splice(folder.children.indexOf(previous), 1, replacement);
          host.files.delete(alicePath);
          host.contents.delete(alicePath);
          host.files.set(retainedPath, replacement);
        }
        host.contents.set(retainedPath, "concurrent user content");
        changed = true;
      }));
    };

    await expect(service.execute(editor as unknown as Editor, sourceTable(), prepared)).rejects.toThrow();
    expect(changed).toBe(true);
    expect(host.contents.get(retainedPath)).toBe("concurrent user content");
    expect(host.trashed).toEqual([]);
    expect(editor.getValue()).toBe(SOURCE.replace("Alice", "Alicia"));
  });

  it.each(["first-record", "later-record", "manifest"] as const)("retains partial output after a %s creation failure", async (stage) => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    const failedPath = stage === "manifest" ? prepared.manifestPath
      : prepared.records[stage === "first-record" ? 0 : 1]!.path;
    const originalCreate = host.app.vault.create.bind(host.app.vault);
    vi.spyOn(host.app.vault, "create").mockImplementation(async (path, content) => {
      if (path === failedPath) throw new Error("disk full");
      return originalCreate(path, content);
    });

    await expect(service.execute(editor as unknown as Editor, sourceTable(), prepared))
      .rejects.toThrow(`Record folder: ${prepared.directoryPath}. Original failure: disk full`);
    expect(host.files.has(prepared.directoryPath)).toBe(true);
    expect(host.contents.has(prepared.manifestPath)).toBe(false);
    const retainedCount = stage === "first-record" ? 0 : stage === "later-record" ? 1 : 2;
    expect(prepared.records.filter(({ path }) => host.contents.has(path))).toHaveLength(retainedCount);
    expect(editor.getValue()).toBe(SOURCE);
    expect(host.trashed).toEqual([]);
  });

  it("keeps unexpected children and subfolders after a failed promotion", async () => {
    const host = memoryHost();
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), memoryFile("Folder/People.md"));
    const foreignPath = `${prepared.directoryPath}/External`;
    host.afterCreate = (path) => {
      if (path !== prepared.manifestPath) return;
      const parent = host.files.get(prepared.directoryPath) as TFolder;
      const folder = memoryFolder(foreignPath);
      Object.assign(folder, { parent });
      parent.children.push(folder);
      host.files.set(foreignPath, folder);
      editor.mutate(SOURCE.replace("Alice", "Alicia"));
    };

    await expect(service.execute(editor as unknown as Editor, sourceTable(), prepared)).rejects.toThrow();
    expect(host.files.get(foreignPath)).toBeInstanceOf(TFolder);
    expect(host.contents.get(prepared.manifestPath)).toBe(prepared.manifestContent);
    expect(host.trashed).toEqual([]);
  });

  it("reports non-Error editor failures without deleting completed records", async () => {
    const host = memoryHost();
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), memoryFile("Folder/People.md"));
    vi.spyOn(editor, "replaceRange").mockImplementation(() => { throw "editor unavailable"; });

    await expect(service.execute(editor as unknown as Editor, sourceTable(), prepared))
      .rejects.toThrow(`Record folder: ${prepared.directoryPath}. Original failure: editor unavailable`);
    expect(editor.getValue()).toBe(SOURCE);
    expect(prepared.records.every(({ path }) => host.contents.has(path))).toBe(true);
    expect(host.contents.get(prepared.manifestPath)).toBe(prepared.manifestContent);
    expect(host.trashed).toEqual([]);
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

  it("re-resolves a moved Base after reading its manifest before restoring", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared);
    const metadata = promotionBlockAt(editor.getValue(), editor.getValue().indexOf("filters:"));
    if (metadata === null) throw new Error("Expected promotion metadata.");
    host.afterRead = (path) => {
      if (path === prepared.manifestPath) editor.mutate(`Intro\n${editor.getValue()}`);
    };

    await service.restore(editor as unknown as Editor, metadata);

    expect(editor.getValue()).toBe(`Intro\n${SOURCE}`);
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

describe("asynchronous restoration guards", () => {
  it.each(["changed", "duplicated"])("refuses a Base %s during manifest read without overwriting content", async (mode) => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared);
    const metadata = promotionBlockAt(editor.getValue(), editor.getValue().indexOf("filters:"))!;
    let externalSource = "";
    host.afterRead = () => {
      externalSource = mode === "duplicated" ? `${editor.getValue()}\n\n${editor.getValue()}`
        : editor.getValue().replace("filters:", "# external edit\nfilters:");
      editor.mutate(externalSource);
    };
    await expect(service.restore(editor as unknown as Editor, metadata)).rejects.toThrow("changed");
    expect(editor.getValue()).toBe(externalSource);
  });
  it("keeps membership authoritative when a saved Base displays a control property", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const service = new BasePromotionService(host.app);
    const metadata: PromotionBlockMetadata = {
      tableId: "stb_control",
      manifestPath: "Folder/_structural-table-records/stb_control/_promotion.json",
      membershipProperty: TABLE_MEMBERSHIP_PROPERTY,
      propertyKeys: [TABLE_MEMBERSHIP_PROPERTY, "Name"],
      range: { from: 0, to: 0 },
      source: "",
    };
    const created = await service.createRecord(sourceFile, metadata);
    const content = host.contents.get(created.path) ?? "";
    expect(content).toContain('structural-tables:\n  - "stb_control"');
    expect(content).not.toContain("structural-tables: \"\"");
  });

  it("refuses a promotion when the source file identity changes during generated writes", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    host.afterCreate = (path) => {
      if (path.endsWith("/Alice.md")) sourceFile.path = "Folder/Renamed.md";
    };

    await expect(service.execute(editor as unknown as Editor, sourceTable(), prepared, sourceFile))
      .rejects.toThrow("source note changed while records were being created");
    expect(editor.getValue()).toBe(SOURCE);
    expect(host.files.has(prepared.directoryPath)).toBe(true);
  });

  it("refuses restore when the manifest changes after the preview source was read", async () => {
    const host = memoryHost();
    const sourceFile = memoryFile("Folder/People.md");
    host.files.set(sourceFile.path, sourceFile);
    const editor = new MemoryEditor(SOURCE);
    const service = new BasePromotionService(host.app);
    const prepared = service.prepare(sourceTable(), sourceFile);
    await service.execute(editor as unknown as Editor, sourceTable(), prepared, sourceFile);
    const metadata = promotionBlockAt(editor.getValue(), 1, sourceFile.path)!;
    const preview = await service.restorationSource(metadata);
    const manifest = JSON.parse(prepared.manifestContent);
    host.contents.set(prepared.manifestPath, JSON.stringify({
      ...manifest,
      originalTableSource: SOURCE.replace("Alice", "Alicia"),
    }));

    await expect(service.restore(editor as unknown as Editor, metadata, preview))
      .rejects.toThrow("manifest changed after the preview");
    expect(editor.getValue()).toBe(prepared.replacementSource);
  });

});
