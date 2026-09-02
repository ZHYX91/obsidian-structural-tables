import type { App, TFile as ObsidianTFile } from "obsidian";
import { TFile } from "obsidian";
import { describe, expect, it } from "vitest";

import { BasePropertyMigrationService } from "../src/app/base-property-migration-service";
import {
  LEGACY_RECORD_ID_PROPERTY,
  LEGACY_TABLE_MEMBERSHIP_PROPERTY,
  TABLE_MEMBERSHIP_PROPERTY,
} from "../src/core/base-promotion";

function testFile(path: string): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  const name = path.split("/").pop() ?? "";
  return Object.assign(file, {
    path,
    name,
    basename: name.replace(/\.[^.]+$/u, ""),
    extension: "md",
    parent: null,
  });
}

function yaml(frontmatter: Record<string, unknown>, body = ""): string {
  const lines = Object.entries(frontmatter).flatMap(([key, value]) => {
    if (Array.isArray(value)) return [`${key}:`, ...value.map((item) => `  - ${String(item)}`)];
    return [`${key}: ${String(value)}`];
  });
  return `---\n${lines.join("\n")}\n---\n${body}`;
}

function promotedBase(tableId: string): string {
  return `\`\`\`base
# structural-tables-promotion: ${tableId}
# structural-tables-manifest: "Records/${tableId}/_promotion.json"
filters:
  and:
    - 'list(note.structural_table_ids).contains("${tableId}")'
\`\`\``;
}

interface MigrationHost {
  app: App;
  files: TFile[];
  sources: Map<TFile, string>;
  frontmatters: Map<TFile, Record<string, unknown>>;
  failProcessPath?: string;
}

function migrationHost(): MigrationHost {
  const files: TFile[] = [];
  const sources = new Map<TFile, string>();
  const frontmatters = new Map<TFile, Record<string, unknown>>();
  const host = { files, sources, frontmatters } as MigrationHost;
  host.app = {
    vault: {
      getMarkdownFiles: () => files,
      read: async (file: ObsidianTFile) => sources.get(file as TFile) ?? "",
      process: async (file: ObsidianTFile, update: (source: string) => string) => {
        if (host.failProcessPath === file.path) throw new Error("write failed");
        const current = sources.get(file as TFile) ?? "";
        const next = update(current);
        sources.set(file as TFile, next);
        return next;
      },
    },
    metadataCache: {
      getFileCache: (file: ObsidianTFile) => ({ frontmatter: frontmatters.get(file as TFile) }),
    },
    fileManager: {
      processFrontMatter: async (
        file: ObsidianTFile,
        update: (frontmatter: Record<string, unknown>) => void,
      ) => {
        const next = { ...frontmatters.get(file as TFile) };
        update(next);
        frontmatters.set(file as TFile, next);
        const source = sources.get(file as TFile) ?? "";
        const closing = source.indexOf("\n---\n", 4);
        const body = closing < 0 ? "" : source.slice(closing + 5);
        sources.set(file as TFile, yaml(next, body));
      },
    },
  } as unknown as App;
  return host;
}

describe("legacy Base property migration", () => {
  it("previews and explicitly migrates memberships, Base filters, and retired record IDs", async () => {
    const host = migrationHost();
    const record = testFile("Records/Alice.md");
    const base = testFile("People.md");
    host.files.push(record, base);
    host.frontmatters.set(record, {
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      [LEGACY_RECORD_ID_PROPERTY]: "str_alice",
      name: "Alice",
    });
    host.sources.set(record, yaml(host.frontmatters.get(record) ?? {}, "Kept body\n"));
    host.sources.set(base, promotedBase("stb_people"));
    const service = new BasePropertyMigrationService(host.app);

    const prepared = await service.prepare();
    expect(prepared).toMatchObject({
      membershipNoteCount: 1,
      legacyBaseCount: 1,
      legacyRecordIdCount: 1,
    });
    const result = await service.execute(prepared, true);

    expect(result).toEqual({
      fileCount: 2,
      membershipNoteCount: 1,
      legacyBaseCount: 1,
      removedRecordIdCount: 1,
    });
    expect(host.frontmatters.get(record)).toEqual({
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      name: "Alice",
    });
    expect(host.sources.get(record)).toContain("structural-tables:\n  - stb_people");
    expect(host.sources.get(record)).toContain("Kept body");
    expect(host.sources.get(base)).toContain('list(note["structural-tables"])');
  });

  it("keeps retired record IDs when the user turns cleanup off", async () => {
    const host = migrationHost();
    const record = testFile("Records/Alice.md");
    host.files.push(record);
    host.frontmatters.set(record, {
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      [LEGACY_RECORD_ID_PROPERTY]: "str_alice",
    });
    host.sources.set(record, yaml(host.frontmatters.get(record) ?? {}));
    const service = new BasePropertyMigrationService(host.app);

    await service.execute(await service.prepare(), false);

    expect(host.frontmatters.get(record)?.[LEGACY_RECORD_ID_PROPERTY]).toBe("str_alice");
    expect(host.frontmatters.get(record)?.[LEGACY_TABLE_MEMBERSHIP_PROPERTY]).toBeUndefined();
  });

  it("fails closed for conflicting, malformed, or stale metadata", async () => {
    const host = migrationHost();
    const conflicting = testFile("Conflict.md");
    host.files.push(conflicting);
    host.frontmatters.set(conflicting, {
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_new"],
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_old"],
    });
    host.sources.set(conflicting, yaml(host.frontmatters.get(conflicting) ?? {}));
    const service = new BasePropertyMigrationService(host.app);
    await expect(service.prepare()).rejects.toThrow("Conflicting or invalid");

    host.frontmatters.set(conflicting, { [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_old"] });
    host.sources.set(conflicting, yaml(host.frontmatters.get(conflicting) ?? {}));
    const prepared = await service.prepare();
    host.sources.set(conflicting, `${host.sources.get(conflicting)}Changed\n`);
    await expect(service.execute(prepared, true)).rejects.toThrow("changed after preview");
    expect(host.frontmatters.get(conflicting)).toEqual({
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_old"],
    });
  });

  it("restores completed files when a later write fails", async () => {
    const host = migrationHost();
    const record = testFile("Records/Alice.md");
    const base = testFile("People.md");
    host.files.push(record, base);
    host.frontmatters.set(record, { [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"] });
    const originalRecord = yaml(host.frontmatters.get(record) ?? {}, "Body\n");
    const originalBase = promotedBase("stb_people");
    host.sources.set(record, originalRecord);
    host.sources.set(base, originalBase);
    host.failProcessPath = base.path;
    const service = new BasePropertyMigrationService(host.app);

    await expect(service.execute(await service.prepare(), true)).rejects.toThrow("Every completed file was restored");

    expect(host.sources.get(record)).toBe(originalRecord);
    expect(host.sources.get(base)).toBe(originalBase);
  });
});
