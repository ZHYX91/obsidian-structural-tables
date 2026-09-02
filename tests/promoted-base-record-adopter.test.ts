import type { App, CachedMetadata, TFile as ObsidianTFile } from "obsidian";
import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  PromotedBaseRecordAdopter,
  type BaseRecordAdoptionReporter,
} from "../src/app/promoted-base-record-adopter";
import {
  LEGACY_RECORD_ID_PROPERTY,
  LEGACY_TABLE_MEMBERSHIP_PROPERTY,
  TABLE_MEMBERSHIP_PROPERTY,
  type TableMembershipProperty,
} from "../src/core/base-promotion";

function promotedBase(
  tableId: string,
  membershipProperty: TableMembershipProperty = TABLE_MEMBERSHIP_PROPERTY,
): string {
  const membership = membershipProperty === TABLE_MEMBERSHIP_PROPERTY
    ? 'note["structural-tables"]'
    : "note.structural_table_ids";
  return `\`\`\`base
# structural-tables-promotion: ${tableId}
# structural-tables-manifest: "Records/${tableId}/_promotion.json"
filters:
  and:
    - 'list(${membership}).contains("${tableId}")'
\`\`\``;
}

function metadata(
  tableIds: string[],
  membershipProperty: TableMembershipProperty = TABLE_MEMBERSHIP_PROPERTY,
  additions: Record<string, unknown> = {},
): CachedMetadata {
  return {
    frontmatter: { [membershipProperty]: tableIds, ...additions },
  } as unknown as CachedMetadata;
}

function testFile(path: string): TFile {
  const file = Object.create(TFile.prototype) as TFile;
  const name = path.split("/").pop() ?? "";
  return Object.assign(file, {
    path,
    name,
    basename: name.replace(/\.[^.]+$/u, ""),
    extension: path.includes(".") ? path.split(".").pop() ?? "" : "",
    parent: null,
  });
}

interface TestContext {
  adopter: PromotedBaseRecordAdopter;
  active: { file: TFile | null };
  sources: Map<TFile, string>;
  markdownFiles: TFile[];
  adoptCreatedRecord: ReturnType<typeof vi.fn>;
  reporter: BaseRecordAdoptionReporter & {
    adopted: ReturnType<typeof vi.fn>;
    ambiguous: ReturnType<typeof vi.fn>;
    incompatible: ReturnType<typeof vi.fn>;
    failed: ReturnType<typeof vi.fn>;
  };
}

function context(now: () => number = () => 0): TestContext {
  const active = { file: null as TFile | null };
  const sources = new Map<TFile, string>();
  const markdownFiles: TFile[] = [];
  const adoptCreatedRecord = vi.fn(async (file: ObsidianTFile) => ({
    file,
    adopted: true,
    moved: true,
  }));
  const reporter = {
    adopted: vi.fn(),
    ambiguous: vi.fn(),
    incompatible: vi.fn(),
    failed: vi.fn(),
  };
  const app = {
    workspace: { getActiveFile: () => active.file },
    metadataCache: { getFileCache: () => null },
    vault: {
      getMarkdownFiles: () => markdownFiles,
      cachedRead: async (file: TFile) => sources.get(file) ?? "",
    },
  } as unknown as App;
  const adopter = new PromotedBaseRecordAdopter(
    app,
    { adoptCreatedRecord },
    reporter,
    now,
  );
  return { adopter, active, sources, markdownFiles, adoptCreatedRecord, reporter };
}

describe("native Base record adoption", () => {
  it("uses the active generated Base as provenance and adopts only once", async () => {
    const test = context();
    const host = testFile("Folder/People.md");
    const record = testFile("Untitled.md");
    test.active.file = host;
    test.sources.set(host, promotedBase("stb_people"));
    test.markdownFiles.push(host, record);

    test.adopter.handleCreated(record);
    await Promise.all([
      test.adopter.handleMetadataChanged(record, metadata(["stb_people"])),
      test.adopter.handleMetadataChanged(record, metadata(["stb_people"])),
    ]);

    expect(test.adoptCreatedRecord).toHaveBeenCalledTimes(1);
    expect(test.adoptCreatedRecord).toHaveBeenCalledWith(
      record,
      host,
      expect.objectContaining({ tableId: "stb_people" }),
      true,
    );
    expect(test.reporter.adopted).toHaveBeenCalledTimes(1);
    expect(test.reporter.failed).not.toHaveBeenCalled();
  });

  it("uses the host's current folder but respects a record the user already moved", async () => {
    const test = context();
    const host = testFile("Folder/People.md");
    const record = testFile("Untitled.md");
    test.active.file = host;
    test.sources.set(host, promotedBase("stb_people"));
    test.adopter.handleCreated(record);
    Object.assign(host, { path: "Moved/People.md" });
    Object.assign(record, { path: "People/Sales/Alice.md" });

    await test.adopter.handleMetadataChanged(record, metadata(["stb_people"]));

    expect(test.adoptCreatedRecord).toHaveBeenCalledWith(
      record,
      expect.objectContaining({ path: "Moved/People.md" }),
      expect.objectContaining({ tableId: "stb_people" }),
      false,
    );
  });

  it("finds a unique generated Base when Obsidian makes the new note active", async () => {
    const test = context();
    const host = testFile("Folder/People.md");
    const record = testFile("Untitled.md");
    test.active.file = record;
    test.sources.set(host, promotedBase("stb_people"));
    test.markdownFiles.push(record, host);

    test.adopter.handleCreated(record);
    await test.adopter.handleMetadataChanged(record, metadata(["stb_people"]));

    expect(test.adoptCreatedRecord).toHaveBeenCalledWith(
      record,
      host,
      expect.objectContaining({ tableId: "stb_people" }),
      true,
    );
  });

  it("leaves unknown and ambiguous notes untouched", async () => {
    const test = context();
    const host = testFile("Folder/People.md");
    test.active.file = host;
    test.sources.set(host, `${promotedBase("stb_one")}\n\n${promotedBase("stb_two")}`);

    const unknown = testFile("Unknown.md");
    test.adopter.handleCreated(unknown);
    await test.adopter.handleMetadataChanged(unknown, metadata(["stb_unknown"]));

    const ambiguous = testFile("Ambiguous.md");
    test.adopter.handleCreated(ambiguous);
    await test.adopter.handleMetadataChanged(ambiguous, metadata(["stb_one", "stb_two"]));

    expect(test.adoptCreatedRecord).not.toHaveBeenCalled();
    expect(test.reporter.ambiguous).toHaveBeenCalledOnce();
    expect(test.reporter.ambiguous).toHaveBeenCalledWith(ambiguous);
  });

  it("accepts legacy membership and ignores the retired record ID", async () => {
    const test = context();
    const host = testFile("Folder/People.md");
    const record = testFile("Untitled.md");
    test.active.file = host;
    test.sources.set(host, promotedBase("stb_people", LEGACY_TABLE_MEMBERSHIP_PROPERTY));

    test.adopter.handleCreated(record);
    await test.adopter.handleMetadataChanged(record, metadata(
      ["stb_people"],
      LEGACY_TABLE_MEMBERSHIP_PROPERTY,
      { [LEGACY_RECORD_ID_PROPERTY]: "str_existing" },
    ));

    expect(test.adoptCreatedRecord).toHaveBeenCalledOnce();
  });

  it("accepts equivalent dual membership and refuses conflicts or malformed lists", async () => {
    const test = context();
    const host = testFile("Folder/People.md");
    test.active.file = host;
    test.sources.set(host, promotedBase("stb_people"));

    const equivalent = testFile("Equivalent.md");
    test.adopter.handleCreated(equivalent);
    await test.adopter.handleMetadataChanged(equivalent, metadata(
      ["stb_people"],
      TABLE_MEMBERSHIP_PROPERTY,
      { [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_people"] },
    ));

    const conflicting = testFile("Conflicting.md");
    test.adopter.handleCreated(conflicting);
    await test.adopter.handleMetadataChanged(conflicting, metadata(
      ["stb_people"],
      TABLE_MEMBERSHIP_PROPERTY,
      { [LEGACY_TABLE_MEMBERSHIP_PROPERTY]: ["stb_other"] },
    ));

    const malformed = testFile("Malformed.md");
    test.adopter.handleCreated(malformed);
    await test.adopter.handleMetadataChanged(malformed, {
      frontmatter: { [TABLE_MEMBERSHIP_PROPERTY]: "stb_people" },
    } as unknown as CachedMetadata);

    expect(test.adoptCreatedRecord).toHaveBeenCalledTimes(1);
    expect(test.reporter.incompatible).toHaveBeenCalledTimes(2);
    expect(test.reporter.incompatible).toHaveBeenCalledWith(conflicting);
    expect(test.reporter.incompatible).toHaveBeenCalledWith(malformed);
  });

  it("ignores candidates after the short native-create window", async () => {
    let time = 0;
    const test = context(() => time);
    const host = testFile("Folder/People.md");
    const record = testFile("Untitled.md");
    test.active.file = host;
    test.sources.set(host, promotedBase("stb_people"));
    test.adopter.handleCreated(record);
    time = 30_001;

    await test.adopter.handleMetadataChanged(record, metadata(["stb_people"]));

    expect(test.adoptCreatedRecord).not.toHaveBeenCalled();
  });

  it("reports a failed move without retrying the same new note", async () => {
    const test = context();
    const host = testFile("Folder/People.md");
    const record = testFile("Untitled.md");
    test.active.file = host;
    test.sources.set(host, promotedBase("stb_people"));
    test.adoptCreatedRecord.mockRejectedValueOnce(new Error("move failed"));
    test.adopter.handleCreated(record);

    await test.adopter.handleMetadataChanged(record, metadata(["stb_people"]));
    await test.adopter.handleMetadataChanged(record, metadata(["stb_people"]));

    expect(test.adoptCreatedRecord).toHaveBeenCalledTimes(1);
    expect(test.reporter.failed).toHaveBeenCalledWith(record, expect.any(Error));
  });
});
