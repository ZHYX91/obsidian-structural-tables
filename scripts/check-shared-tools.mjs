import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "scripts/runtime-contract.mjs",
  "scripts/prepare-lint-dependencies.mjs",
  "scripts/check-lint-dependencies.mjs",
];
const lock = JSON.parse(await readFile(path.join(root, "scripts/shared-tools.lock.json"), "utf8"));
assert.equal(lock.schemaVersion, 1, "Unsupported shared maintenance tools lock schema");
assert.equal(lock.source?.repository, "ZHYX91/obsidian-property-order", "Unexpected maintenance tool source");
assert.match(lock.source?.commit ?? "", /^[0-9a-f]{40}$/u, "Maintenance tool source must be a full commit SHA");
assert.deepEqual(Object.keys(lock.files ?? {}).sort(), [...files].sort(), "The lock must cover all three maintenance tools");

// This is an offline comparison with the reviewed local lock. It does not
// contact GitHub or authenticate the recorded source commit remotely.
for (const file of files) {
  const expected = lock.files[file];
  assert.match(expected ?? "", /^[0-9a-f]{64}$/u, `Missing SHA-256 for ${file}`);
  const actual = createHash("sha256").update(await readFile(path.join(root, file))).digest("hex");
  assert.equal(actual, expected, `Shared maintenance tool drift: ${file}. Follow CONTRIBUTING.md to update the source snapshot.`);
}
process.stdout.write(`Shared maintenance tools match the local source lock (${files.length} files).\n`);
