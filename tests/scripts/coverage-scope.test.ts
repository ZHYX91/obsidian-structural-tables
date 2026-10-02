import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const checker = path.resolve("scripts/check-coverage-scope.mjs");
const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(tmpdir()));
    assert.ok(path.basename(fixture).startsWith("structural-coverage-test-"));
    rmSync(fixture, { recursive: true });
  }
});

describe("coverage scope contract", () => {
  it.each([false, true])("checks nested production files against actual report entries (missing=%s)", (missing) => {
    const fixture = mkdtempSync(path.join(tmpdir(), "structural-coverage-test-"));
    fixtures.push(fixture);
    mkdirSync(path.join(fixture, "src", "nested"), { recursive: true });
    mkdirSync(path.join(fixture, "coverage"));
    const first = path.join(fixture, "src", "first.ts");
    const nested = path.join(fixture, "src", "nested", "new-module.ts");
    writeFileSync(first, "export const first = 1;\n");
    writeFileSync(nested, "export const nested = 2;\n");
    const report = { total: {}, [first]: {}, ...(missing ? {} : { [nested]: {} }) };
    writeFileSync(path.join(fixture, "coverage", "coverage-summary.json"), JSON.stringify(report));
    const result = spawnSync(process.execPath, [checker], { cwd: fixture, encoding: "utf8" });
    if (missing) {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("new-module.ts");
    } else {
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("2 production source files");
    }
  });
});
