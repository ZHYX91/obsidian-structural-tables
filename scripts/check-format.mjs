import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const excludedDirectories = new Set([".git", "coverage", "dist", "node_modules"]);
const extensions = new Set([".css", ".json", ".md", ".mjs", ".mts", ".ts", ".yaml", ".yml"]);
const rootTextFiles = new Set([".editorconfig", ".gitattributes", ".gitignore", ".node-version"]);
const files = [];

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(absolute);
    } else if (entry.isFile() && (extensions.has(path.extname(entry.name)) || rootTextFiles.has(entry.name))) {
      files.push(absolute);
    }
  }
}

await collect(root);
const decoder = new TextDecoder("utf-8", { fatal: true });
for (const file of files) {
  const relative = path.relative(root, file).replaceAll(path.sep, "/");
  const bytes = await readFile(file);
  assert.ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), `${relative} has a UTF-8 BOM`);
  const source = decoder.decode(bytes);
  assert.ok(source.length > 0, `${relative} is empty`);
  assert.ok(source.endsWith("\n"), `${relative} must end with one LF`);
  assert.ok(!source.endsWith("\n\n"), `${relative} must end with exactly one LF`);
  assert.doesNotMatch(source, /\r/u, `${relative} must use LF line endings`);
  assert.doesNotMatch(source, /[ \t]+$/gmu, `${relative} contains trailing whitespace`);
  if (path.extname(file) === ".json") {
    const parsed = JSON.parse(source);
    assert.equal(source, `${JSON.stringify(parsed, null, 2)}\n`, `${relative} must use canonical two-space JSON`);
  }
}

process.stdout.write(`Format contract passed for ${files.length} text files.\n`);
