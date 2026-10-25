import type { App, TFile as ObsidianTFile } from "obsidian";
import { MarkdownView, TFile } from "obsidian";
import { parseDocument } from "yaml";
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
    extension: name.includes(".") ? name.split(".").pop() ?? "" : "",
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

function promotedBase(
  tableId: string,
  ending = "\n",
  manifestPath = `Records/${tableId}/_promotion.json`,
): string {
  return `\`\`\`base
# structural-tables-promotion: ${tableId}
# structural-tables-manifest: "${manifestPath}"
filters:
  and:
    - 'list(note.structural_table_ids).contains("${tableId}")'
\`\`\``.split("\n").join(ending);
}

interface MigrationHost {
  app: App;
  files: TFile[];
  supportFiles: Map<string, TFile>;
  sources: Map<TFile, string>;
  frontmatters: Map<TFile, Record<string, unknown>>;
  editors: MarkdownView[];
  processCalls: TFile[];
  beforeRead?: (file: TFile) => void | Promise<void>;
  afterProcess?: (file: TFile) => void | Promise<void>;
  failProcessPath?: string;
  failAfterTransformPath?: string;
  beforeProcess?: (file: TFile) => void | Promise<void>;
}

function migrationHost(): MigrationHost {
  const files: TFile[] = [];
  const supportFiles = new Map<string, TFile>();
  const sources = new Map<TFile, string>();
  const frontmatters = new Map<TFile, Record<string, unknown>>();
  const editors: MarkdownView[] = [];
  const processCalls: TFile[] = [];
  const host = { files, supportFiles, sources, frontmatters, editors, processCalls } as MigrationHost;
  host.app = {
    vault: {
      getMarkdownFiles: () => files,
      getFileByPath: (path: string) => files.find((file) => file.path === path) ?? supportFiles.get(path) ?? null,
      read: async (file: ObsidianTFile) => {
        await host.beforeRead?.(file as TFile);
        return sources.get(file as TFile) ?? "";
      },
      process: async (file: ObsidianTFile, update: (source: string) => string) => {
        processCalls.push(file as TFile);
        await host.beforeProcess?.(file as TFile);
        if (host.failProcessPath === file.path) throw new Error("write failed");
        const current = sources.get(file as TFile) ?? "";
        const next = update(current);
        if (host.failAfterTransformPath === file.path) throw new Error("write failed after transform");
        sources.set(file as TFile, next);
        const match = /^\uFEFF?---[\t ]*(?:\r\n|\r|\n)([\s\S]*?)^(?:---|\.\.\.)[\t ]*(?=\r\n|\r|\n|$)/mu.exec(next);
        if (match !== null) frontmatters.set(file as TFile, parseDocument(match[1]!.replace(/\r(?!\n)/gu, "\n")).toJS() as Record<string, unknown>);
        await host.afterProcess?.(file as TFile);
        return next;
      },
    },
    metadataCache: {
      getFileCache: (file: ObsidianTFile) => ({ frontmatter: frontmatters.get(file as TFile) }),
    },
    workspace: {
      iterateAllLeaves: (callback: (leaf: { view: MarkdownView }) => void) => {
        for (const view of editors) callback({ view });
      },
    },
  } as unknown as App;
  return host;
}

function addSupportFile(host: MigrationHost, path: string, source: string): TFile {
  const file = testFile(path);
  host.supportFiles.set(path, file);
  host.sources.set(file, source);
  return file;
}

function recoveredPromotionFixture(sourceFilePath: string, tableId: string) {
  const slash = sourceFilePath.lastIndexOf("/");
  const parent = slash < 0 ? "" : sourceFilePath.slice(0, slash + 1);
  const manifestPath = `${parent}_structural-table-records/${tableId}/_promotion.json`;
  const replacementSource = promotedBase(tableId, "\n", manifestPath);
  const source = replacementSource
    .split("\n")
    .filter((line) => !line.startsWith("# structural-tables-promotion:")
      && !line.startsWith("# structural-tables-manifest:"))
    .join("\n");
  const manifestContent = `${JSON.stringify({
    version: 2,
    pluginVersion: "0.5.2",
    tableId,
    sourceFilePath,
    originalTableSource: "| Name |\n| --- |\n| Alice |",
    replacementSource,
    createdAt: "2026-10-05T00:00:00.000Z",
    records: [],
  }, null, 2)}\n`;
  return { source, manifestPath, manifestContent };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function legacyRecord(host: MigrationHost, path = "Record.md") {
  const file = testFile(path);
  host.files.push(file);
  const properties = { [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"], title: "Original" };
  host.frontmatters.set(file, properties);
  const source = yaml(properties, "Saved body\n");
  host.sources.set(file, source);
  return { file, source, properties };
}

function openEditor(host: MigrationHost, file: TFile, source: string) {
  let text = source;
  const view = Object.create(MarkdownView.prototype) as MarkdownView;
  Object.assign(view, { file, editor: { getValue: () => text } });
  host.editors.push(view);
  return { setValue: (value: string) => { text = value; } };
}

describe("legacy Base property migration", () => {
  it("migrates a markerless legacy Base only when its recovery manifest proves ownership", async () => {
    const host = migrationHost();
    const record = testFile("Folder/Records/Alice.md");
    const base = testFile("Folder/People.md");
    host.files.push(record, base);
    host.frontmatters.set(record, {
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      name: "Alice",
    });
    host.sources.set(record, yaml(host.frontmatters.get(record) ?? {}, "Kept body\n"));
    const recovered = recoveredPromotionFixture(base.path, "stb_people");
    host.sources.set(base, recovered.source);
    addSupportFile(host, recovered.manifestPath, recovered.manifestContent);
    const service = new BasePropertyMigrationService(host.app);

    const prepared = await service.prepare();
    expect(prepared).toMatchObject({ membershipNoteCount: 1, legacyBaseCount: 1 });
    await service.execute(prepared, false);

    expect(host.frontmatters.get(record)).toEqual({
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      name: "Alice",
    });
    expect(host.sources.get(base)).toContain('list(note["structural-tables"])');
    expect(host.sources.get(base)).not.toContain("note.structural_table_ids");
    expect((await service.prepare()).files).toHaveLength(0);
  });

  it("fails closed before changing membership when markerless Base ownership cannot be proven", async () => {
    const host = migrationHost();
    const record = testFile("Folder/Records/Alice.md");
    const base = testFile("Folder/People.md");
    host.files.push(record, base);
    const properties = { [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"], name: "Alice" };
    host.frontmatters.set(record, properties);
    const originalRecord = yaml(properties, "Kept body\n");
    host.sources.set(record, originalRecord);
    const recovered = recoveredPromotionFixture(base.path, "stb_people");
    host.sources.set(base, recovered.source);
    const service = new BasePropertyMigrationService(host.app);

    await expect(service.prepare()).rejects.toThrow("promotion manifest could not be found");
    expect(host.frontmatters.get(record)).toEqual(properties);
    expect(host.sources.get(record)).toBe(originalRecord);
    expect(host.sources.get(base)).toBe(recovered.source);
  });

  it("revalidates recovered Base ownership after preview before changing any file", async () => {
    const host = migrationHost();
    const record = testFile("Folder/Records/Alice.md");
    const base = testFile("Folder/People.md");
    host.files.push(record, base);
    const properties = { [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"], name: "Alice" };
    host.frontmatters.set(record, properties);
    const originalRecord = yaml(properties, "Kept body\n");
    host.sources.set(record, originalRecord);
    const recovered = recoveredPromotionFixture(base.path, "stb_people");
    host.sources.set(base, recovered.source);
    const manifestFile = addSupportFile(host, recovered.manifestPath, recovered.manifestContent);
    const service = new BasePropertyMigrationService(host.app);
    const prepared = await service.prepare();
    const manifest = JSON.parse(recovered.manifestContent) as Record<string, unknown>;
    host.sources.set(manifestFile, `${JSON.stringify({ ...manifest, sourceFilePath: "Folder/Other.md" }, null, 2)}\n`);

    await expect(service.execute(prepared, false)).rejects.toThrow("does not prove ownership");
    expect(host.frontmatters.get(record)).toEqual(properties);
    expect(host.sources.get(record)).toBe(originalRecord);
    expect(host.sources.get(base)).toBe(recovered.source);
  });

  it("rolls back a recovered markerless Base when a later write fails", async () => {
    const host = migrationHost();
    const record = testFile("Folder/Records/Alice.md");
    const base = testFile("Folder/People.md");
    const later = testFile("Later.md");
    host.files.push(record, base, later);
    const properties = { [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"], name: "Alice" };
    host.frontmatters.set(record, properties);
    const originalRecord = yaml(properties, "Kept body\n");
    host.sources.set(record, originalRecord);
    const recovered = recoveredPromotionFixture(base.path, "stb_people");
    host.sources.set(base, recovered.source);
    addSupportFile(host, recovered.manifestPath, recovered.manifestContent);
    host.sources.set(later, promotedBase("stb_later"));
    host.failProcessPath = later.path;
    const service = new BasePropertyMigrationService(host.app);

    await expect(service.execute(await service.prepare(), false))
      .rejects.toThrow("Every completed file was restored");

    expect(host.frontmatters.get(record)).toEqual(properties);
    expect(host.sources.get(record)).toContain("Kept body\n");
    expect(host.sources.get(base)).toBe(recovered.source);
  });

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

  it("revalidates the complete source inside the atomic property write", async () => {
    const host = migrationHost();
    const record = testFile("Records/Current.md");
    host.files.push(record);
    host.frontmatters.set(record, {
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_current"],
      [LEGACY_RECORD_ID_PROPERTY]: "str_current",
    });
    const original = yaml(host.frontmatters.get(record) ?? {});
    host.sources.set(record, original);
    const changed = yaml({ [LEGACY_RECORD_ID_PROPERTY]: "str_current" });
    host.beforeProcess = () => {
      host.sources.set(record, changed);
      host.frontmatters.set(record, { [LEGACY_RECORD_ID_PROPERTY]: "str_current" });
    };
    const service = new BasePropertyMigrationService(host.app);

    await expect(service.execute(await service.prepare(), true)).rejects.toThrow("changed during migration");
    expect(host.frontmatters.get(record)).toEqual({ [LEGACY_RECORD_ID_PROPERTY]: "str_current" });
    expect(host.sources.get(record)).toBe(changed);
  });

  it.each(
    ["\n", "\r\n", "\r"].flatMap((ending) =>
      ["HTML comment", "Obsidian comment", "frontmatter scalar"].map((protection) => ({ ending, protection }))),
  )("migrates only the real Base when a same-id example is protected by $protection / %j", async ({ ending, protection }) => {
    const host = migrationHost();
    const base = testFile("People.md");
    host.files.push(base);
    const legacy = promotedBase("stb_people", ending);
    const protectedExample = protection === "HTML comment"
      ? ["<!--", legacy, "-->"].join(ending)
      : protection === "Obsidian comment"
        ? ["%%", legacy, "%%"].join(ending)
        : ["---", "example: |", ...legacy.split(ending).map((line) => `  ${line}`), "---"].join(ending);
    const original = `${protectedExample}${ending}${ending}${legacy}`;
    host.sources.set(base, original);
    const service = new BasePropertyMigrationService(host.app);

    const prepared = await service.prepare();
    expect(prepared.legacyBaseCount).toBe(1);
    expect(prepared.files).toHaveLength(1);
    await service.execute(prepared, false);

    const migrated = host.sources.get(base) ?? "";
    expect(migrated.slice(0, protectedExample.length)).toBe(protectedExample);
    expect(migrated.slice(protectedExample.length)).toContain('list(note["structural-tables"])');
    expect(migrated.match(/note\.structural_table_ids/gu)).toHaveLength(1);
  });

  it("does not schedule a migration for a plugin-shaped Base nested in a longer Markdown fence", async () => {
    const host = migrationHost();
    const base = testFile("Example.md");
    host.files.push(base);
    const original = ["````markdown", promotedBase("stb_example"), "````"].join("\n");
    host.sources.set(base, original);
    const service = new BasePropertyMigrationService(host.app);

    const prepared = await service.prepare();
    expect(prepared.legacyBaseCount).toBe(0);
    expect(prepared.files).toEqual([]);
    expect(await service.execute(prepared, false)).toMatchObject({ fileCount: 0, legacyBaseCount: 0 });
    expect(host.sources.get(base)).toBe(original);
  });

  it.each(["\n", "\r\n", "\r"])(
    "migrates only the real Base after a raw literal PRE block with %j endings",
    async (ending) => {
      const host = migrationHost();
      const base = testFile("People.md");
      host.files.push(base);
      const legacy = promotedBase("stb_people", ending);
      const protectedExample = [
        '<PRE class="literal">',
        legacy,
        "</pRe>",
      ].join(ending);
      const original = `${protectedExample}${ending}${ending}${legacy}`;
      host.sources.set(base, original);
      const service = new BasePropertyMigrationService(host.app);

      const prepared = await service.prepare();
      expect(prepared.legacyBaseCount).toBe(1);
      expect(prepared.files).toHaveLength(1);
      await service.execute(prepared, false);

      const migrated = host.sources.get(base) ?? "";
      expect(migrated.slice(0, protectedExample.length)).toBe(protectedExample);
      expect(migrated.slice(protectedExample.length)).toContain('list(note["structural-tables"])');
      expect(migrated.match(/note\.structural_table_ids/gu)).toHaveLength(1);
    },
  );

  it.each(
    [
      ["pre", '<pre class="literal">', "</pre>"],
      ["script", '<script type="text/plain">', "</script>"],
      ["style", "<style", "</style>"],
      ["textarea", '<textarea data-kind="literal">', "</textarea>"],
    ].flatMap(([tag, opening, closing]) =>
      ["\n", "\r\n", "\r"].map((ending) => ({ tag, opening, closing, ending }))),
  )("keeps root raw %s examples protected across quote markers and migrates only the same-id real Base / %j", async ({ opening, closing, ending }) => {
    const host = migrationHost();
    const base = testFile("People.md");
    host.files.push(base);
    const legacy = promotedBase("stb_people", ending);
    const protectedExample = [opening, "> literal", legacy, closing].join(ending);
    const original = `${protectedExample}${ending}${ending}${legacy}`;
    host.sources.set(base, original);
    const migration = new BasePropertyMigrationService(host.app);

    const prepared = await migration.prepare();
    expect(prepared.legacyBaseCount).toBe(1);
    expect(prepared.files).toHaveLength(1);
    await migration.execute(prepared, false);

    const migrated = host.sources.get(base) ?? "";
    expect(migrated.slice(0, protectedExample.length)).toBe(protectedExample);
    expect(migrated.slice(protectedExample.length)).toContain('list(note["structural-tables"])');
    expect(migrated.match(/note\.structural_table_ids/gu)).toHaveLength(1);
  });

  it.each(
    [
      ["pre", '<pre class="literal">'],
      ["script", '<script type="text/plain">'],
      ["style", "<style"],
      ["textarea", '<textarea data-kind="literal">'],
    ].flatMap(([tag, opening]) =>
      ["\n", "\r\n", "\r"].map((ending) => ({ tag, opening, ending }))),
  )("does not schedule migration for one Base inside unclosed raw literal %s block / %j", async ({ opening, ending }) => {
    const host = migrationHost();
    const base = testFile("Example.md");
    host.files.push(base);
    const original = [opening, "> literal", promotedBase("stb_example", ending)].join(ending);
    host.sources.set(base, original);
    const migration = new BasePropertyMigrationService(host.app);

    const prepared = await migration.prepare();
    expect(prepared.legacyBaseCount).toBe(0);
    expect(prepared.files).toEqual([]);
    expect(await migration.execute(prepared, false)).toMatchObject({ fileCount: 0, legacyBaseCount: 0 });
    expect(host.sources.get(base)).toBe(original);
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
      host.sources.set(record, yaml(current ?? {}, "Body\nConcurrent body\n"));
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

  it.each(["prepare", "preflight", "write"])("refuses a same-path same-content replacement during %s", async (phase) => {
    const host = migrationHost();
    const { file, source, properties } = legacyRecord(host);
    const service = new BasePropertyMigrationService(host.app);
    const replace = () => {
      const replacement = testFile(file.path);
      host.files.splice(host.files.indexOf(file), 1, replacement);
      host.sources.set(replacement, source);
      host.frontmatters.set(replacement, { ...properties });
    };
    if (phase === "prepare") {
      host.beforeRead = replace;
      await expect(service.prepare()).rejects.toThrow("replaced");
    } else {
      const prepared = await service.prepare();
      if (phase === "preflight") host.beforeRead = replace;
      else host.beforeProcess = replace;
      await expect(service.execute(prepared, false)).rejects.toThrow("replaced");
    }
    expect(host.sources.get(file)).toBe(source);
    expect(host.sources.get(host.files[0]!)).toBe(source);
  });

  it("keeps the preview's original path when the note moves while its read is pending", async () => {
    const host = migrationHost();
    const { file, source } = legacyRecord(host);
    host.beforeRead = () => { file.path = "Renamed.md"; };
    const service = new BasePropertyMigrationService(host.app);
    await expect(service.prepare()).rejects.toThrow("moved");
    expect(host.processCalls).toEqual([]);
    expect(host.sources.get(file)).toBe(source);
  });

  it.each(["prepare", "confirm", "callback"])("refuses unsaved text in a second pane at %s", async (phase) => {
    const host = migrationHost();
    const { file, source } = legacyRecord(host);
    openEditor(host, file, source);
    const second = openEditor(host, file, phase === "prepare" ? `${source}Unsaved` : source);
    const service = new BasePropertyMigrationService(host.app);
    if (phase === "prepare") await expect(service.prepare()).rejects.toThrow("unsaved or conflicting");
    else {
      const prepared = await service.prepare();
      if (phase === "confirm") second.setValue(`${source}Unsaved`);
      else host.beforeProcess = () => { second.setValue(`${source}Unsaved`); };
      await expect(service.execute(prepared, false)).rejects.toThrow("unsaved or conflicting");
    }
    expect(host.sources.get(file)).toBe(source);
    expect(host.frontmatters.get(file)?.[LEGACY_TABLE_MEMBERSHIP_PROPERTY]).toEqual(["stb_people"]);
  });

  it.each(["prepare", "preflight", "callback"])("stops after a pending %s completes following unload", async (phase) => {
    const host = migrationHost();
    const { file, source } = legacyRecord(host);
    const service = new BasePropertyMigrationService(host.app);
    const entered = deferred();
    const gate = deferred();
    const pause = async () => { entered.release(); await gate.promise; };
    let operation: Promise<unknown>;
    if (phase === "prepare") {
      host.beforeRead = pause;
      operation = service.prepare();
    } else {
      const prepared = await service.prepare();
      if (phase === "preflight") host.beforeRead = pause;
      else host.beforeProcess = pause;
      operation = service.execute(prepared, false);
    }
    const rejected = expect(operation).rejects.toThrow("unloaded");
    await entered.promise;
    service.dispose();
    gate.release();
    await rejected;
    expect(host.sources.get(file)).toBe(source);
    expect(host.frontmatters.get(file)?.[LEGACY_TABLE_MEMBERSHIP_PROPERTY]).toEqual(["stb_people"]);
  });

  it("retains the completed file and dispatches neither the next migration nor rollback after unload", async () => {
    const host = migrationHost();
    const first = legacyRecord(host, "First.md");
    const second = legacyRecord(host, "Second.md");
    const service = new BasePropertyMigrationService(host.app);
    const prepared = await service.prepare();
    host.afterProcess = (file) => { if (file === first.file) service.dispose(); };
    await expect(service.execute(prepared, false)).rejects.toThrow("Completed changes were retained in 1 file(s): First.md");
    expect(host.processCalls).toEqual([first.file]);
    expect(host.frontmatters.get(first.file)?.[TABLE_MEMBERSHIP_PROPERTY]).toEqual(["stb_people"]);
    expect(host.sources.get(second.file)).toBe(second.source);
    delete host.afterProcess;
    const replacementService = new BasePropertyMigrationService(host.app);
    await expect(replacementService.execute(await replacementService.prepare(), false)).resolves.toMatchObject({ fileCount: 1 });
  });

  it("refuses a retained preview and further discovery on an already disposed service", async () => {
    const host = migrationHost();
    legacyRecord(host);
    const service = new BasePropertyMigrationService(host.app);
    const prepared = await service.prepare();
    service.dispose();
    await expect(service.execute(prepared, false)).rejects.toThrow("unloaded");
    await expect(service.prepare()).rejects.toThrow("unloaded");
    expect(host.processCalls).toEqual([]);
  });

  it.each(["replacement", "dirty", "owned-edit"])("preserves concurrent %s changes during rollback", async (conflict) => {
    const host = migrationHost();
    const first = legacyRecord(host, "First.md");
    const second = legacyRecord(host, "Second.md");
    const service = new BasePropertyMigrationService(host.app);
    const prepared = await service.prepare();
    let replacement: TFile | null = null;
    host.beforeProcess = (file) => {
      if (file !== second.file) return;
      if (conflict === "replacement") {
        replacement = testFile(first.file.path);
        host.files.splice(0, 1, replacement);
        host.sources.set(replacement, host.sources.get(first.file)!);
      } else if (conflict === "dirty") openEditor(host, first.file, `${host.sources.get(first.file)}Unsaved`);
      else host.sources.set(first.file, host.sources.get(first.file)!.replace("stb_people", "stb_user"));
      throw new Error("later write failed");
    };
    await expect(service.execute(prepared, false)).rejects.toThrow("Rollback needs attention");
    expect(host.sources.get(first.file)).toContain("structural-tables:");
    expect(host.sources.get(second.file)).toBe(second.source);
    if (replacement !== null) expect(host.sources.get(replacement)).toBe(host.sources.get(first.file));
    if (conflict === "owned-edit") expect(host.sources.get(first.file)).toContain("stb_user");
  });

  it.each(["\n", "\r\n", "\r"])("preserves unrelated YAML bytes, unknown tags, aliases and large integers with %j", async (ending) => {
    const host = migrationHost();
    const { file } = legacyRecord(host);
    const source = [
      "---", "# owned property", '"structural_table_ids": [stb_people] # list comment',
      "empty:", "900: value", "huge: 9007199254740993123456789", "date: 2026-10-25",
      "anchor: &value {custom: [1, 2]}", "alias: *value", "tagged: !unknown keep", "---", "Body", "",
    ].join(ending);
    host.sources.set(file, source);
    const service = new BasePropertyMigrationService(host.app);
    await service.execute(await service.prepare(), false);
    expect(host.sources.get(file)).toBe(source.replace('"structural_table_ids"', "structural-tables"));
  });

  it.each([false, true])("patches a flow mapping without changing other bytes and restores after failure=%s", async (failure) => {
    const host = migrationHost();
    const { file } = legacyRecord(host);
    const later = legacyRecord(host, "Later.md");
    const properties = {
      [TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"],
      [LEGACY_RECORD_ID_PROPERTY]: "str_record",
    };
    host.frontmatters.set(file, properties);
    const source = '---\n{structural_table_ids: [stb_people], huge: 9007199254740993123456789, structural-tables: [stb_people], structural_record_id: str_record}\n---\nBody\n';
    host.sources.set(file, source);
    if (failure) host.failProcessPath = later.file.path;
    const service = new BasePropertyMigrationService(host.app);
    if (failure) {
      await expect(service.execute(await service.prepare(), true)).rejects.toThrow("Every completed file was restored");
      expect(host.frontmatters.get(file)?.[LEGACY_TABLE_MEMBERSHIP_PROPERTY]).toEqual(["stb_people"]);
      expect(host.frontmatters.get(file)?.[LEGACY_RECORD_ID_PROPERTY]).toBe("str_record");
    } else {
      await service.execute(await service.prepare(), true);
      expect(host.frontmatters.get(file)?.[LEGACY_TABLE_MEMBERSHIP_PROPERTY]).toBeUndefined();
      expect(host.frontmatters.get(file)?.[LEGACY_RECORD_ID_PROPERTY]).toBeUndefined();
    }
    expect(host.sources.get(file)).toContain("huge: 9007199254740993123456789");
    expect(host.sources.get(file)).toContain("\nBody\n");
  });

  it.each([",", ", # collection comment\n"])("restores a flow mapping with trailing separator %j", async (tail) => {
    const host = migrationHost();
    const { file } = legacyRecord(host);
    const later = legacyRecord(host, "Later.md");
    const mapping = `{structural_table_ids: [stb_people], structural_record_id: str_record${tail}}`;
    const source = `---\n${mapping}\n---\nBody\n`;
    host.sources.set(file, source);
    host.frontmatters.set(file, parseDocument(mapping).toJS() as Record<string, unknown>);
    host.failProcessPath = later.file.path;
    const service = new BasePropertyMigrationService(host.app);
    await expect(service.execute(await service.prepare(), true)).rejects.toThrow("Every completed file was restored");
    expect(host.sources.get(file)).toBe(source);
    expect(host.frontmatters.get(file)?.[LEGACY_RECORD_ID_PROPERTY]).toBe("str_record");
  });

  it.each(["anchor", "tag", "explicit"].flatMap((prefix) => ["rename", "duplicate", "record"].flatMap((operation) => (
    (prefix === "explicit" ? [false] : [false, true]).map((flow) => ({ prefix, operation, flow }))
  ))))("refuses a $prefix key before any write ($operation, flow=$flow)", async ({ prefix, operation, flow }) => {
    const host = migrationHost();
    const first = legacyRecord(host, "First.md");
    const { file } = legacyRecord(host, "Prefixed.md");
    const key = operation === "record" ? LEGACY_RECORD_ID_PROPERTY : LEGACY_TABLE_MEMBERSHIP_PROPERTY;
    const value = operation === "record" ? "str_record" : "[stb_people]";
    const owned = prefix === "explicit" ? `? ${key}\n: ${value}`
      : `${prefix === "anchor" ? "&key" : "!!str"} ${key}: ${value}`;
    const fields = [
      ...(operation === "rename" ? [] : ["structural-tables: [stb_people]"]),
      owned, "title: keep", ...(prefix === "anchor" ? ["other: *key"] : []),
    ];
    const mapping = flow ? `{${fields.join(", ")}}` : fields.join("\n");
    const source = `---\n${mapping}\n---\nBody\n`;
    host.sources.set(file, source);
    host.frontmatters.set(file, parseDocument(mapping).toJS() as Record<string, unknown>);
    const service = new BasePropertyMigrationService(host.app);
    await expect(service.execute(await service.prepare(), true)).rejects.toThrow("prefixed YAML property key");
    expect(host.processCalls).toEqual([]);
    expect(host.sources.get(first.file)).toBe(first.source);
    expect(host.sources.get(file)).toBe(source);
  });

  it.each(["&key title: keep\nother: *key", "!!str title: keep", "? title\n: keep"]
    .flatMap((unrelated) => [false, true].map((failure) => ({ unrelated, failure }))))(
    "preserves unrelated key prefixes during migration and rollback (failure=$failure, $unrelated)", async ({ unrelated, failure }) => {
      const host = migrationHost();
      const { file } = legacyRecord(host);
      const later = legacyRecord(host, "Later.md");
      const mapping = `structural_table_ids: &members [stb_people]\nstructural_record_id: str_record\n${unrelated}\nrelated: *members\n`;
      const source = `---\n${mapping}---\nBody\n`;
      host.sources.set(file, source);
      host.frontmatters.set(file, parseDocument(mapping).toJS() as Record<string, unknown>);
      if (failure) host.failProcessPath = later.file.path;
      const service = new BasePropertyMigrationService(host.app);
      if (failure) {
        await expect(service.execute(await service.prepare(), true)).rejects.toThrow("Every completed file was restored");
        expect(host.sources.get(file)).toBe(source);
      } else {
        await service.execute(await service.prepare(), true);
        expect(host.sources.get(file)).toBe(source.replace("structural_table_ids", "structural-tables").replace("structural_record_id: str_record\n", ""));
      }
      expect(host.frontmatters.get(file)?.related).toEqual(["stb_people"]);
      expect(host.frontmatters.get(file)?.title).toBe("keep");
    },
  );

});
