import type { App, CachedMetadata, TFile as ObsidianTFile } from "obsidian";
import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  PromotedBaseRecordAdopter,
  type BaseRecordAdoptionReporter,
} from "../src/app/promoted-base-record-adopter";

function promotedBase(tableId: string): string {
  return `\`\`\`base
# structural-tables-promotion: ${tableId}
# structural-tables-manifest: "Records/${tableId}/_promotion.json"
filters:
  and:
    - 'list(note.structural_table_ids).contains("${tableId}")'
\`\`\``;
}

function metadata(tableIds: string[], recordId?: string): CachedMetadata {
  const frontmatter: Record<string, unknown> = { structural_table_ids: tableIds };
  if (recordId !== undefined) frontmatter.structural_record_id = recordId;
  return { frontmatter } as unknown as CachedMetadata;
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

  it("leaves unknown, ambiguous, and already identified notes untouched", async () => {
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

    const identified = testFile("Identified.md");
    test.adopter.handleCreated(identified);
    await test.adopter.handleMetadataChanged(identified, metadata(["stb_one"], "str_existing"));

    expect(test.adoptCreatedRecord).not.toHaveBeenCalled();
    expect(test.reporter.ambiguous).toHaveBeenCalledOnce();
    expect(test.reporter.ambiguous).toHaveBeenCalledWith(ambiguous);
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
