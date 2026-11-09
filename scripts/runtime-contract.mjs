import assert from "node:assert/strict";

export function assertRuntimeContract({
  configuredNodeVersion,
  currentNodeVersion,
  currentNpmVersion,
  packageJson,
}) {
  const packageManagerMatch = /^npm@(\d+\.\d+\.\d+)$/u.exec(packageJson.packageManager ?? "");
  assert.ok(packageManagerMatch, "package.json packageManager must pin npm to an exact version");

  assert.match(
    configuredNodeVersion,
    /^\d+\.\d+\.\d+$/u,
    ".node-version must pin an exact Node.js version",
  );
  assert.equal(
    packageJson.engines?.node,
    configuredNodeVersion,
    "package.json engines.node must match .node-version exactly",
  );
  assert.equal(
    currentNodeVersion,
    configuredNodeVersion,
    `Node.js ${configuredNodeVersion} is required; received ${currentNodeVersion}`,
  );
  assert.equal(
    currentNpmVersion,
    packageManagerMatch[1],
    `npm ${packageManagerMatch[1]} is required; received ${currentNpmVersion}`,
  );
}

export function parseNpmVersion(userAgent) {
  const match = /(?:^|\s)npm\/(\d+\.\d+\.\d+)(?:\s|$)/u.exec(userAgent ?? "");
  assert.ok(match, "Run the runtime check through npm so its exact version can be verified");
  return match[1];
}
