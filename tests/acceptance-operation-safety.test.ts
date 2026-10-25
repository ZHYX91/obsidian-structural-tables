import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as host from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { TFile } from "./mocks/obsidian";

const script = readFileSync("acceptance/fixtures/.obsidian/plugins/structural-tables-acceptance-provider/main.js", "utf8");
interface Provider {
  app: unknown;
  safetyArm: (mode: string) => void;
  safetyRestore?: () => void;
  safetyRecord: (stage: string, details: unknown) => Promise<void>;
}

function fixture() {
  const module = { exports: {} };
  runInNewContext(script, { require: () => host, module });
  const provider = new (module.exports as new () => Provider)();
  const file = new TFile("Operation safety A.md");
  const other = new TFile("Unrelated.md");
  const files = new Map([[file.path, file], [other.path, other]]);
  const sources = new Map([[file, "original fixture"], [other, "unrelated"]]);
  const process = vi.fn(async (target: TFile, callback: (source: string) => string) => {
    const next = callback(sources.get(target)!); sources.set(target, next); return next;
  });
  const vault = {
    process,
    read: vi.fn(async (target: TFile) => sources.get(target)!),
    rename: vi.fn(async (target: TFile, path: string) => { files.delete(target.path); target.path = path; files.set(path, target); }),
    create: vi.fn(async (path: string, source: string) => { const replacement = new TFile(path); files.set(path, replacement); sources.set(replacement, source); return replacement; }),
    append: vi.fn(async (target: TFile, source: string) => { sources.set(target, sources.get(target)! + source); }),
    getAbstractFileByPath: (path: string) => files.get(path),
  };
  provider.app = { vault };
  const observations: Array<{ stage: string; details: unknown }> = [];
  provider.safetyRecord = async (stage, details) => { observations.push({ stage, details }); };
  return { provider, file, other, files, sources, process, vault, observations };
}

describe("fixture-owned operation safety setup", () => {
  it("passes unrelated files through and restores the original host API", async () => {
    const f = fixture(); f.provider.safetyArm("replace-at-process");
    await f.vault.process(f.other, source => `${source}!`);
    expect(f.sources.get(f.other)).toBe("unrelated!"); expect(f.vault.rename).not.toHaveBeenCalled();
    f.provider.safetyRestore!(); expect(f.vault.process).toBe(f.process);
    await f.vault.process(f.file, source => source); expect(f.vault.rename).not.toHaveBeenCalled();
  });

  it("replaces only the declared target immediately before the actual process callback", async () => {
    const f = fixture(); f.provider.safetyArm("replace-at-process");
    await expect(f.vault.process(f.file, () => {
      expect(f.files.get("Operation safety A.md")).not.toBe(f.file);
      expect(f.sources.get(f.files.get("Operation safety A.md")!)).toBe("original fixture");
      throw new Error("Product ownership refusal");
    })).rejects.toThrow("Product ownership refusal");
    expect(f.observations).toEqual([{ stage: "same-path-identical-replacement", details: {
      mode: "replace-at-process", originalPath: "Operation safety A.md", retainedPath: "Operation safety A.md.retained-original", sameTFile: false,
    } }]);
    expect(f.sources.get(f.file)).toBe("original fixture"); f.provider.safetyRestore!();
  });

  it("fails the second fixture write after appending an external edit, then permits compensation", async () => {
    const f = fixture(); const second = new TFile("Operation safety B.md"); f.sources.set(second, "second original");
    f.provider.safetyArm("rollback-external-edit");
    await f.vault.process(f.file, () => "migrated");
    await expect(f.vault.process(second, () => "should not run")).rejects.toThrow("second migration write failure");
    expect(f.sources.get(f.file)).toContain("External edit after migration");
    expect(f.sources.get(second)).toBe("second original");
    await f.vault.process(f.file, source => source.replace("migrated", "original fixture"));
    expect(f.sources.get(f.file)).toContain("original fixture\nExternal edit");
    expect(f.observations.map(entry => entry.stage)).toEqual(["first-migration-write", "external-edit-before-second-write-failure"]);
    f.provider.safetyRestore!();
  });
});
