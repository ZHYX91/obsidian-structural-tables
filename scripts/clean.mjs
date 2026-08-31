import assert from "node:assert/strict";
import { lstatSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
assert.ok(
  arguments_.length === 0 || (arguments_.length === 1 && arguments_[0] === "--deps"),
  "clean accepts either no arguments or exactly one --deps",
);
const targets = arguments_.includes("--deps")
  ? ["node_modules"]
  : ["coverage", "dist", "release"];

for (const name of targets) {
  const target = path.join(projectRoot, name);
  const relative = path.relative(projectRoot, target);
  assert.ok(
    relative === name && !path.isAbsolute(relative),
    `clean target must be a direct project child: ${target}`,
  );
  let stats;
  try {
    stats = lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT") continue;
    throw error;
  }
  assert.ok(
    stats.isDirectory() && !stats.isSymbolicLink(),
    `clean target must be a real directory: ${target}`,
  );
  rmSync(target, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
  process.stdout.write(`Removed ${target}\n`);
}
