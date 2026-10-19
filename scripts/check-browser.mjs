import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";

const browser = process.argv[2] || process.env.CHROMIUM_PATH;
assert.ok(browser, "Provide a Chromium executable or set CHROMIUM_PATH. Optional following arguments select one or more suites.");
const transpose = ["transpose", "focus", "editing", "arrows", "history-bidi", "alignment"];
const available = [...transpose, "image", "gfm"];
const selected = process.argv.length > 3 ? process.argv.slice(3) : available;
assert.ok(selected.every((name) => available.includes(name)), "Available browser suites: " + available.join(", "));
const outputRoot = path.resolve(process.env.STRUCTURAL_BROWSER_ARTIFACTS || "dist/browser-checks");
await mkdir(outputRoot, { recursive: true });
const artifacts = await mkdtemp(path.join(outputRoot, "run-"));
const results = [];
for (const name of selected) {
  const script = transpose.includes(name) ? "check-table-transpose-browser.mjs"
    : name === "image" ? "check-table-image-browser.mjs" : "check-plain-gfm-browser.mjs";
  const args = [path.join("scripts", script), browser, ...(transpose.includes(name) ? [name] : [])];
  const start = Date.now();
  process.stdout.write(`\nBrowser suite: ${name}\n`);
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", windowsHide: true,
      env: { ...process.env, STRUCTURAL_BROWSER_ARTIFACTS: artifacts } });
    child.once("error", (error) => resolve({ code: null, error: String(error) }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  results.push({ suite: name, ...result, durationMs: Date.now() - start });
  // A failing group does not hide the outcomes of independent browser checks.
}
const passed = results.every((result) => result.code === 0);
const summary = { status: passed ? "passed" : "failed", browser, node: process.version, artifacts, results };
await writeFile(path.join(artifacts, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
process.stdout.write(JSON.stringify(summary) + "\n");
process.exitCode = passed ? 0 : 1;
