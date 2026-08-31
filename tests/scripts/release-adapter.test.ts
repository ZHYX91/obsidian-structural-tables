import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error The executable release adapter is plain ESM.
import { releaseConfig, verifyReleaseCorePin } from "../../scripts/release.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vendorRoot = path.join(projectRoot, "scripts", "vendor");
const runtimePath = path.join(vendorRoot, "obsidian-release-core.mjs");
const lockPath = path.join(vendorRoot, "obsidian-release-core.lock.json");

describe("thin release adapter", () => {
  it("exposes the strict repository-local v3 declaration", () => {
    expect(releaseConfig).toEqual({
      schemaVersion: 2,
      plugin: {
        id: "structural-tables",
        name: "Structural Tables",
        minAppVersion: "1.12.7",
        isDesktopOnly: false,
      },
      assets: { styles: "required" },
      publication: { repository: "ZHYX91/obsidian-structural-tables" },
      build: {
        node: "24.19.0",
        packageManager: "npm@11.17.0",
        installCommand: "npm ci --no-audit --no-fund",
        verifyCommand: "npm run release:check",
        workflow: ".github/workflows/release.yml",
      },
      acceptance: { scenarioContract: "acceptance/product-scenarios.json" },
      paths: {
        manifest: "manifest.json",
        package: "package.json",
        packageLock: "package-lock.json",
        versions: "versions.json",
        dist: "dist",
        nodeVersion: ".node-version",
      },
    });
    expect(Object.isFrozen(releaseConfig)).toBe(true);
    expect(Object.isFrozen(releaseConfig.build)).toBe(true);
    expect(Object.isFrozen(releaseConfig.acceptance)).toBe(true);
  });

  it("binds release-core 2.0 bytes to the schema-2 lock", async () => {
    const runtime = readFileSync(runtimePath);
    const lockSource = readFileSync(lockPath, "utf8");
    const lock = JSON.parse(lockSource) as Record<string, unknown>;
    const digest = createHash("sha256").update(runtime).digest("hex");
    expect(lockSource).toBe(`${JSON.stringify(lock, null, 2)}\n`);
    expect(lock).toEqual({
      schemaVersion: 2,
      package: "@zhyx/obsidian-release-core",
      version: "2.0.0",
      runtime: "obsidian-release-core.mjs",
      sha256: digest,
    });
    await expect(verifyReleaseCorePin()).resolves.toBeUndefined();
  });

  it("is thin, built-in-only, and independently loadable", () => {
    const adapter = readFileSync(path.join(projectRoot, "scripts", "release.mjs"), "utf8");
    const runtime = readFileSync(runtimePath, "utf8");
    expect(adapter.split(/\r?\n/u).length).toBeLessThan(20);
    expect([...adapter.matchAll(/from "([^"]+)"/gu)].map((match) => match[1])).toEqual([
      "../release.config.mjs",
      "./vendor/obsidian-release-core.mjs",
    ]);
    for (const match of runtime.matchAll(/\bfrom\s+["']([^"']+)["']/gu)) {
      expect(match[1]).toMatch(/^node:/u);
    }
    expect(`${adapter}\n${runtime}`).not.toMatch(
      /(?:[A-Za-z]:\\|\.\.\/obsidian-)/u,
    );

    const isolatedRoot = mkdtempSync(path.join(tmpdir(), "structural-tables-release-adapter-"));
    try {
      const scripts = path.join(isolatedRoot, "scripts");
      const vendor = path.join(scripts, "vendor");
      mkdirSync(vendor, { recursive: true });
      copyFileSync(path.join(projectRoot, "release.config.mjs"),
        path.join(isolatedRoot, "release.config.mjs"));
      copyFileSync(path.join(projectRoot, "scripts", "release.mjs"),
        path.join(scripts, "release.mjs"));
      copyFileSync(runtimePath, path.join(vendor, "obsidian-release-core.mjs"));
      copyFileSync(lockPath, path.join(vendor, "obsidian-release-core.lock.json"));
      const result = spawnSync(process.execPath, [path.join(scripts, "release.mjs")], {
        cwd: isolatedRoot,
        encoding: "utf8",
        windowsHide: true,
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Release command is required");
      expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    } finally {
      rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });
});
