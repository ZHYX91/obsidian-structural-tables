import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const englishPath = "README.md";
const chinesePath = "docs/i18n/README.zh-CN.md";
const sections = [
  "features",
  "requirements-and-compatibility",
  "installation",
  "usage",
  "settings",
  "limitations",
  "privacy-and-security",
  "development",
  "support",
  "license",
];
const [english, chinese] = await Promise.all([readFile(englishPath, "utf8"), readFile(chinesePath, "utf8")]);

function sectionMarkers(source, file) {
  const markers = [...source.matchAll(/<!-- section: ([a-z0-9-]+) -->/gu)].map((match) => match[1]);
  assert.deepEqual(markers, sections, `${file} must contain the canonical README sections in order`);
  return markers;
}

sectionMarkers(english, englishPath);
sectionMarkers(chinese, chinesePath);
assert.match(english, /^# Structural Tables\n\n\[简体中文\]\(docs\/i18n\/README\.zh-CN\.md\)/u,
  "English README must link to the Simplified Chinese README");
assert.match(chinese, /^# Structural Tables\n\n\[English\]\(\.\.\/\.\.\/README\.md\)/u,
  "Chinese README must link to the canonical English README");
assert.match(english, /## Features/u, "Root README must be the English canonical document");
assert.match(chinese, /## 功能/u, "Chinese README must contain translated content");
for (const [file, source] of [[englishPath, english], [chinesePath, chinese]]) {
  assert.doesNotMatch(source, /(?:[A-Za-z]:\\|OneDrive|Obsidian-Plugins|obsidian-plugin-workspace)/u,
    `${file} must not contain local or workspace-only paths`);
}

process.stdout.write(`README i18n contract passed for ${sections.length} synchronized sections.\n`);
