import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const stems = ["product-requirements", "ux-spec", "architecture", "testing-strategy", "release"];
const commonKeys = ["doc_id", "language", "source_language", "translation_status", "status", "last_synced"];

function frontmatter(source, file) {
  const match = /^---\n([\s\S]*?)\n---\n/u.exec(source);
  assert.ok(match, `${file} must start with YAML frontmatter`);
  const values = new Map();
  for (const line of match[1].split("\n")) {
    const field = /^([a-z_]+):(?:\s+)(.+)$/u.exec(line);
    assert.ok(field, `${file} contains unsupported frontmatter syntax: ${line}`);
    assert.ok(!values.has(field[1]), `${file} repeats frontmatter key ${field[1]}`);
    values.set(field[1], field[2].replace(/^"|"$/gu, ""));
  }
  return values;
}

function markers(source, file) {
  const result = [...source.matchAll(/<!-- section: ([a-z0-9-]+) -->/gu)].map((match) => match[1]);
  assert.ok(result.length >= 5, `${file} must contain stable section markers`);
  assert.equal(new Set(result).size, result.length, `${file} contains duplicate section markers`);
  return result;
}

for (const stem of stems) {
  const sourceName = `${stem}.zh-CN.md`;
  const translationName = `${stem}.en.md`;
  const sourcePath = `docs/${sourceName}`;
  const translationPath = `docs/${translationName}`;
  const [source, translation] = await Promise.all([
    readFile(sourcePath, "utf8"),
    readFile(translationPath, "utf8"),
  ]);
  const sourceMeta = frontmatter(source, sourcePath);
  const translationMeta = frontmatter(translation, translationPath);
  assert.deepEqual([...sourceMeta.keys()].sort(), [...commonKeys].sort(),
    `${sourcePath} must use the exact source frontmatter contract`);
  assert.deepEqual([...translationMeta.keys()].sort(), [...commonKeys, "translation_of"].sort(),
    `${translationPath} must use the exact translation frontmatter contract`);
  assert.equal(sourceMeta.get("doc_id"), stem, `${sourcePath} doc_id must match its stem`);
  assert.equal(translationMeta.get("doc_id"), stem, `${translationPath} doc_id must match its stem`);
  assert.equal(sourceMeta.get("language"), "zh-CN", `${sourcePath} language must be zh-CN`);
  assert.equal(translationMeta.get("language"), "en", `${translationPath} language must be en`);
  assert.equal(sourceMeta.get("source_language"), "zh-CN", `${sourcePath} source language must be zh-CN`);
  assert.equal(translationMeta.get("source_language"), "zh-CN",
    `${translationPath} source language must be zh-CN`);
  assert.equal(sourceMeta.get("translation_status"), "source",
    `${sourcePath} translation_status must be source`);
  assert.equal(translationMeta.get("translation_status"), "synced",
    `${translationPath} translation_status must be synced`);
  assert.equal(translationMeta.get("translation_of"), sourceName,
    `${translationPath} translation_of must name its Chinese source basename`);
  assert.equal(sourceMeta.get("status"), "stable", `${sourcePath} must be stable`);
  assert.equal(translationMeta.get("status"), "stable", `${translationPath} must be stable`);
  assert.equal(sourceMeta.get("last_synced"), translationMeta.get("last_synced"),
    `${stem} last_synced values must match`);
  assert.deepEqual(markers(translation, translationPath), markers(source, sourcePath),
    `${stem} translations must keep identical section markers and order`);
  assert.ok(source.includes(`(${translationName})`), `${sourcePath} must link to its English translation`);
  assert.ok(translation.includes(`(${sourceName})`), `${translationPath} must link to its Chinese source`);
  for (const [file, content] of [[sourcePath, source], [translationPath, translation]]) {
    assert.doesNotMatch(content, /(?:[A-Za-z]:\\|OneDrive|Obsidian-Plugins|obsidian-plugin-workspace|sibling)/iu,
      `${file} must not contain local or cross-repository references`);
  }
}

process.stdout.write(`Docs i18n contract passed for ${stems.length} canonical pairs.\n`);
