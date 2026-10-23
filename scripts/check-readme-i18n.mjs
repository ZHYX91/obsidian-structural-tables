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

// README actions are part of the localized UI contract, not freehand menu
// guesses. Keep the full references and compact guides aligned with actual
// command names when a translation changes.
const declaredLocaleIds = [...(await readFile("src/config/locale.ts", "utf8"))
  .matchAll(/\{ id: "([^"]+)", name: "[^"]+", direction: "(?:ltr|rtl)" \}/gu)]
  .map((match) => match[1]);
assert.equal(declaredLocaleIds.length, 12, "Expected the current twelve supported interface locales");
for (const localeId of declaredLocaleIds) {
  const path = localeId === "en" ? "README.md" : `docs/i18n/README.${localeId}.md`;
  const source = path === englishPath ? english : path === chinesePath
    ? chinese : await readFile(path, "utf8");
  const catalog = await readFile(`src/config/locales/${localeId}.ts`, "utf8");
  for (const key of ["command.createBaseRecord", "command.validate"]) {
    const match = catalog.match(new RegExp(`"${key.replaceAll(".", "\\.")}"\\s*:\\s*"([^"]+)"`, "u"));
    assert.ok(match?.[1], `Missing ${key} from ${localeId} catalog`);
    assert.ok(source.includes(`**${match[1]}**`),
      `${path} must explain the real localized ${key} command`);
  }
}

const locales = [["English","README.md"],["简体中文","README.zh-CN.md"],["繁體中文","README.zh-TW.md"],["日本語","README.ja.md"],["한국어","README.ko.md"],["Deutsch","README.de.md"],["Français","README.fr.md"],["Español","README.es.md"],["Português (Brasil)","README.pt-BR.md"],["Русский","README.ru.md"],["Tiếng Việt","README.vi.md"],["العربية","README.ar.md"]];
for (const [, filename] of locales) {
  const path = filename === "README.md" ? filename : "docs/i18n/" + filename;
  const source = path === englishPath ? english : path === chinesePath ? chinese : await readFile(path, "utf8");
  sectionMarkers(source, path);
  const navigation = source.split("\n")[2] ?? "";
  const navigationLinks = [...navigation.matchAll(/\]\([^)]*\)/gu)];
  assert.equal(navigationLinks.length, locales.length, `${path} must have exactly ${locales.length} language links`);
  if (filename !== "README.md") assert.doesNotMatch(navigation, /https:\/\/github\.com/u,
    `${path} must use relative links between translated README documents`);
  if (filename !== "README.md" && filename !== "README.zh-CN.md") {
    const firstExample = /```markdown\n([\s\S]*?)\n```/u.exec(source)?.[1] ?? "";
    assert.ok(firstExample, `${path} must include a Markdown table example`);
    assert.doesNotMatch(firstExample, /\b(?:Sales|Quarter|North)\b/u,
      `${path} must localize its example table labels and values`);
  }
  const expectedNavigation = [];
  for (const [otherLabel, otherName] of locales) {
    const href = filename === "README.md"
      ? "https://github.com/ZHYX91/obsidian-structural-tables/blob/main/" + (otherName === "README.md" ? "README.md" : "docs/i18n/" + otherName)
      : otherName === "README.md" ? "../../README.md" : otherName;
    expectedNavigation.push("[" + otherLabel + "](" + href + ")");
  }
  assert.equal(navigation, expectedNavigation.join(" · "), `${path} must preserve the shared language order and exact destinations`);
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
const gfmExample = english.split("For example, this table has only row headers:")[1]?.split("### Export a table image")[0];
assert.ok(gfmExample, "English README must retain the GFM conversion example");
assert.doesNotMatch(gfmExample, /[\u3400-\u9fff]/u,
  "English GFM conversion example must use localized content");
const supportedLocaleNames = [...(await readFile("src/config/locale.ts", "utf8")).matchAll(/\{ id: "[^"]+", name: "([^"]+)"/gu)]
  .map((match) => match[1]);
for (const spec of ["docs/ux-spec.en.md", "docs/ux-spec.zh-CN.md"]) {
  const text = await readFile(spec, "utf8");
  const languageLine = text.split("\n").find((line) => /^(?:- language:|- 语言：)/u.test(line));
  assert.ok(languageLine, `${spec} must list interface languages`);
  for (const name of supportedLocaleNames) {
    assert.ok(languageLine.includes(name), `${spec} is missing supported interface language ${name}`);
  }
}
process.stdout.write(`README i18n contract passed for ${locales.length} languages and ${sections.length} synchronized sections.\n`);
