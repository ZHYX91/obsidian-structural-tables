import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

const [manifest, packageJson, packageLock, versions] = await Promise.all(
  ["manifest.json", "package.json", "package-lock.json", "versions.json"]
    .map(async (name) => JSON.parse(await readFile(name, "utf8"))),
);
const releaseTag = process.argv[2] ?? manifest.version;
assert.match(releaseTag, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u,
  "Release tag must use x.y.z without a v prefix");
assert.equal(releaseTag, manifest.version, "Release tag must match manifest.json");
assert.equal(packageJson.version, manifest.version, "package.json version must match manifest.json");
assert.equal(packageLock.version, manifest.version, "package-lock.json version must match manifest.json");
assert.equal(packageLock.packages?.[""]?.version, manifest.version,
  "package-lock.json root package version must match manifest.json");
assert.equal(versions[manifest.version], manifest.minAppVersion,
  "versions.json must map the release version to minAppVersion");
const { stdout: status } = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
assert.equal(status.trim(), "", "Release source must be committed with no untracked or modified files");
const { stdout: head } = await run("git", ["rev-parse", "HEAD"]);
try {
  const { stdout: taggedCommit } = await run("git", ["rev-list", "-n", "1", releaseTag]);
  assert.equal(taggedCommit.trim(), head.trim(), `Existing tag ${releaseTag} points to another commit`);
} catch (error) {
  const missingTag = error instanceof Error && "code" in error && error.code === 128;
  if (!missingTag) throw error;
}
process.stdout.write(`Release version contract passed for ${releaseTag}.\n`);
