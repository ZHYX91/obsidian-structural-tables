import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, "src");
const summaryPath = path.join(projectRoot, "coverage", "coverage-summary.json");

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path.resolve(target));
  }
  return files;
}

const summary = JSON.parse(await readFile(summaryPath, "utf8"));
const reported = new Set(
  Object.keys(summary)
    .filter((key) => key !== "total")
    .map((key) => path.resolve(key)),
);
const production = await sourceFiles(sourceRoot);
const missing = production.filter((file) => !reported.has(file));

assert.deepEqual(
  missing.map((file) => path.relative(projectRoot, file)).sort(),
  [],
  "Every src/**/*.ts production file must appear in coverage/coverage-summary.json",
);

process.stdout.write(`Coverage scope contract passed for ${production.length} production source files.\n`);
