import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("coverage scope contract", () => {
  it("covers all production TypeScript and verifies the report in npm run check", () => {
    const config = readFileSync("vitest.config.mts", "utf8");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    const checker = readFileSync("scripts/check-coverage-scope.mjs", "utf8");

    expect(config).toContain('include: ["src/**/*.ts"]');
    expect(pkg.scripts["check:coverage-scope"]).toBe("node scripts/check-coverage-scope.mjs");
    expect(pkg.scripts.check).toContain(
      "npm run test:coverage && npm run check:coverage-scope && npm run build:bundle",
    );
    expect(checker).toContain('entry.name.endsWith(".ts")');
    expect(checker).toContain("coverage-summary.json");
  });
});
