import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Temporary upstream call-site migrations for the minimatch 11 security update.
// Keep package versions and exact edits explicit; do not change lint rules or
// install a runtime loader. Remove each patch when its upstream adopts v11.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await fs.readFile(path.join(root, "package-lock.json"), "utf8"));
const importRules = [
  "extensions", "no-extraneous-dependencies", "no-import-module-exports",
  "no-internal-modules", "no-namespace", "no-unassigned-import", "order",
];
const reactRules = [
  "forbid-component-props", "jsx-handler-names", "jsx-pascal-case", "no-danger",
  "no-unstable-nested-components",
];
const patches = {
  "@eslint/eslintrc": {
    versions: ["3.3.6", "3.3.7"],
    edits: [
      ["lib/config-array/override-tester.js", 'import minimatch from "minimatch";', 'import * as minimatch from "minimatch";'],
      ["dist/eslintrc.cjs", 'const { Minimatch } = minimatch__default["default"];', "const { Minimatch } = minimatch;"],
    ],
  },
  "@eslint/config-array": {
    versions: ["0.21.2"],
    edits: [["dist/esm/index.js", "import minimatch from 'minimatch';", "import * as minimatch from 'minimatch';"]],
  },
  "eslint-plugin-json-schema-validator": {
    versions: ["5.1.0"],
    edits: [["lib/rules/no-invalid.js", 'const minimatch_1 = __importDefault(require("minimatch"));', 'const minimatch_1 = { default: require("minimatch").minimatch };']],
  },
  "eslint-plugin-import": {
    versions: ["2.32.0"],
    edits: [
      ...importRules.map((rule) => [
        `lib/rules/${rule}.js`,
        "var _minimatch2 = _interopRequireDefault(_minimatch);",
        "var _minimatch2 = { default: _minimatch.minimatch };",
      ]),
      ["lib/rules/no-internal-modules.js", "_minimatch2['default'].makeRe(p)", "new _minimatch.Minimatch(p)", 2],
      ["lib/rules/no-internal-modules.js", "re.test(importPath)", "re.match(importPath)", 2],
    ],
  },
  "eslint-plugin-react": {
    versions: ["7.37.3", "7.37.5"],
    edits: reactRules.map((rule) => [
      `lib/rules/${rule}.js`, "const minimatch = require('minimatch');",
      "const { minimatch } = require('minimatch');",
    ]),
  },
};

let updated = 0;
for (const [relative, metadata] of Object.entries(lock.packages ?? {})) {
  const name = Object.keys(patches).find((candidate) => relative.endsWith(`/node_modules/${candidate}`)
    || relative === `node_modules/${candidate}`);
  if (!name) continue;
  const patch = patches[name];
  // New config-array already uses named exports; keep it unmodified.
  if (name === "@eslint/config-array" && metadata.version === "0.23.5") continue;
  if (!patch.versions.includes(metadata.version)) {
    throw new Error(`Review the minimatch migration for ${name}@${metadata.version}`);
  }
  const directory = path.resolve(root, relative);
  if (!directory.startsWith(`${root}${path.sep}node_modules${path.sep}`)) {
    throw new Error(`Invalid dependency location: ${relative}`);
  }
  let installed;
  try {
    installed = JSON.parse(await fs.readFile(path.join(directory, "package.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && process.env.npm_config_omit?.split(",").includes("dev")) continue;
    throw error;
  }
  if (installed.name !== name || installed.version !== metadata.version) {
    throw new Error(`Installed dependency differs from lock: ${relative}`);
  }
  for (const [file, before, after, expected = 1] of patch.edits) {
    const target = path.join(directory, file);
    const source = await fs.readFile(target, "utf8");
    const oldCount = source.split(before).length - 1;
    const newCount = source.split(after).length - 1;
    if (oldCount === 0 && newCount === expected) continue;
    if (oldCount !== expected || newCount !== 0) {
      throw new Error(`Upstream source changed; review ${relative}/${file}`);
    }
    await fs.writeFile(target, source.replaceAll(before, after));
    updated += 1;
  }
}
process.stdout.write(`Lint dependency migrations ready (${updated} edits applied).\n`);
