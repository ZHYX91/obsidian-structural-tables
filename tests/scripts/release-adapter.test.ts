import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error The JavaScript release adapter is exercised directly.
import { releaseConfig, verifyReleaseCorePin } from "../../scripts/release.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vendorDirectory = path.join(projectRoot, "scripts", "vendor");
const runtimePath = path.join(vendorDirectory, "obsidian-release-core.mjs");
const lockPath = path.join(vendorDirectory, "obsidian-release-core.lock.json");

describe("release adapter", () => {
  it("declares only the repository-specific release policy", () => {
    expect(releaseConfig).toEqual({
      schemaVersion: 1,
      plugin: {
        id: "structural-tables",
        name: "Structural Tables",
        minAppVersion: "1.12.7",
        isDesktopOnly: false,
      },
      assets: { styles: "required" },
      publication: { repository: "ZHYX91/obsidian-structural-tables" },
    });
    expect(Object.isFrozen(releaseConfig)).toBe(true);
    expect(Object.isFrozen(releaseConfig.plugin)).toBe(true);
    expect(Object.isFrozen(releaseConfig.assets)).toBe(true);
    expect(Object.isFrozen(releaseConfig.publication)).toBe(true);
  });

  it("binds the exact standalone vendored runtime to its canonical lock", async () => {
    const runtime = readFileSync(runtimePath);
    const lockSource = readFileSync(lockPath, "utf8");
    const lock = JSON.parse(lockSource) as Record<string, unknown>;
    const runtimeDigest = createHash("sha256").update(runtime).digest("hex");

    expect(lockSource).toBe(`${JSON.stringify(lock, null, 2)}\n`);
    expect(lock).toEqual({
      schemaVersion: 1,
      package: "@zhyx/obsidian-release-core",
      version: "1.0.0",
      runtime: "obsidian-release-core.mjs",
      sha256: runtimeDigest,
    });
    expect(runtimeDigest).toMatch(/^[0-9a-f]{64}$/u);
    await expect(verifyReleaseCorePin()).resolves.toBeUndefined();
  });

  it("has a self-contained import closure in a standalone clone", () => {
    const isolatedRoot = mkdtempSync(path.join(tmpdir(), "structural-tables-release-adapter-"));
    try {
      const isolatedScripts = path.join(isolatedRoot, "scripts");
      const isolatedVendor = path.join(isolatedScripts, "vendor");
      mkdirSync(isolatedVendor, { recursive: true });
      copyFileSync(path.join(projectRoot, "release.config.mjs"), path.join(
        isolatedRoot,
        "release.config.mjs",
      ));
      copyFileSync(path.join(projectRoot, "scripts", "release.mjs"), path.join(
        isolatedScripts,
        "release.mjs",
      ));
      copyFileSync(runtimePath, path.join(isolatedVendor, "obsidian-release-core.mjs"));
      copyFileSync(lockPath, path.join(isolatedVendor, "obsidian-release-core.lock.json"));

      const result = spawnSync(
        process.execPath,
        [path.join(isolatedScripts, "release.mjs")],
        {
          cwd: isolatedRoot,
          encoding: "utf8",
          windowsHide: true,
        },
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Release command is required");
      expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    } finally {
      rmSync(isolatedRoot, { force: true, recursive: true });
    }
  });

  it("does not import workspace, sibling-repository, or host-specific paths", () => {
    const adapter = readFileSync(path.join(projectRoot, "scripts", "release.mjs"), "utf8");
    const imports = [...adapter.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]);

    expect(imports).toEqual([
      "node:fs/promises",
      "node:path",
      "node:url",
      "../release.config.mjs",
      "./vendor/obsidian-release-core.mjs",
    ]);
    expect(adapter).not.toMatch(/Obsidian-Plugins|obsidian-plugin-workspace|[A-Za-z]:\\/u);
  });
});
