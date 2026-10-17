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
  /^# Structural Tables\n\n\[English\]\(README\.md\) · \[简体中文\]\(docs\/i18n\/README\.zh-CN\.md\)/u,
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

const locales = [["English","README.md"],["简体中文","README.zh-CN.md"],["繁體中文","README.zh-TW.md"],["日本語","README.ja.md"],["Deutsch","README.de.md"],["Español","README.es.md"],["العربية","README.ar.md"],["Français","README.fr.md"],["Português (Brasil)","README.pt-BR.md"],["Русский","README.ru.md"],["한국어","README.ko.md"],["Tiếng Việt","README.vi.md"]];
for (const [, filename] of locales) {
  const path = filename === "README.md" ? filename : "docs/i18n/" + filename;
  const source = path === englishPath ? english : path === chinesePath ? chinese : await readFile(path, "utf8");
  sectionMarkers(source, path);
  for (const [otherLabel, otherName] of locales) {
    const href = filename === "README.md"
      ? (otherName === "README.md" ? "README.md" : "docs/i18n/" + otherName)
      : otherName === "README.md" ? "../../README.md" : otherName;
    assert.ok(source.includes("[" + otherLabel + "](" + href + ")"), path + " missing the " + otherLabel + " navigation link");
  }
  assert.ok(source.includes("||") && source.includes("^") && source.includes("<"),
    path + " must explain the same table syntax");
  const requiredTopics = ["<br>", "_promotion.json", "8192", "16", "Base", "Markdown"];
  for (const topic of requiredTopics) {
    assert.ok(source.includes(topic), `${path} is missing the required user guidance: ${topic}`);
  }
  for (const image of ["Structural Tables Reading View", "Structural Tables Live Preview", "Structural Tables settings"]) {
    if (filename === "README.md" || filename === "README.zh-CN.md") continue;
    // Localized guides must not leave screenshot accessibility text in English.
    assert.ok(!source.includes("![" + image + "]"), `${path} contains an untranslated screenshot label`);
  }
}
process.stdout.write(`README i18n contract passed for ${locales.length} languages and ${sections.length} synchronized sections.\\n`);
