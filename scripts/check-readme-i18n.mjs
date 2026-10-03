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


function sectionShapes(source, file) {
  const shapes = new Map();
  let section = "preamble";
  let fenced = false;
  const shape = () => {
    if (!shapes.has(section)) {
      shapes.set(section, { headings: [], bullets: 0, numbered: 0, tables: 0, fences: 0 });
    }
    return shapes.get(section);
  };
  shape();
  for (const line of source.split("\n")) {
    const marker = /^<!-- section: ([a-z0-9-]+) -->$/u.exec(line);
    if (marker != null) {
      section = marker[1];
      shape();
      continue;
    }
    if (/^(?:```|~~~)/u.test(line)) {
      if (!fenced) shape().fences += 1;
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^(#{2,6})\s+/u.exec(line);
    if (heading != null) shape().headings.push(heading[1].length);
    if (/^\s*[-*]\s+/u.test(line)) shape().bullets += 1;
    if (/^\s*\d+\.\s+/u.test(line)) shape().numbered += 1;
    if (/^\|.*\|\s*$/u.test(line)) shape().tables += 1;
  }
  assert.equal(fenced, false, `${file} must not contain an unclosed fenced code block`);
  return Object.fromEntries(shapes);
}

function sectionMarkers(source, file) {
  const markers = [...source.matchAll(/<!-- section: ([a-z0-9-]+) -->/gu)].map((match) => match[1]);
  assert.deepEqual(markers, sections, `${file} must contain the canonical README sections in order`);
  return markers;
}

sectionMarkers(english, englishPath);
sectionMarkers(chinese, chinesePath);
assert.deepEqual(
  sectionShapes(chinese, chinesePath),
  sectionShapes(english, englishPath),
  "README translations must keep the same per-section Markdown structure",
);
assert.match(english,
  /^# Structural Tables\n\n\[English\]\(https:\/\/github\.com\/ZHYX91\/obsidian-structural-tables\/blob\/main\/README\.md\) · \[简体中文\]\(https:\/\/github\.com\/ZHYX91\/obsidian-structural-tables\/blob\/main\/docs\/i18n\/README\.zh-CN\.md\)/u,
  "English README must link to both canonical language documents");
assert.match(chinese,
  /^# Structural Tables\n\n\[English\]\(\.\.\/\.\.\/README\.md\) · \[简体中文\]\(README\.zh-CN\.md\)/u,
  "Chinese README must link to both canonical language documents");
assert.match(english, /## Features/u, "Root README must be the English canonical document");
assert.match(chinese, /## 功能/u, "Chinese README must contain translated content");
for (const [file, source] of [[englishPath, english], [chinesePath, chinese]]) {
  assert.doesNotMatch(source, /(?:[A-Za-z]:\\|OneDrive|Obsidian-Plugins|obsidian-plugin-workspace)/u,
    `${file} must not contain local or workspace-only paths`);
}

process.stdout.write(`README i18n contract passed for ${sections.length} synchronized sections.\n`);
