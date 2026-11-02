import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise the installed callers, not a replacement minimatch shim. These
// fixtures neither read project source nor disable the repository's lint rules.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const lock = JSON.parse(await fs.readFile(path.join(root, "package-lock.json"), "utf8"));
const packages = Object.entries(lock.packages ?? {});
const packageLocations = (name) => packages.filter(([relative]) =>
  relative === `node_modules/${name}` || relative.endsWith(`/node_modules/${name}`));
const minimatches = packageLocations("minimatch");
assert.ok(minimatches.length > 0, "The lint dependency graph must contain minimatch");

for (const [relative, metadata] of minimatches) {
  assert.equal(metadata.version, "11.0.4", `Unexpected minimatch in ${relative}`);
  assert.equal(metadata.dev, true, `minimatch must remain a development dependency: ${relative}`);
  const installed = JSON.parse(await fs.readFile(path.join(root, relative, "package.json"), "utf8"));
  assert.equal(installed.version, metadata.version, `Installed minimatch differs from lock: ${relative}`);
}

let callerCount = 0;
for (const [relative, metadata] of packages) {
  if (!metadata.dependencies?.minimatch) continue;
  const callerRequire = createRequire(path.join(root, relative, "package.json"));
  const matcher = callerRequire("minimatch");
  const installed = JSON.parse(await fs.readFile(callerRequire.resolve("minimatch/package.json"), "utf8"));
  assert.equal(installed.version, "11.0.4", `Wrong minimatch resolved by ${relative}`);
  assert.equal(matcher.minimatch("src/nested/file.ts", "src/**/*.{ts,tsx}"), true, relative);
  assert.equal(matcher.minimatch("src/nested/file.js", "src/**/*.{ts,tsx}"), false, relative);
  assert.equal(new matcher.Minimatch("**/*.js", { dot: true }).match(".config/file.js"), true, relative);
  assert.equal(new matcher.Minimatch("**/*.js").match(".config/file.js"), false, relative);
  callerCount += 1;
}

let probes = 0;
const peerVersions = new Set();
function peerLinter(callerRequire) {
  peerVersions.add(callerRequire("eslint/package.json").version);
  return callerRequire("eslint").Linter;
}
// Use each caller's installed ESLint peer for these dependency API probes.
// The normal lint command separately exercises the repository's active config.
function expectRule(Linter, rule, options, source, expected, filename = "lint-dependency-check.js", parser) {
  const languageOptions = { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } };
  if (parser) languageOptions.parser = parser;
  const messages = new Linter({ cwd: root }).verify(source, [{
    files: ["**/*.{js,jsx,json}"],
    languageOptions,
    plugins: { probe: { rules: { check: rule } } },
    rules: { "probe/check": ["error", ...options] },
  }], { filename: path.join(root, "scripts", filename) });
  assert.ok(messages.every((message) => !message.fatal && message.ruleId === "probe/check"), JSON.stringify(messages));
  assert.equal(messages.length, expected, `${filename}: ${JSON.stringify(messages)}`);
  probes += 1;
}

for (const [relative] of packageLocations("eslint-plugin-import")) {
  const callerRequire = createRequire(path.join(root, relative, "package.json"));
  const check = (...args) => expectRule(peerLinter(callerRequire), ...args);
  const order = callerRequire("./lib/rules/order.js");
  const ordering = [{ groups: ["sibling"], pathGroups: [{ pattern: "./a.js", group: "sibling", position: "before" }], pathGroupsExcludedImportTypes: [] }];
  check(order, ordering, 'import b from "./b.js";\nimport a from "./a.js";', 1);
  check(order, ordering, 'import a from "./a.js";\nimport b from "./b.js";', 0);
  check(order, ordering, 'import b from "./b.js";\nimport c from "./c.js";', 0);
  const internal = callerRequire("./lib/rules/no-internal-modules.js");
  const reaching = 'import metadata from "eslint/package.json";';
  check(internal, [{ allow: ["**/{package,other}.json"] }], reaching, 0);
  check(internal, [{ allow: ["**/*.js"] }], reaching, 1);
  check(internal, [{ forbid: ["**/{package,other}.json"] }], reaching, 1);
  check(internal, [{ forbid: ["**/*.js"] }], reaching, 0);
}

for (const [relative] of packageLocations("eslint-plugin-react")) {
  const callerRequire = createRequire(path.join(root, relative, "package.json"));
  const check = (...args) => expectRule(peerLinter(callerRequire), ...args);
  const rule = callerRequire("./lib/rules/no-danger.js");
  const options = [{ customComponentNames: ["Widget*", "Ui.*"] }];
  check(rule, options, 'const x = <WidgetCard dangerouslySetInnerHTML={{__html: html}} />;', 1, "lint-dependency-check.jsx");
  check(rule, options, 'const x = <Ui.Card dangerouslySetInnerHTML={{__html: html}} />;', 1, "lint-dependency-check.jsx");
  check(rule, options, 'const x = <Other dangerouslySetInnerHTML={{__html: html}} />;', 0, "lint-dependency-check.jsx");
  check(rule, options, 'const x = <div dangerouslySetInnerHTML={{__html: html}} />;', 1, "lint-dependency-check.jsx");
}

for (const [relative] of packageLocations("eslint-plugin-json-schema-validator")) {
  const callerRequire = createRequire(path.join(root, relative, "package.json"));
  const check = (...args) => expectRule(peerLinter(callerRequire), ...args);
  const rule = callerRequire("./lib/rules/no-invalid.js").default;
  const parser = callerRequire("jsonc-eslint-parser");
  const options = [{ useSchemastoreCatalog: false, schemas: [{
    fileMatch: ["**/lint-dependency-check.json"],
    schema: { type: "object", properties: { count: { type: "number" } }, required: ["count"] },
  }] }];
  check(rule, options, '{"count":"wrong"}', 1, "lint-dependency-check.json", parser);
  check(rule, options, '{"count":2}', 0, "lint-dependency-check.json", parser);
  check(rule, options, '{"count":"wrong"}', 0, "unmatched.json", parser);
}

function checkOverrideTester(OverrideTester, label) {
  const tester = OverrideTester.create(["scripts/**/*.{js,mjs}"], ["**/*.test.js"], root);
  assert.equal(tester.test(path.join(root, "scripts", "check.js")), true, label);
  assert.equal(tester.test(path.join(root, "scripts", "nested", "check.mjs")), true, label);
  assert.equal(tester.test(path.join(root, "scripts", "check.test.js")), false, label);
  assert.equal(tester.test(path.join(root, "src", "check.js")), false, label);
  const base = OverrideTester.create("*.js", null, root);
  assert.equal(base.test(path.join(root, "scripts", ".hidden.js")), true, label);
  const local = OverrideTester.create("./*.js", null, root);
  assert.equal(local.test(path.join(root, "check.js")), true, label);
  assert.equal(local.test(path.join(root, "scripts", "check.js")), false, label);
  probes += 7;
}

for (const [relative] of packageLocations("@eslint/eslintrc")) {
  const directory = path.join(root, relative);
  const commonjs = require(path.join(directory, "dist", "eslintrc.cjs"));
  const esm = await import(pathToFileURL(path.join(directory, "lib", "config-array", "override-tester.js")).href);
  checkOverrideTester(commonjs.Legacy.OverrideTester, `${relative}: CJS`);
  checkOverrideTester(esm.OverrideTester, `${relative}: ESM`);
}

for (const [relative] of packageLocations("@eslint/config-array")) {
  const directory = path.join(root, relative);
  for (const format of ["esm", "cjs"]) {
    const entry = path.join(directory, "dist", format, format === "esm" ? "index.js" : "index.cjs");
    const { ConfigArray } = format === "esm" ? await import(pathToFileURL(entry).href) : require(entry);
    const array = new ConfigArray([{ files: ["scripts/**/*.{js,mjs}"], ignores: ["**/*.test.js"], checked: true }], {
      basePath: root, schema: { checked: { merge: "replace", validate: "boolean" } },
    });
    array.normalizeSync();
    assert.equal(array.getConfig(path.join(root, "scripts", "check.js"))?.checked, true, `${relative}: ${format}`);
    assert.equal(array.getConfig(path.join(root, "scripts", "check.test.js")), undefined, `${relative}: ${format}`);
    assert.equal(array.getConfig(path.join(root, "src", "check.js")), undefined, `${relative}: ${format}`);
    probes += 3;
  }
}

for (const name of ["eslint-plugin-import", "eslint-plugin-react", "eslint-plugin-json-schema-validator", "@eslint/eslintrc", "@eslint/config-array"]) {
  assert.ok(packageLocations(name).length > 0, `Missing expected lint caller: ${name}`);
}
process.stdout.write(`Lint dependency compatibility passed: ${minimatches.length} locked minimatch copies, ${callerCount} callers, ${probes} rule/configuration probes.\n`);
process.stdout.write(`Rule probes used installed ESLint peers ${[...peerVersions].sort().join(", ")}; npm run lint separately checks the active repository configuration.\n`);
