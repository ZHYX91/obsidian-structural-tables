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

function promotedBase(tableId: string, ending = "\n"): string {
  return `\`\`\`base
# structural-tables-promotion: ${tableId}
# structural-tables-manifest: "Records/${tableId}/_promotion.json"
filters:
  and:
    - 'list(note.structural_table_ids).contains("${tableId}")'
\`\`\``.split("\n").join(ending);
}

interface MigrationHost {
  app: App;
  files: TFile[];
  sources: Map<TFile, string>;
  frontmatters: Map<TFile, Record<string, unknown>>;
  failProcessPath?: string;
  failAfterTransformPath?: string;
  beforeProcess?: (file: TFile) => void;
  beforeFrontMatter?: (file: TFile, frontmatter: Record<string, unknown>) => void;
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
        host.beforeProcess?.(file as TFile);
        if (host.failProcessPath === file.path) throw new Error("write failed");
        const current = sources.get(file as TFile) ?? "";
        const next = update(current);
        if (host.failAfterTransformPath === file.path) throw new Error("write failed after transform");
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
        host.beforeFrontMatter?.(file as TFile, next);
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
  it.each(["none", "before-write", "later-write"])("handles membership and a custom-filter Base in one file: %s", async (failure) => {
    const host = migrationHost();
    const base = testFile("People.md");
    const later = testFile("Later.md");
    host.files.push(base, later);
    const properties = { [TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"], [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"], status: "Active" };
    const body = promotedBase("stb_people").replace(
      'filters:\n  and:\n    - \'list(note.structural_table_ids).contains("stb_people")\'',
      'filters: \'note.status == "Active"\'\nviews:\n  - type: table\n    name: Active\n    filters: \'list(note.structural_table_ids).contains("stb_people")\'',
    );
    const original = yaml(properties, body);
    host.frontmatters.set(base, properties);
    host.sources.set(base, original);
    host.sources.set(later, promotedBase("stb_later"));
    if (failure === "before-write") host.failAfterTransformPath = base.path;
    if (failure === "later-write") host.failProcessPath = later.path;
    const service = new BasePropertyMigrationService(host.app);
    const prepared = await service.prepare();
    if (failure === "none") {
      await service.execute(prepared, false);
      expect(host.sources.get(base)).toContain('filters: \'note.status == "Active"\'');
      expect(host.sources.get(base)).not.toContain("note.structural_table_ids");
      expect(host.frontmatters.get(base)?.[LEGACY_TABLE_MEMBERSHIP_PROPERTY]).toBeUndefined();
      expect((await service.prepare()).files).toHaveLength(0);
    } else {
      await expect(service.execute(prepared, false)).rejects.toThrow("Every completed file was restored");
      expect(host.sources.get(base)?.slice(host.sources.get(base)!.indexOf("\n---\n", 4) + 5)).toBe(body);
      expect(host.frontmatters.get(base)).toEqual(properties);
    }
  });
  it.each([false, true].flatMap(fail => ["current", "custom", "absent", "spaced", "single-quoted"].map(global => ({ fail, global }))))("discovers view-only legacy filters and preserves rollback ($global, failure=$fail)", async ({ fail, global }) => {
    const host = migrationHost();
    const record = testFile("Records/Alice.md");
    const base = testFile("People.md");
    const later = testFile("Later.md");
    host.files.push(record, base, later);
    const originalProperties = {
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      name: "Alice",
    };
    host.frontmatters.set(record, originalProperties);
    host.sources.set(record, yaml(originalProperties, "Kept body\n"));
    let originalBase = promotedBase("stb_people")
      .replace('note.structural_table_ids', 'note["structural-tables"]')
      .replace('\n```', '\nviews:\n  - type: table\n    name: People\n    filters: \'list(note.structural_table_ids).contains("stb_people")\'\n```');
    if (global !== "current") originalBase = originalBase.replace(
      'filters:\n  and:\n    - \'list(note["structural-tables"]).contains("stb_people")\'\n',
      global === "absent" ? "" : `filters: ${JSON.stringify(global === "custom" ? 'file.ext == "md"'
        : global === "spaced" ? 'list ( note.structural_table_ids ).contains("stb_people")'
          : 'list(note[\'structural_table_ids\']).contains("stb_people")')}\n`,
    );
    host.sources.set(base, originalBase);
    host.sources.set(later, promotedBase("stb_later"));
    const service = new BasePropertyMigrationService(host.app);
    const prepared = await service.prepare();
    expect(prepared.legacyBaseCount).toBe(2);
    if (fail) {
      host.failProcessPath = later.path;
      await expect(service.execute(prepared, false)).rejects.toThrow("write failed");
      expect(host.sources.get(base)).toBe(originalBase);
      expect(host.frontmatters.get(record)).toEqual(originalProperties);
    } else {
      await service.execute(prepared, false);
      expect(host.sources.get(base)).not.toContain("note.structural_table_ids");
      const decoded = (host.sources.get(base) ?? "").replace(/\\"/gu, '"');
      expect(decoded.match(/list\(note\["structural-tables"\]\)/gu)).toHaveLength(["custom", "absent"].includes(global) ? 1 : 2);
      if (global === "custom") expect(decoded).toContain('file.ext == "md"');
      expect(host.frontmatters.get(record)?.[LEGACY_TABLE_MEMBERSHIP_PROPERTY]).toBeUndefined();
      expect((await service.prepare()).legacyBaseCount).toBe(0);
    }
  });

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

  it("does not classify an unrelated structural_record_id as plugin-owned cleanup", async () => {
    const host = migrationHost();
    const unrelated = testFile("Unrelated.md");
    host.files.push(unrelated);
    host.frontmatters.set(unrelated, { [LEGACY_RECORD_ID_PROPERTY]: "user-value", topic: "kept" });
    const original = yaml(host.frontmatters.get(unrelated) ?? {});
    host.sources.set(unrelated, original);
    const service = new BasePropertyMigrationService(host.app);

    const prepared = await service.prepare();
    expect(prepared.legacyRecordIdCount).toBe(0);
    expect(prepared.files).toHaveLength(0);
    expect(await service.execute(prepared, true)).toMatchObject({ fileCount: 0, removedRecordIdCount: 0 });
    expect(host.sources.get(unrelated)).toBe(original);
  });

  it("cleans a retired record ID when current membership proves plugin ownership", async () => {
    const host = migrationHost();
    const record = testFile("Records/Current.md");
    host.files.push(record);
    host.frontmatters.set(record, {
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_current"],
      [LEGACY_RECORD_ID_PROPERTY]: "str_current",
    });
    host.sources.set(record, yaml(host.frontmatters.get(record) ?? {}));
    const service = new BasePropertyMigrationService(host.app);

    const prepared = await service.prepare();
    expect(prepared.legacyRecordIdCount).toBe(1);
    await service.execute(prepared, true);
    expect(host.frontmatters.get(record)).toEqual({ [TABLE_MEMBERSHIP_PROPERTY]: ["stb_current"] });
  });

  it("revalidates membership and record ID inside the frontmatter write", async () => {
    const host = migrationHost();
    const record = testFile("Records/Current.md");
    host.files.push(record);
    host.frontmatters.set(record, {
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_current"],
      [LEGACY_RECORD_ID_PROPERTY]: "str_current",
    });
    const original = yaml(host.frontmatters.get(record) ?? {});
    host.sources.set(record, original);
    host.beforeFrontMatter = (_file, frontmatter) => {
      delete frontmatter[TABLE_MEMBERSHIP_PROPERTY];
    };
    const service = new BasePropertyMigrationService(host.app);

    await expect(service.execute(await service.prepare(), true)).rejects.toThrow("membership changed during migration");
    expect(host.frontmatters.get(record)).toEqual({
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_current"],
      [LEGACY_RECORD_ID_PROPERTY]: "str_current",
    });
    expect(host.sources.get(record)).toBe(original);
  });

  it.each([
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("migrates a promoted Base with %s endings without normalizing them", async (_name, ending) => {
    const host = migrationHost();
    const base = testFile("People.md");
    host.files.push(base);
    const original = promotedBase("stb_people", ending);
    host.sources.set(base, original);
    const service = new BasePropertyMigrationService(host.app);

    const prepared = await service.prepare();
    expect(prepared.legacyBaseCount).toBe(1);
    await service.execute(prepared, false);

    const migrated = host.sources.get(base) ?? "";
    expect(migrated).toContain('list(note["structural-tables"])');
    if (ending === "\r") expect(migrated).not.toContain("\n");
    else expect(migrated.split("\r\n").join("")).not.toContain("\n");
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

  it("rolls back only migrated properties while preserving unrelated concurrent edits", async () => {
    const host = migrationHost();
    const record = testFile("Records/Alice.md");
    const base = testFile("People.md");
    host.files.push(record, base);
    host.frontmatters.set(record, {
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      [LEGACY_RECORD_ID_PROPERTY]: "str_alice",
      topic: "before",
    });
    host.sources.set(record, yaml(host.frontmatters.get(record) ?? {}, "Body\n"));
    host.sources.set(base, promotedBase("stb_people"));
    host.failProcessPath = base.path;
    host.beforeProcess = (file) => {
      if (file !== base) return;
      const current = host.frontmatters.get(record);
      if (current !== undefined) current.topic = "concurrent";
      host.sources.set(record, `${host.sources.get(record)}Concurrent body\n`);
    };
    const service = new BasePropertyMigrationService(host.app);

    await expect(service.execute(await service.prepare(), true)).rejects.toThrow("Every completed file was restored");

    expect(host.frontmatters.get(record)).toEqual({
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      [LEGACY_RECORD_ID_PROPERTY]: "str_alice",
      topic: "concurrent",
    });
    expect(host.sources.get(record)).toContain("Concurrent body");
  });

  it("refuses an unrelated concurrent edit between preview and a Base rewrite", async () => {
    const host = migrationHost();
    const base = testFile("People.md");
    host.files.push(base);
    const original = promotedBase("stb_people");
    host.sources.set(base, original);
    let changed = false;
    host.beforeProcess = (file) => {
      if (file !== base || changed) return;
      changed = true;
      host.sources.set(base, `${host.sources.get(base)}\nConcurrent user edit`);
    };
    const service = new BasePropertyMigrationService(host.app);

    await expect(service.execute(await service.prepare(), false)).rejects.toThrow("changed during migration");
    expect(host.sources.get(base)).toBe(`${original}\nConcurrent user edit`);
  });
  it("preserves unrelated Base strings while migrating only membership filters", async () => {
    const host = migrationHost();
    const base = testFile("People.md");
    host.files.push(base);
    const original = promotedBase("stb_people").replace(
      "filters:",
      'properties:\n  "note.name":\n    displayName: "list(note.structural_table_ids)"\nfilters:',
    );
    host.sources.set(base, original);
    const service = new BasePropertyMigrationService(host.app);

    await service.execute(await service.prepare(), false);

    const migrated = host.sources.get(base) ?? "";
    expect(migrated).toContain('displayName: "list(note.structural_table_ids)"');
    expect(migrated).toContain('list(note["structural-tables"])');
  });

  it("restores both equivalent membership fields exactly when a later write fails", async () => {
    const host = migrationHost();
    const record = testFile("Records/Alice.md");
    const base = testFile("People.md");
    host.files.push(record, base);
    const originalMembership = ["stb_people"];
    host.frontmatters.set(record, {
      [TABLE_MEMBERSHIP_PROPERTY]: [...originalMembership],
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: [...originalMembership],
      topic: "kept",
    });
    const originalRecord = yaml(host.frontmatters.get(record) ?? {}, "Body\n");
    host.sources.set(record, originalRecord);
    host.sources.set(base, promotedBase("stb_people"));
    host.failProcessPath = base.path;
    const service = new BasePropertyMigrationService(host.app);

    await expect(service.execute(await service.prepare(), false))
      .rejects.toThrow("Every completed file was restored");

    expect(host.frontmatters.get(record)).toEqual({
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      topic: "kept",
    });
    expect(host.sources.get(record)).toContain("Body\n");
  });

});
