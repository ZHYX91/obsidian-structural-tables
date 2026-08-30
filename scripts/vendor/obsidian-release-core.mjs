// SPDX-License-Identifier: MIT

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const RELEASE_CORE_VERSION = "1.0.0";
export const RELEASE_CORE_PACKAGE_NAME = "@zhyx/obsidian-release-core";
export const RELEASE_CORE_VENDOR_LOCK_SCHEMA_VERSION = 1;

const execFileAsync = promisify(execFile);
const runtimePath = fileURLToPath(import.meta.url);
const stableVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const pluginIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const gitObjectPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const zipDosDate = 0x0021;
const zipDosTime = 0;
const zipUtf8Flag = 0x0800;
const zipUnixFileMode = 0o100644;
const zipVersion = 20;
const zipVersionMadeByUnix = (3 << 8) | zipVersion;
const crc32Table = createCrc32Table();
const defaultPaths = Object.freeze({
  manifest: "manifest.json",
  package: "package.json",
  packageLock: "package-lock.json",
  versions: "versions.json",
  dist: "dist",
});

export class ReleaseCoreError extends Error {
  constructor(message, code = "RELEASE_CORE_CONTRACT", options = undefined) {
    super(message, options);
    this.name = "ReleaseCoreError";
    this.code = code;
  }
}

function fail(message, code = "RELEASE_CORE_CONTRACT", options = undefined) {
  throw new ReleaseCoreError(message, code, options);
}

function assertCondition(value, message, code = "RELEASE_CORE_CONTRACT") {
  if (!value) fail(message, code);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function assertPlainObject(value, label) {
  assertCondition(isPlainObject(value), `${label} must be a plain object`);
}

function assertExactKeys(value, allowed, required, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const allowedSet = new Set(allowed);
  const extras = actual.filter((key) => !allowedSet.has(key));
  assertCondition(extras.length === 0, `${label} has unsupported keys: ${extras.join(", ")}`);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  assertCondition(missing.length === 0, `${label} is missing keys: ${missing.join(", ")}`);
}

function assertNonEmptyString(value, label) {
  assertCondition(typeof value === "string" && value.trim() === value && value.length > 0,
    `${label} must be a non-empty trimmed string`);
  return value;
}

function assertStableVersion(value, label) {
  assertCondition(typeof value === "string" && stableVersionPattern.test(value),
    `${label} must use x.y.z without a prefix`);
  return value;
}

function assertSha256(value, label) {
  assertCondition(typeof value === "string" && sha256Pattern.test(value),
    `${label} must be a lowercase SHA-256 digest`);
  return value;
}

function assertGitObject(value, label) {
  assertCondition(typeof value === "string" && gitObjectPattern.test(value),
    `${label} must be a lowercase Git object id`);
  return value;
}

function assertSafeRelativePath(value, label) {
  assertNonEmptyString(value, label);
  assertCondition(!path.isAbsolute(value), `${label} must be relative`);
  assertCondition(!value.includes("\\") && !value.includes("\0"),
    `${label} must use portable forward slashes`);
  const segments = value.split("/");
  assertCondition(segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    `${label} must not contain empty, dot, or parent segments`);
  return value;
}

function resolveInside(root, relativePath, label) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  assertCondition(relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." &&
    !path.isAbsolute(relative), `${label} escapes the project root`);
  return resolved;
}

function canonicalJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function validateReleaseConfig(input) {
  assertExactKeys(input, ["schemaVersion", "plugin", "assets", "publication", "paths"],
    ["schemaVersion", "plugin", "assets", "publication"], "Release config");
  assertCondition(input.schemaVersion === 1, "Release config schemaVersion must be 1");

  assertExactKeys(input.plugin, ["id", "name", "minAppVersion", "isDesktopOnly"],
    ["id", "name", "minAppVersion", "isDesktopOnly"], "Release config plugin");
  const pluginId = assertNonEmptyString(input.plugin.id, "Release config plugin id");
  assertCondition(pluginIdPattern.test(pluginId), "Release config plugin id is invalid");
  const pluginName = assertNonEmptyString(input.plugin.name, "Release config plugin name");
  const minAppVersion = assertStableVersion(input.plugin.minAppVersion,
    "Release config plugin minAppVersion");
  assertCondition(typeof input.plugin.isDesktopOnly === "boolean",
    "Release config plugin isDesktopOnly must be boolean");

  assertExactKeys(input.assets, ["styles"], ["styles"], "Release config assets");
  assertCondition(input.assets.styles === "required" || input.assets.styles === "optional",
    "Release config assets.styles must be required or optional");

  assertExactKeys(input.publication, ["repository"], ["repository"],
    "Release config publication");
  const repository = assertNonEmptyString(input.publication.repository,
    "Release config publication repository");
  assertCondition(repositoryPattern.test(repository),
    "Release config publication repository must use owner/name");

  const paths = { ...defaultPaths };
  if (input.paths !== undefined) {
    assertExactKeys(input.paths, Object.keys(defaultPaths), [], "Release config paths");
    for (const [name, value] of Object.entries(input.paths)) {
      paths[name] = assertSafeRelativePath(value, `Release config paths.${name}`);
    }
  }
  for (const [name, value] of Object.entries(paths)) {
    assertSafeRelativePath(value, `Release config paths.${name}`);
  }

  return Object.freeze({
    schemaVersion: 1,
    plugin: Object.freeze({
      id: pluginId,
      name: pluginName,
      minAppVersion,
      isDesktopOnly: input.plugin.isDesktopOnly,
    }),
    assets: Object.freeze({ styles: input.assets.styles }),
    publication: Object.freeze({ repository }),
    paths: Object.freeze(paths),
  });
}

async function readRegularFile(filePath, label) {
  let status;
  try {
    status = await lstat(filePath);
  } catch (error) {
    fail(`${label} is missing: ${filePath}`, "RELEASE_CORE_FILE", { cause: error });
  }
  assertCondition(!status.isSymbolicLink(), `${label} must not be a symbolic link`,
    "RELEASE_CORE_FILE");
  assertCondition(status.isFile(), `${label} must be a regular file`, "RELEASE_CORE_FILE");
  return readFile(filePath);
}

async function readJsonRegular(filePath, label) {
  const source = await readRegularFile(filePath, label);
  try {
    return { source, value: JSON.parse(source.toString("utf8")) };
  } catch (error) {
    fail(`${label} is not valid UTF-8 JSON`, "RELEASE_CORE_JSON", { cause: error });
  }
}

async function assertRegularDirectory(directoryPath, label) {
  let status;
  try {
    status = await lstat(directoryPath);
  } catch (error) {
    fail(`${label} is missing: ${directoryPath}`, "RELEASE_CORE_FILE", { cause: error });
  }
  assertCondition(!status.isSymbolicLink(), `${label} must not be a symbolic link`,
    "RELEASE_CORE_FILE");
  assertCondition(status.isDirectory(), `${label} must be a directory`, "RELEASE_CORE_FILE");
}

function compareStringKeys(actualObject, expectedObject, label) {
  const actualKeys = Object.keys(actualObject ?? {}).sort();
  const expectedKeys = Object.keys(expectedObject ?? {}).sort();
  assertCondition(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys),
    `${label} keys must match package.json`);
  for (const name of expectedKeys) {
    assertCondition(actualObject[name] === expectedObject[name],
      `${label}.${name} must match package.json`);
  }
}

function assertPackageContract(manifest, packageJson, packageLock, versions, config, requestedVersion) {
  assertPlainObject(manifest, "manifest.json");
  assertPlainObject(packageJson, "package.json");
  assertPlainObject(packageLock, "package-lock.json");
  assertPlainObject(versions, "versions.json");
  const version = assertStableVersion(manifest.version, "manifest.json version");
  if (requestedVersion !== undefined) {
    assertCondition(assertStableVersion(requestedVersion, "Requested release version") === version,
      "Requested release version must match manifest.json");
  }
  assertCondition(manifest.id === config.plugin.id, "manifest.json id must match release config");
  assertCondition(manifest.name === config.plugin.name, "manifest.json name must match release config");
  assertCondition(manifest.minAppVersion === config.plugin.minAppVersion,
    "manifest.json minAppVersion must match release config");
  assertCondition(manifest.isDesktopOnly === config.plugin.isDesktopOnly,
    "manifest.json isDesktopOnly must match release config");
  assertCondition(packageJson.version === version,
    "package.json and manifest.json versions must match");
  assertCondition(versions[version] === manifest.minAppVersion,
    "versions.json must map the release version to manifest.json minAppVersion");
  assertCondition(packageLock.lockfileVersion === 3, "package-lock.json must use lockfileVersion 3");
  assertCondition(packageLock.name === packageJson.name && packageLock.version === packageJson.version,
    "package-lock.json root identity must match package.json");
  const rootPackage = packageLock.packages?.[""];
  assertPlainObject(rootPackage, "package-lock.json root package");
  assertCondition(rootPackage.name === packageJson.name && rootPackage.version === packageJson.version,
    "package-lock.json root package identity must match package.json");
  assertCondition(rootPackage.engines?.node === packageJson.engines?.node,
    "package-lock.json root Node engine must match package.json");
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    compareStringKeys(rootPackage[field] ?? {}, packageJson[field] ?? {},
      `package-lock.json root ${field}`);
  }
  return version;
}

async function readProductionAssets(projectRoot, config, manifestSource) {
  const distRoot = resolveInside(projectRoot, config.paths.dist, "Release config dist path");
  await assertRegularDirectory(distRoot, "Production asset directory");
  const entries = await readdir(distRoot, { withFileTypes: true });
  for (const entry of entries) {
    assertCondition(entry.isFile() && !entry.isSymbolicLink(),
      `Production asset entry must be a regular file: ${entry.name}`, "RELEASE_CORE_ASSET");
  }
  const actualNames = entries.map((entry) => entry.name).sort();
  const expectedNames = ["main.js", "manifest.json"];
  const hasStyles = actualNames.includes("styles.css");
  if (config.assets.styles === "required") {
    expectedNames.push("styles.css");
  } else if (hasStyles) {
    expectedNames.push("styles.css");
  }
  expectedNames.sort();
  assertCondition(JSON.stringify(actualNames) === JSON.stringify(expectedNames),
    `Production asset inventory must be exactly: ${expectedNames.join(", ")}`,
    "RELEASE_CORE_ASSET");
  const assets = new Map();
  for (const name of expectedNames) {
    assets.set(name, await readRegularFile(path.join(distRoot, name), `Production asset ${name}`));
  }
  assertCondition(assets.get("main.js").length > 0, "Production main.js must not be empty",
    "RELEASE_CORE_ASSET");
  if (assets.has("styles.css")) {
    assertCondition(assets.get("styles.css").length > 0, "Production styles.css must not be empty",
      "RELEASE_CORE_ASSET");
  }
  assertCondition(assets.get("manifest.json").equals(manifestSource),
    "Production manifest.json must be byte-identical to the root manifest.json",
    "RELEASE_CORE_ASSET");
  return { assets, distRoot };
}

function commandText(output) {
  if (Buffer.isBuffer(output)) return output.toString("utf8");
  return String(output ?? "");
}

function commandFailure(error, command, arguments_) {
  if (error instanceof ReleaseCoreError) return error;
  const detail = commandText(error?.stderr).trim();
  const suffix = detail ? `: ${detail}` : "";
  const wrapped = new ReleaseCoreError(
    `Command failed: ${command} ${arguments_.join(" ")}${suffix}`,
    "RELEASE_CORE_COMMAND",
    { cause: error },
  );
  wrapped.exitCode = error?.exitCode ?? error?.code;
  wrapped.status = error?.status;
  wrapped.stderr = error?.stderr;
  return wrapped;
}

export async function defaultCommandRunner(command, arguments_, options = {}) {
  const encoding = options.encoding === "buffer" ? null : (options.encoding ?? "utf8");
  try {
    const result = await execFileAsync(command, arguments_, {
      cwd: options.cwd,
      env: options.env,
      encoding,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    error.exitCode = error.code;
    throw error;
  }
}

async function invokeCommand(commandRunner, command, arguments_, options = {}) {
  assertCondition(typeof commandRunner === "function", "commandRunner must be a function");
  let result;
  try {
    result = await commandRunner(command, arguments_, options);
  } catch (error) {
    throw commandFailure(error, command, arguments_);
  }
  if (Buffer.isBuffer(result) || typeof result === "string") {
    return { stdout: result, stderr: "", exitCode: 0 };
  }
  assertPlainObject(result, `Result from ${command}`);
  const exitCode = result.exitCode ?? 0;
  if (exitCode !== 0) {
    const error = new Error(`exit ${String(exitCode)}`);
    error.exitCode = exitCode;
    error.stderr = result.stderr;
    throw commandFailure(error, command, arguments_);
  }
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode };
}

async function invokeText(commandRunner, command, arguments_, options = {}) {
  const result = await invokeCommand(commandRunner, command, arguments_, { ...options, encoding: "utf8" });
  return commandText(result.stdout);
}

function isMissingReference(error) {
  return error?.exitCode === 1 || error?.cause?.code === 1 || error?.cause?.exitCode === 1;
}

async function readGitIdentity(projectRoot, version, commandRunner, {
  requireClean = true,
  checkTag = true,
} = {}) {
  if (requireClean) {
    const status = await invokeText(commandRunner, "git",
      ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: projectRoot });
    assertCondition(status.trim() === "", "Release source must be committed and clean",
      "RELEASE_CORE_SOURCE");
  }
  const commit = (await invokeText(commandRunner, "git", ["rev-parse", "--verify", "HEAD"],
    { cwd: projectRoot })).trim();
  const tree = (await invokeText(commandRunner, "git", ["rev-parse", "--verify", "HEAD^{tree}"],
    { cwd: projectRoot })).trim();
  assertGitObject(commit, "Git HEAD");
  assertGitObject(tree, "Git HEAD tree");
  if (!checkTag) {
    return Object.freeze({
      commit,
      tree,
      tag: Object.freeze({ name: version, state: "unchecked", commit: null }),
    });
  }
  const reference = `refs/tags/${version}`;
  let exists = true;
  try {
    await invokeCommand(commandRunner, "git", ["show-ref", "--verify", "--quiet", reference],
      { cwd: projectRoot });
  } catch (error) {
    if (!isMissingReference(error)) throw error;
    exists = false;
  }
  if (!exists) {
    return Object.freeze({ commit, tree, tag: Object.freeze({ name: version, state: "absent", commit: null }) });
  }
  const tagCommit = (await invokeText(commandRunner, "git",
    ["rev-parse", "--verify", `${reference}^{commit}`], { cwd: projectRoot })).trim();
  assertGitObject(tagCommit, `Git tag ${version}`);
  assertCondition(tagCommit === commit, `Existing tag ${version} points to another commit`,
    "RELEASE_CORE_TAG_CONFLICT");
  return Object.freeze({
    commit,
    tree,
    tag: Object.freeze({ name: version, state: "exact", commit: tagCommit }),
  });
}

export async function getReleaseCoreIdentity() {
  const source = await readRegularFile(runtimePath, "Release-core runtime");
  return Object.freeze({ version: RELEASE_CORE_VERSION, sha256: sha256(source), path: runtimePath });
}

export async function getReleaseCoreVendorLock() {
  const identity = await getReleaseCoreIdentity();
  return Object.freeze({
    schemaVersion: RELEASE_CORE_VENDOR_LOCK_SCHEMA_VERSION,
    package: RELEASE_CORE_PACKAGE_NAME,
    version: identity.version,
    runtime: "obsidian-release-core.mjs",
    sha256: identity.sha256,
  });
}

export async function serializeReleaseCoreVendorLock() {
  return canonicalJson(await getReleaseCoreVendorLock());
}

export async function validateReleaseProject({
  projectRoot,
  config: configInput,
  version,
  checkTag = false,
  requireClean = true,
  commandRunner = defaultCommandRunner,
}) {
  const root = path.resolve(assertNonEmptyString(projectRoot, "projectRoot"));
  const config = validateReleaseConfig(configInput);
  const manifestPath = resolveInside(root, config.paths.manifest, "Manifest path");
  const packagePath = resolveInside(root, config.paths.package, "Package path");
  const packageLockPath = resolveInside(root, config.paths.packageLock, "Package lock path");
  const versionsPath = resolveInside(root, config.paths.versions, "Versions path");
  const [manifestRecord, packageRecord, packageLockRecord, versionsRecord] = await Promise.all([
    readJsonRegular(manifestPath, "manifest.json"),
    readJsonRegular(packagePath, "package.json"),
    readJsonRegular(packageLockPath, "package-lock.json"),
    readJsonRegular(versionsPath, "versions.json"),
  ]);
  const releaseVersion = assertPackageContract(
    manifestRecord.value,
    packageRecord.value,
    packageLockRecord.value,
    versionsRecord.value,
    config,
    version,
  );
  const production = await readProductionAssets(root, config, manifestRecord.source);
  assertCondition(typeof checkTag === "boolean", "checkTag must be boolean");
  assertCondition(typeof requireClean === "boolean", "requireClean must be boolean");
  const source = await readGitIdentity(root, releaseVersion, commandRunner, {
    checkTag,
    requireClean,
  });
  return Object.freeze({
    projectRoot: root,
    config,
    version: releaseVersion,
    manifest: Object.freeze(manifestRecord.value),
    packageJson: Object.freeze(packageRecord.value),
    assets: production.assets,
    distRoot: production.distRoot,
    source,
  });
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

function crc32(content) {
  let checksum = 0xffffffff;
  for (const byte of content) {
    checksum = crc32Table[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function assertZip32(value, label) {
  assertCondition(Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff,
    `${label} exceeds the deterministic ZIP32 contract`, "RELEASE_CORE_ZIP");
}

function normalizeArchiveName(value) {
  assertNonEmptyString(value, "ZIP entry name");
  assertCondition(!value.includes("\\") && !value.startsWith("/") && !value.includes("\0"),
    `Unsafe ZIP entry name: ${value}`, "RELEASE_CORE_ZIP");
  const segments = value.split("/");
  assertCondition(segments.every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    `Unsafe ZIP entry name: ${value}`, "RELEASE_CORE_ZIP");
  return value;
}

export function createDeterministicZip(inputEntries) {
  assertCondition(Array.isArray(inputEntries) && inputEntries.length > 0,
    "ZIP must contain at least one entry", "RELEASE_CORE_ZIP");
  assertCondition(inputEntries.length <= 0xffff, "ZIP entry count exceeds ZIP32",
    "RELEASE_CORE_ZIP");
  const entries = inputEntries.map((entry) => {
    assertExactKeys(entry, ["name", "content"], ["name", "content"], "ZIP entry");
    const name = normalizeArchiveName(entry.name);
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    return { name, content };
  }).sort((left, right) => left.name.localeCompare(right.name, "en"));
  assertCondition(new Set(entries.map((entry) => entry.name)).size === entries.length,
    "ZIP entry names must be unique", "RELEASE_CORE_ZIP");

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    assertCondition(name.length <= 0xffff, "ZIP entry name is too long", "RELEASE_CORE_ZIP");
    assertZip32(entry.content.length, "ZIP entry size");
    const checksum = crc32(entry.content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(zipVersion, 4);
    localHeader.writeUInt16LE(zipUtf8Flag, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(zipDosTime, 10);
    localHeader.writeUInt16LE(zipDosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.content.length, 18);
    localHeader.writeUInt32LE(entry.content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, entry.content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(zipVersionMadeByUnix, 4);
    centralHeader.writeUInt16LE(zipVersion, 6);
    centralHeader.writeUInt16LE(zipUtf8Flag, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(zipDosTime, 12);
    centralHeader.writeUInt16LE(zipDosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.content.length, 20);
    centralHeader.writeUInt32LE(entry.content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((zipUnixFileMode << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + entry.content.length;
    assertZip32(localOffset, "ZIP local section size");
  }
  const central = Buffer.concat(centralParts);
  assertZip32(central.length, "ZIP central directory size");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function readUtf8Name(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail("ZIP entry name is not valid UTF-8", "RELEASE_CORE_ZIP", { cause: error });
  }
}

export function readDeterministicZip(input) {
  const archive = Buffer.isBuffer(input) ? input : Buffer.from(input);
  assertCondition(archive.length >= 22, "ZIP is truncated", "RELEASE_CORE_ZIP");
  const endOffset = archive.length - 22;
  assertCondition(archive.readUInt32LE(endOffset) === 0x06054b50,
    "ZIP end record is missing or not final", "RELEASE_CORE_ZIP");
  assertCondition(archive.readUInt16LE(endOffset + 4) === 0 &&
    archive.readUInt16LE(endOffset + 6) === 0, "ZIP must use one disk", "RELEASE_CORE_ZIP");
  const count = archive.readUInt16LE(endOffset + 8);
  assertCondition(count > 0 && count === archive.readUInt16LE(endOffset + 10),
    "ZIP entry counts are invalid", "RELEASE_CORE_ZIP");
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  assertCondition(archive.readUInt16LE(endOffset + 20) === 0,
    "ZIP comments are not allowed", "RELEASE_CORE_ZIP");
  assertCondition(centralOffset + centralSize === endOffset,
    "ZIP central directory boundaries are invalid", "RELEASE_CORE_ZIP");

  const records = [];
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    assertCondition(cursor + 46 <= endOffset && archive.readUInt32LE(cursor) === 0x02014b50,
      "ZIP central directory is malformed", "RELEASE_CORE_ZIP");
    assertCondition(archive.readUInt16LE(cursor + 4) === zipVersionMadeByUnix &&
      archive.readUInt16LE(cursor + 6) === zipVersion &&
      archive.readUInt16LE(cursor + 8) === zipUtf8Flag &&
      archive.readUInt16LE(cursor + 10) === 0 &&
      archive.readUInt16LE(cursor + 12) === zipDosTime &&
      archive.readUInt16LE(cursor + 14) === zipDosDate,
    "ZIP central metadata is not canonical", "RELEASE_CORE_ZIP");
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    assertCondition(compressedSize === size && extraLength === 0 && commentLength === 0 &&
      archive.readUInt16LE(cursor + 34) === 0 && archive.readUInt16LE(cursor + 36) === 0 &&
      archive.readUInt32LE(cursor + 38) === ((zipUnixFileMode << 16) >>> 0),
    "ZIP central entry contract is invalid", "RELEASE_CORE_ZIP");
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    assertCondition(nameEnd <= endOffset, "ZIP central entry is truncated", "RELEASE_CORE_ZIP");
    const name = normalizeArchiveName(readUtf8Name(archive.subarray(nameStart, nameEnd)));
    records.push({
      name,
      checksum,
      size,
      localOffset: archive.readUInt32LE(cursor + 42),
    });
    cursor = nameEnd;
  }
  assertCondition(cursor === endOffset, "ZIP central directory has trailing data",
    "RELEASE_CORE_ZIP");
  const names = records.map((record) => record.name);
  const sortedNames = [...names].sort((left, right) => left.localeCompare(right, "en"));
  assertCondition(JSON.stringify(names) === JSON.stringify(sortedNames) &&
    new Set(names).size === names.length, "ZIP entries must be unique and sorted",
  "RELEASE_CORE_ZIP");

  const result = new Map();
  let localCursor = 0;
  for (const record of records) {
    assertCondition(record.localOffset === localCursor && localCursor + 30 <= centralOffset &&
      archive.readUInt32LE(localCursor) === 0x04034b50,
    "ZIP local entry offsets are not canonical", "RELEASE_CORE_ZIP");
    assertCondition(archive.readUInt16LE(localCursor + 4) === zipVersion &&
      archive.readUInt16LE(localCursor + 6) === zipUtf8Flag &&
      archive.readUInt16LE(localCursor + 8) === 0 &&
      archive.readUInt16LE(localCursor + 10) === zipDosTime &&
      archive.readUInt16LE(localCursor + 12) === zipDosDate &&
      archive.readUInt32LE(localCursor + 14) === record.checksum &&
      archive.readUInt32LE(localCursor + 18) === record.size &&
      archive.readUInt32LE(localCursor + 22) === record.size &&
      archive.readUInt16LE(localCursor + 28) === 0,
    "ZIP local metadata is not canonical", "RELEASE_CORE_ZIP");
    const nameLength = archive.readUInt16LE(localCursor + 26);
    const nameStart = localCursor + 30;
    const nameEnd = nameStart + nameLength;
    const contentEnd = nameEnd + record.size;
    assertCondition(contentEnd <= centralOffset, "ZIP local entry is truncated", "RELEASE_CORE_ZIP");
    const name = readUtf8Name(archive.subarray(nameStart, nameEnd));
    assertCondition(name === record.name, "ZIP local and central names differ", "RELEASE_CORE_ZIP");
    const content = Buffer.from(archive.subarray(nameEnd, contentEnd));
    assertCondition(crc32(content) === record.checksum, `ZIP CRC mismatch: ${name}`,
      "RELEASE_CORE_ZIP");
    result.set(name, content);
    localCursor = contentEnd;
  }
  assertCondition(localCursor === centralOffset, "ZIP local section has trailing data",
    "RELEASE_CORE_ZIP");
  return result;
}

function assetRecord(name, content) {
  return Object.freeze({ name, size: content.length, sha256: sha256(content) });
}

function assertPublicAssetName(name) {
  assertNonEmptyString(name, "Public asset name");
  assertCondition(path.posix.basename(name) === name && !name.includes("\\") && !name.includes("\0"),
    `Unsafe public asset name: ${name}`);
  return name;
}

export function buildSha256Sums(records) {
  assertCondition(Array.isArray(records) && records.length > 0,
    "SHA256SUMS requires public asset records");
  const normalized = records.map((record) => {
    assertExactKeys(record, ["name", "size", "sha256"], ["name", "size", "sha256"],
      "Public asset record");
    return { name: assertPublicAssetName(record.name), sha256: assertSha256(record.sha256,
      `SHA256SUMS ${record.name}`) };
  }).sort((left, right) => left.name.localeCompare(right.name, "en"));
  assertCondition(new Set(normalized.map((record) => record.name)).size === normalized.length,
    "SHA256SUMS asset names must be unique");
  return Buffer.from(`${normalized.map((record) => `${record.sha256}  ${record.name}`).join("\n")}\n`,
    "utf8");
}

function archiveName(pluginId, version) {
  return `${pluginId}-${version}.zip`;
}

async function createExactDirectory(directoryPath, files) {
  const root = path.resolve(directoryPath);
  try {
    await mkdir(root, { recursive: false });
  } catch (error) {
    fail(`Candidate output directory must not already exist and its parent must exist: ${root}`,
      "RELEASE_CORE_OUTPUT", { cause: error });
  }
  for (const [name, content] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right, "en"))) {
    assertPublicAssetName(name);
    await writeFile(path.join(root, name), content, { flag: "wx", mode: 0o644 });
  }
  return root;
}

export async function createCandidateHandoff({
  projectRoot,
  config,
  outputDirectory,
  version,
  commandRunner = defaultCommandRunner,
}) {
  const project = await validateReleaseProject({
    projectRoot,
    config,
    version,
    checkTag: true,
    commandRunner,
  });
  const core = await getReleaseCoreIdentity();
  const productionRecords = [...project.assets.entries()]
    .map(([name, content]) => assetRecord(name, content))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const zipEntries = [...project.assets.entries()].map(([name, content]) => ({
    name: `${project.config.plugin.id}/${name}`,
    content,
  }));
  const archive = createDeterministicZip(zipEntries);
  const releaseArchiveName = archiveName(project.config.plugin.id, project.version);
  const archiveRecord = Object.freeze({
    ...assetRecord(releaseArchiveName, archive),
    entries: zipEntries.map((entry) => entry.name).sort((left, right) =>
      left.localeCompare(right, "en")),
  });
  const publicRecords = [...productionRecords, assetRecord(releaseArchiveName, archive)]
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const checksumBytes = buildSha256Sums(publicRecords);
  const checksumRecord = assetRecord("SHA256SUMS", checksumBytes);
  const candidate = Object.freeze({
    schemaVersion: 1,
    plugin: Object.freeze({
      id: project.config.plugin.id,
      name: project.config.plugin.name,
      version: project.version,
    }),
    source: Object.freeze({
      commit: project.source.commit,
      tree: project.source.tree,
      tag: Object.freeze({
        name: project.source.tag.name,
        commit: project.source.commit,
      }),
    }),
    releaseCore: Object.freeze({
      version: core.version,
      vendoredSha256: core.sha256,
    }),
    productionAssets: Object.freeze(productionRecords),
    archive: archiveRecord,
    checksums: checksumRecord,
  });
  const candidateBytes = canonicalJson(candidate);
  const candidateSha256 = sha256(candidateBytes);
  const files = new Map(project.assets);
  files.set(releaseArchiveName, archive);
  files.set("SHA256SUMS", checksumBytes);
  files.set("candidate.json", candidateBytes);
  const handoffDirectory = await createExactDirectory(
    assertNonEmptyString(outputDirectory, "outputDirectory"), files);
  return Object.freeze({
    status: "created",
    handoffDirectory,
    candidate,
    candidateSha256,
    publicAssets: Object.freeze(publicRecords),
  });
}

function assertAssetRecordShape(record, label) {
  assertExactKeys(record, ["name", "size", "sha256"], ["name", "size", "sha256"], label);
  assertPublicAssetName(record.name);
  assertCondition(Number.isSafeInteger(record.size) && record.size >= 0,
    `${label} size must be a non-negative integer`);
  assertSha256(record.sha256, `${label} sha256`);
}

function assertCandidateShape(candidate, config) {
  assertExactKeys(candidate,
    ["schemaVersion", "plugin", "source", "releaseCore", "productionAssets", "archive", "checksums"],
    ["schemaVersion", "plugin", "source", "releaseCore", "productionAssets", "archive", "checksums"],
    "candidate.json");
  assertCondition(candidate.schemaVersion === 1, "candidate.json schemaVersion must be 1");
  assertExactKeys(candidate.plugin, ["id", "name", "version"], ["id", "name", "version"],
    "candidate.json plugin");
  assertCondition(candidate.plugin.id === config.plugin.id && candidate.plugin.name === config.plugin.name,
    "candidate.json plugin identity must match release config");
  assertStableVersion(candidate.plugin.version, "candidate.json plugin version");
  assertExactKeys(candidate.source, ["commit", "tree", "tag"], ["commit", "tree", "tag"],
    "candidate.json source");
  assertGitObject(candidate.source.commit, "candidate.json source commit");
  assertGitObject(candidate.source.tree, "candidate.json source tree");
  assertExactKeys(candidate.source.tag, ["name", "commit"], ["name", "commit"],
    "candidate.json source tag");
  assertCondition(candidate.source.tag.name === candidate.plugin.version,
    "candidate.json source tag must equal plugin version");
  assertCondition(candidate.source.tag.commit === candidate.source.commit,
    "candidate.json source tag target must equal the source commit");
  assertExactKeys(candidate.releaseCore, ["version", "vendoredSha256"],
    ["version", "vendoredSha256"], "candidate.json releaseCore");
  assertCondition(candidate.releaseCore.version === RELEASE_CORE_VERSION,
    "candidate.json release-core version differs from this runtime");
  assertSha256(candidate.releaseCore.vendoredSha256,
    "candidate.json release-core vendoredSha256");
  assertCondition(Array.isArray(candidate.productionAssets) && candidate.productionAssets.length >= 2,
    "candidate.json productionAssets must be an array");
  for (const record of candidate.productionAssets) {
    assertAssetRecordShape(record, "candidate.json production asset");
  }
  assertExactKeys(candidate.archive, ["name", "size", "sha256", "entries"],
    ["name", "size", "sha256", "entries"], "candidate.json archive");
  assertPublicAssetName(candidate.archive.name);
  assertCondition(Number.isSafeInteger(candidate.archive.size) && candidate.archive.size > 0,
    "candidate.json archive size must be positive");
  assertSha256(candidate.archive.sha256, "candidate.json archive sha256");
  assertCondition(Array.isArray(candidate.archive.entries) && candidate.archive.entries.length >= 2,
    "candidate.json archive entries must be an array");
  for (const name of candidate.archive.entries) normalizeArchiveName(name);
  assertAssetRecordShape(candidate.checksums, "candidate.json checksums");
  assertCondition(candidate.checksums.name === "SHA256SUMS",
    "candidate.json checksums name must be SHA256SUMS");
}

function assertExactNameList(actual, expected, label) {
  const actualSorted = [...actual].sort((left, right) => left.localeCompare(right, "en"));
  const expectedSorted = [...expected].sort((left, right) => left.localeCompare(right, "en"));
  assertCondition(JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    `${label} must be exactly: ${expectedSorted.join(", ")}`);
}

export async function verifyReleaseHandoff({
  projectRoot,
  config: configInput,
  handoffDirectory,
  commandRunner = defaultCommandRunner,
}) {
  const config = validateReleaseConfig(configInput);
  const handoffRoot = path.resolve(assertNonEmptyString(handoffDirectory, "handoffDirectory"));
  await assertRegularDirectory(handoffRoot, "Release handoff directory");
  const candidateBytes = await readRegularFile(path.join(handoffRoot, "candidate.json"), "candidate.json");
  let candidate;
  try {
    candidate = JSON.parse(candidateBytes.toString("utf8"));
  } catch (error) {
    fail("candidate.json is invalid UTF-8 JSON", "RELEASE_CORE_CANDIDATE", { cause: error });
  }
  assertCandidateShape(candidate, config);
  assertCondition(canonicalJson(candidate).equals(candidateBytes),
    "candidate.json must use canonical deterministic serialization", "RELEASE_CORE_CANDIDATE");
  const core = await getReleaseCoreIdentity();
  assertCondition(candidate.releaseCore.vendoredSha256 === core.sha256,
    "candidate.json was built by different release-core bytes", "RELEASE_CORE_CANDIDATE");

  const project = await validateReleaseProject({
    projectRoot,
    config,
    version: candidate.plugin.version,
    checkTag: true,
    commandRunner,
  });
  assertCondition(candidate.source.commit === project.source.commit && candidate.source.tree === project.source.tree,
    "candidate.json source commit/tree differs from the current project",
    "RELEASE_CORE_CANDIDATE");
  const expectedProductionNames = [...project.assets.keys()].sort((left, right) =>
    left.localeCompare(right, "en"));
  assertExactNameList(candidate.productionAssets.map((record) => record.name), expectedProductionNames,
    "candidate.json production asset inventory");
  const expectedArchiveName = archiveName(config.plugin.id, project.version);
  assertCondition(candidate.archive.name === expectedArchiveName,
    "candidate.json archive name is invalid");
  const expectedPublicNames = [...expectedProductionNames, expectedArchiveName];
  const expectedHandoffNames = [...expectedPublicNames, "SHA256SUMS", "candidate.json"];
  const handoffEntries = await readdir(handoffRoot, { withFileTypes: true });
  for (const entry of handoffEntries) {
    assertCondition(entry.isFile() && !entry.isSymbolicLink(),
      `Release handoff entry must be a regular file: ${entry.name}`,
      "RELEASE_CORE_HANDOFF");
  }
  assertExactNameList(handoffEntries.map((entry) => entry.name), expectedHandoffNames,
    "Release handoff inventory");

  const publicFiles = new Map();
  for (const name of expectedPublicNames) {
    publicFiles.set(name, await readRegularFile(path.join(handoffRoot, name), `Release handoff ${name}`));
  }
  for (const record of candidate.productionAssets) {
    const content = publicFiles.get(record.name);
    assertCondition(record.size === content.length && record.sha256 === sha256(content),
      `Release handoff production asset mismatch: ${record.name}`, "RELEASE_CORE_HANDOFF");
    assertCondition(content.equals(project.assets.get(record.name)),
      `Release handoff differs from current production asset: ${record.name}`,
      "RELEASE_CORE_HANDOFF");
  }
  const archiveBytes = publicFiles.get(expectedArchiveName);
  assertCondition(candidate.archive.size === archiveBytes.length &&
    candidate.archive.sha256 === sha256(archiveBytes),
  "Release handoff archive hash/size mismatch", "RELEASE_CORE_HANDOFF");
  const expectedZip = createDeterministicZip([...project.assets.entries()].map(([name, content]) => ({
    name: `${config.plugin.id}/${name}`,
    content,
  })));
  assertCondition(archiveBytes.equals(expectedZip),
    "Release archive is not the deterministic byte-exact wrapper of loose assets",
    "RELEASE_CORE_HANDOFF");
  const parsedArchive = readDeterministicZip(archiveBytes);
  const expectedArchiveEntries = expectedProductionNames.map((name) => `${config.plugin.id}/${name}`);
  assertExactNameList(parsedArchive.keys(), expectedArchiveEntries, "Release archive inventory");
  assertExactNameList(candidate.archive.entries, expectedArchiveEntries,
    "candidate.json archive inventory");
  for (const name of expectedProductionNames) {
    assertCondition(parsedArchive.get(`${config.plugin.id}/${name}`).equals(publicFiles.get(name)),
      `Release archive entry differs from loose asset: ${name}`, "RELEASE_CORE_HANDOFF");
  }
  const publicRecords = expectedPublicNames.map((name) => assetRecord(name, publicFiles.get(name)))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const checksumBytes = await readRegularFile(path.join(handoffRoot, "SHA256SUMS"), "SHA256SUMS");
  const expectedChecksums = buildSha256Sums(publicRecords);
  assertCondition(checksumBytes.equals(expectedChecksums),
    "SHA256SUMS does not exactly match sorted public assets", "RELEASE_CORE_HANDOFF");
  assertCondition(candidate.checksums.size === checksumBytes.length &&
    candidate.checksums.sha256 === sha256(checksumBytes),
  "candidate.json checksum record mismatch", "RELEASE_CORE_HANDOFF");
  return Object.freeze({
    status: "verified",
    handoffDirectory: handoffRoot,
    candidate: Object.freeze(candidate),
    candidateSha256: sha256(candidateBytes),
    publicAssets: Object.freeze(publicRecords),
    publicFiles,
  });
}

export function buildPublicationAuthorization({
  repository,
  tag,
  commit,
  candidateSha256,
  acceptanceClosureSha256,
}) {
  assertCondition(repositoryPattern.test(assertNonEmptyString(repository, "Publication repository")),
    "Publication repository must use owner/name");
  assertStableVersion(tag, "Publication tag");
  assertGitObject(commit, "Publication commit");
  assertSha256(candidateSha256, "Publication candidate digest");
  assertSha256(acceptanceClosureSha256, "Publication acceptance closure digest");
  return `publish ${repository}@${tag} commit=${commit} candidate=${candidateSha256} acceptance=${acceptanceClosureSha256}`;
}

async function assertCurrentExactTag(projectRoot, candidate, commandRunner) {
  const current = await readGitIdentity(projectRoot, candidate.plugin.version, commandRunner);
  assertCondition(current.tag.state === "exact",
    `Publication requires the exact current tag ${candidate.plugin.version}`,
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  assertCondition(current.commit === candidate.source.commit && current.tree === candidate.source.tree,
    "Publication tag/source differs from candidate commit/tree",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  return current;
}

export async function validatePublicationBoundary({
  projectRoot,
  config: configInput,
  verifiedHandoff,
  candidateSha256,
  acceptanceClosurePath,
  acceptanceClosureSha256,
  authorization,
  commandRunner = defaultCommandRunner,
}) {
  const config = validateReleaseConfig(configInput);
  assertPlainObject(verifiedHandoff, "verifiedHandoff");
  assertSha256(candidateSha256, "Expected candidate digest");
  assertCondition(candidateSha256 === verifiedHandoff.candidateSha256,
    "Expected candidate digest does not match candidate.json",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  assertSha256(acceptanceClosureSha256, "Expected acceptance closure digest");
  const closure = await readRegularFile(path.resolve(assertNonEmptyString(acceptanceClosurePath,
    "acceptanceClosurePath")), "Acceptance closure");
  assertCondition(closure.length > 0, "Acceptance closure must not be empty",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  assertCondition(sha256(closure) === acceptanceClosureSha256,
    "Acceptance closure digest mismatch", "RELEASE_CORE_PUBLICATION_BOUNDARY");
  await assertCurrentExactTag(path.resolve(projectRoot), verifiedHandoff.candidate, commandRunner);
  const expectedAuthorization = buildPublicationAuthorization({
    repository: config.publication.repository,
    tag: verifiedHandoff.candidate.plugin.version,
    commit: verifiedHandoff.candidate.source.commit,
    candidateSha256,
    acceptanceClosureSha256,
  });
  assertCondition(typeof authorization === "string" && authorization === expectedAuthorization,
    "Manual publication authorization is missing or does not bind the exact candidate and acceptance closure",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  return Object.freeze({
    status: "authorized",
    repository: config.publication.repository,
    tag: verifiedHandoff.candidate.plugin.version,
    commit: verifiedHandoff.candidate.source.commit,
    candidateSha256,
    acceptanceClosureSha256,
    authorization: expectedAuthorization,
  });
}

function isHttp404(error) {
  if (error?.status === 404 || error?.cause?.status === 404) return true;
  return [error?.stderr, error?.cause?.stderr].some((value) => {
    const detail = commandText(value);
    return /\bHTTP(?:\/\d(?:\.\d)?)?\s+404\b/iu.test(detail) ||
      /\b404\s+Not Found\b/iu.test(detail);
  });
}

async function githubJson(commandRunner, endpoint, { cwd, env, allow404 = false } = {}) {
  let source;
  try {
    source = await invokeText(commandRunner, "gh", ["api", "--method", "GET", endpoint],
      { cwd, env });
  } catch (error) {
    if (allow404 && isHttp404(error)) return null;
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`GitHub API returned invalid JSON for ${endpoint}`, "RELEASE_CORE_GITHUB", { cause: error });
  }
}

async function githubAssetBytes(commandRunner, repository, assetId, { cwd, env } = {}) {
  const result = await invokeCommand(commandRunner, "gh", [
    "api",
    "--method",
    "GET",
    "-H",
    "Accept: application/octet-stream",
    `repos/${repository}/releases/assets/${String(assetId)}`,
  ], { cwd, env, encoding: "buffer" });
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout);
}

async function resolveRemoteTagCommit(commandRunner, repository, tag, options) {
  let record = await githubJson(commandRunner,
    `repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`, options);
  let object = record?.object;
  for (let depth = 0; depth < 5; depth += 1) {
    assertPlainObject(object, `GitHub tag ${tag} object`);
    assertGitObject(object.sha, `GitHub tag ${tag} object sha`);
    if (object.type === "commit") return object.sha;
    assertCondition(object.type === "tag", `GitHub tag ${tag} has unsupported object type`,
      "RELEASE_CORE_GITHUB");
    record = await githubJson(commandRunner, `repos/${repository}/git/tags/${object.sha}`, options);
    object = record?.object;
  }
  fail(`GitHub tag ${tag} annotation depth exceeds the fail-closed limit`, "RELEASE_CORE_GITHUB");
}

async function fetchRelease(commandRunner, repository, tag, options, allow404) {
  return githubJson(commandRunner,
    `repos/${repository}/releases/tags/${encodeURIComponent(tag)}`,
    { ...options, allow404 });
}

async function verifyHostedRecord({
  projectRoot,
  config,
  verifiedHandoff,
  commandRunner,
  env,
  releaseRecord,
}) {
  const repository = config.publication.repository;
  const candidate = verifiedHandoff.candidate;
  const tag = candidate.plugin.version;
  assertPlainObject(releaseRecord, "GitHub Release");
  assertCondition(releaseRecord.tag_name === tag && releaseRecord.draft === false &&
    releaseRecord.prerelease === false && releaseRecord.immutable === true &&
    typeof releaseRecord.published_at === "string" && releaseRecord.published_at.length > 0,
  "GitHub Release must be the exact immutable published stable tag", "RELEASE_CORE_GITHUB");
  assertCondition(Array.isArray(releaseRecord.assets), "GitHub Release assets must be an array",
    "RELEASE_CORE_GITHUB");
  const expectedNames = verifiedHandoff.publicAssets.map((record) => record.name);
  assertExactNameList(releaseRecord.assets.map((asset) => asset?.name), expectedNames,
    "GitHub Release public asset inventory");
  const expectedByName = new Map(verifiedHandoff.publicAssets.map((record) => [record.name, record]));
  for (const asset of releaseRecord.assets) {
    assertPlainObject(asset, `GitHub Release asset ${String(asset?.name)}`);
    const expected = expectedByName.get(asset.name);
    assertCondition((typeof asset.id === "number" || typeof asset.id === "string") &&
      asset.size === expected.size && asset.state === "uploaded" &&
      asset.digest === `sha256:${expected.sha256}`,
    `GitHub Release asset metadata mismatch: ${asset.name}`, "RELEASE_CORE_GITHUB");
    const hosted = await githubAssetBytes(commandRunner, repository, asset.id,
      { cwd: projectRoot, env });
    assertCondition(hosted.equals(verifiedHandoff.publicFiles.get(asset.name)),
      `GitHub Release hosted bytes mismatch: ${asset.name}`, "RELEASE_CORE_GITHUB");
    await invokeCommand(commandRunner, "gh", [
      "attestation",
      "verify",
      path.join(verifiedHandoff.handoffDirectory, asset.name),
      "--repo",
      repository,
      "--signer-workflow",
      `${repository}/.github/workflows/release.yml`,
      "--source-ref",
      `refs/tags/${tag}`,
      "--source-digest",
      candidate.source.commit,
      "--deny-self-hosted-runners",
    ], { cwd: projectRoot, env });
  }
  const remoteTagCommit = await resolveRemoteTagCommit(commandRunner, repository, tag,
    { cwd: projectRoot, env });
  assertCondition(remoteTagCommit === candidate.source.commit,
    "GitHub tag source commit differs from candidate source", "RELEASE_CORE_GITHUB");
  return Object.freeze({
    status: "verified",
    repository,
    tag,
    commit: remoteTagCommit,
    assetCount: expectedNames.length,
  });
}

export async function verifyPublishedRelease({
  projectRoot,
  config: configInput,
  verifiedHandoff,
  commandRunner = defaultCommandRunner,
  env = process.env,
  releaseRecord,
}) {
  const config = validateReleaseConfig(configInput);
  await assertCurrentExactTag(path.resolve(projectRoot), verifiedHandoff.candidate, commandRunner);
  const record = releaseRecord ?? await fetchRelease(commandRunner, config.publication.repository,
    verifiedHandoff.candidate.plugin.version, { cwd: projectRoot, env }, false);
  return verifyHostedRecord({
    projectRoot: path.resolve(projectRoot),
    config,
    verifiedHandoff,
    commandRunner,
    env,
    releaseRecord: record,
  });
}

async function inspectExistingGitHubRelease({
  projectRoot,
  config,
  verifiedHandoff,
  commandRunner,
  env,
}) {
  const repository = config.publication.repository;
  const tag = verifiedHandoff.candidate.plugin.version;
  const existing = await fetchRelease(commandRunner, repository, tag,
    { cwd: projectRoot, env }, true);
  if (existing === null) {
    return Object.freeze({ status: "missing", repository, tag });
  }
  const verified = await verifyPublishedRelease({
    projectRoot,
    config,
    verifiedHandoff,
    commandRunner,
    env,
    releaseRecord: existing,
  });
  return Object.freeze({
    status: "exact",
    repository,
    tag,
    commit: verified.commit,
    assetCount: verified.assetCount,
  });
}

export async function preflightGitHubPublication({
  projectRoot,
  config: configInput,
  verifiedHandoff,
  candidateSha256,
  acceptanceClosurePath,
  acceptanceClosureSha256,
  authorization,
  commandRunner = defaultCommandRunner,
  env = process.env,
}) {
  const root = path.resolve(projectRoot);
  const config = validateReleaseConfig(configInput);
  await validatePublicationBoundary({
    projectRoot: root,
    config,
    verifiedHandoff,
    candidateSha256,
    acceptanceClosurePath,
    acceptanceClosureSha256,
    authorization,
    commandRunner,
  });
  return inspectExistingGitHubRelease({
    projectRoot: root,
    config,
    verifiedHandoff,
    commandRunner,
    env,
  });
}

async function publishGitHub({
  projectRoot,
  config: configInput,
  verifiedHandoff,
  boundary,
  commandRunner,
  env,
  notesFile,
}) {
  const config = validateReleaseConfig(configInput);
  assertCondition(boundary?.status === "authorized", "Publication boundary is not authorized",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  const tag = verifiedHandoff.candidate.plugin.version;
  const preflight = await inspectExistingGitHubRelease({
    projectRoot,
    config,
    verifiedHandoff,
    commandRunner,
    env,
  });
  if (preflight.status === "exact") {
    return Object.freeze({ status: "noop", repository: config.publication.repository, tag });
  }
  const arguments_ = ["release", "create", tag];
  for (const record of verifiedHandoff.publicAssets) {
    arguments_.push(path.join(verifiedHandoff.handoffDirectory, record.name));
  }
  arguments_.push("--repo", config.publication.repository, "--verify-tag", "--title", tag);
  if (notesFile !== undefined) {
    const notesPath = path.resolve(notesFile);
    await readRegularFile(notesPath, "Release notes file");
    arguments_.push("--notes-file", notesPath);
  } else {
    arguments_.push("--generate-notes");
  }
  await invokeCommand(commandRunner, "gh", arguments_, { cwd: projectRoot, env });
  await verifyPublishedRelease({ projectRoot, config, verifiedHandoff, commandRunner, env });
  return Object.freeze({ status: "created", repository: config.publication.repository, tag });
}

function parseCliOptions(arguments_, allowed, required = [], booleanOptions = []) {
  const options = new Map();
  for (let index = 0; index < arguments_.length;) {
    const name = arguments_[index];
    assertCondition(typeof name === "string" && name.startsWith("--"),
      "CLI options must start with --", "RELEASE_CORE_CLI");
    assertCondition(allowed.includes(name), `Unsupported CLI option: ${name}`, "RELEASE_CORE_CLI");
    assertCondition(!options.has(name), `Duplicate CLI option: ${name}`, "RELEASE_CORE_CLI");
    if (booleanOptions.includes(name)) {
      options.set(name, true);
      index += 1;
      continue;
    }
    const value = arguments_[index + 1];
    assertCondition(typeof value === "string" && !value.startsWith("--"),
      "CLI options must use --name value pairs", "RELEASE_CORE_CLI");
    options.set(name, value);
    index += 2;
  }
  const missing = required.filter((name) => !options.has(name));
  assertCondition(missing.length === 0, `Missing CLI options: ${missing.join(", ")}`,
    "RELEASE_CORE_CLI");
  return options;
}

function aliasedOption(options, primary, alias, label, { required = true } = {}) {
  assertCondition(!(options.has(primary) && options.has(alias)),
    `${primary} and ${alias} cannot be used together`, "RELEASE_CORE_CLI");
  const value = options.get(primary) ?? options.get(alias);
  if (required) {
    assertCondition(typeof value === "string" && value.length > 0,
      `${label} is required via ${primary} or ${alias}`, "RELEASE_CORE_CLI");
  }
  return value;
}

export async function runReleaseCli({
  projectRoot,
  config,
  argv,
  env = process.env,
  commandRunner = defaultCommandRunner,
}) {
  assertCondition(Array.isArray(argv) && argv.length > 0, "Release command is required",
    "RELEASE_CORE_CLI");
  const [command, ...arguments_] = argv;
  if (command === "validate" || command === "validate-tag") {
    const options = parseCliOptions(arguments_, ["--version", "--check-tag"], [], ["--check-tag"]);
    const checkTag = command === "validate-tag" || options.has("--check-tag");
    const project = await validateReleaseProject({
      projectRoot,
      config,
      version: options.get("--version"),
      checkTag,
      requireClean: checkTag,
      commandRunner,
    });
    return Object.freeze({
      command,
      status: "validated",
      pluginId: project.config.plugin.id,
      version: project.version,
      commit: project.source.commit,
      tree: project.source.tree,
      tagPolicyChecked: checkTag,
    });
  }
  if (command === "candidate") {
    const options = parseCliOptions(arguments_, ["--version", "--output-dir", "--output"]);
    return createCandidateHandoff({
      projectRoot,
      config,
      outputDirectory: aliasedOption(options, "--output-dir", "--output", "Candidate output directory"),
      version: options.get("--version"),
      commandRunner,
    });
  }
  if (command === "verify-handoff") {
    const options = parseCliOptions(arguments_, ["--handoff-dir", "--candidate-dir"]);
    return verifyReleaseHandoff({
      projectRoot,
      config,
      handoffDirectory: aliasedOption(options, "--handoff-dir", "--candidate-dir",
        "Candidate handoff directory"),
      commandRunner,
    });
  }
  if (command === "publication-boundary") {
    const options = parseCliOptions(arguments_, [
      "--handoff-dir",
      "--candidate-dir",
      "--candidate-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ], [
      "--candidate-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ]);
    const verifiedHandoff = await verifyReleaseHandoff({
      projectRoot,
      config,
      handoffDirectory: aliasedOption(options, "--handoff-dir", "--candidate-dir",
        "Candidate handoff directory"),
      commandRunner,
    });
    return validatePublicationBoundary({
      projectRoot,
      config,
      verifiedHandoff,
      candidateSha256: options.get("--candidate-digest"),
      acceptanceClosurePath: options.get("--acceptance-closure"),
      acceptanceClosureSha256: options.get("--acceptance-closure-digest"),
      authorization: env.RELEASE_PUBLISH_AUTHORIZATION,
      commandRunner,
    });
  }
  if (command === "publication-preflight") {
    const options = parseCliOptions(arguments_, [
      "--handoff-dir",
      "--candidate-dir",
      "--candidate-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ], [
      "--candidate-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ]);
    const verifiedHandoff = await verifyReleaseHandoff({
      projectRoot,
      config,
      handoffDirectory: aliasedOption(options, "--handoff-dir", "--candidate-dir",
        "Candidate handoff directory"),
      commandRunner,
    });
    return preflightGitHubPublication({
      projectRoot,
      config,
      verifiedHandoff,
      candidateSha256: options.get("--candidate-digest"),
      acceptanceClosurePath: options.get("--acceptance-closure"),
      acceptanceClosureSha256: options.get("--acceptance-closure-digest"),
      authorization: env.RELEASE_PUBLISH_AUTHORIZATION,
      commandRunner,
      env,
    });
  }
  if (command === "publish-github") {
    const options = parseCliOptions(arguments_, [
      "--handoff-dir",
      "--candidate-dir",
      "--candidate-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
      "--notes-file",
    ], [
      "--candidate-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ]);
    const verifiedHandoff = await verifyReleaseHandoff({
      projectRoot,
      config,
      handoffDirectory: aliasedOption(options, "--handoff-dir", "--candidate-dir",
        "Candidate handoff directory"),
      commandRunner,
    });
    const boundary = await validatePublicationBoundary({
      projectRoot,
      config,
      verifiedHandoff,
      candidateSha256: options.get("--candidate-digest"),
      acceptanceClosurePath: options.get("--acceptance-closure"),
      acceptanceClosureSha256: options.get("--acceptance-closure-digest"),
      authorization: env.RELEASE_PUBLISH_AUTHORIZATION,
      commandRunner,
    });
    return publishGitHub({
      projectRoot: path.resolve(projectRoot),
      config,
      verifiedHandoff,
      boundary,
      commandRunner,
      env,
      notesFile: options.get("--notes-file"),
    });
  }
  if (command === "post-verify") {
    const options = parseCliOptions(arguments_, ["--handoff-dir", "--candidate-dir"]);
    const verifiedHandoff = await verifyReleaseHandoff({
      projectRoot,
      config,
      handoffDirectory: aliasedOption(options, "--handoff-dir", "--candidate-dir",
        "Candidate handoff directory"),
      commandRunner,
    });
    return verifyPublishedRelease({
      projectRoot,
      config,
      verifiedHandoff,
      commandRunner,
      env,
    });
  }
  fail(`Unknown release command: ${String(command)}`, "RELEASE_CORE_CLI");
}
