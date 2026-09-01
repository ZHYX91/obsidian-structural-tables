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
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const RELEASE_CORE_VERSION = "2.0.0";
export const RELEASE_CORE_PACKAGE_NAME = "@zhyx/obsidian-release-core";
export const RELEASE_CORE_VENDOR_LOCK_SCHEMA_VERSION = 2;
export const CANDIDATE_BUNDLE_SCHEMA_VERSION = 3;
export const CANDIDATE_BUNDLE_KIND = "obsidian-plugin/candidate-bundle-v3";
export const PRODUCT_SCENARIOS_SCHEMA_VERSION = 2;
export const PRODUCT_SCENARIOS_KIND = "obsidian-plugin/product-scenarios-v2";

const execFileAsync = promisify(execFile);
const runtimePath = fileURLToPath(import.meta.url);
const stableVersionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const pluginIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const gitObjectPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const hostCapabilities = Object.freeze(["touch.drag", "touch.longPress"]);
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
  nodeVersion: ".node-version",
});
const requiredWorkflowPath = ".github/workflows/release.yml";
const requiredScenarioContractPath = "acceptance/product-scenarios.json";
const requiredInstallCommand = "npm ci --no-audit --no-fund";
const requiredVerifyCommand = "npm run release:check";
const npmPackageManagerPattern = /^npm@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u;
const scenarioIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const releaseRunIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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
  assertExactKeys(input,
    ["schemaVersion", "plugin", "assets", "publication", "build", "acceptance", "paths"],
    ["schemaVersion", "plugin", "assets", "publication", "build", "acceptance"],
    "Release config");
  assertCondition(input.schemaVersion === 2, "Release config schemaVersion must be 2");

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

  assertExactKeys(input.build,
    ["node", "packageManager", "installCommand", "verifyCommand", "workflow"],
    ["node", "packageManager", "installCommand", "verifyCommand", "workflow"],
    "Release config build");
  const node = assertStableVersion(input.build.node, "Release config build node");
  const packageManager = assertNonEmptyString(input.build.packageManager,
    "Release config build packageManager");
  assertCondition(npmPackageManagerPattern.test(packageManager),
    "Release config build packageManager must pin npm@x.y.z");
  assertCondition(input.build.installCommand === requiredInstallCommand,
    `Release config build installCommand must be '${requiredInstallCommand}'`);
  assertCondition(input.build.verifyCommand === requiredVerifyCommand,
    `Release config build verifyCommand must be '${requiredVerifyCommand}'`);
  const workflow = assertSafeRelativePath(input.build.workflow,
    "Release config build workflow");
  assertCondition(workflow === requiredWorkflowPath,
    `Release config build workflow must be ${requiredWorkflowPath}`);

  assertExactKeys(input.acceptance, ["scenarioContract"], ["scenarioContract"],
    "Release config acceptance");
  const scenarioContract = assertSafeRelativePath(input.acceptance.scenarioContract,
    "Release config acceptance scenarioContract");
  assertCondition(scenarioContract === requiredScenarioContractPath,
    `Release config acceptance scenarioContract must be ${requiredScenarioContractPath}`);

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
    schemaVersion: 2,
    plugin: Object.freeze({
      id: pluginId,
      name: pluginName,
      minAppVersion,
      isDesktopOnly: input.plugin.isDesktopOnly,
    }),
    assets: Object.freeze({ styles: input.assets.styles }),
    publication: Object.freeze({ repository }),
    build: Object.freeze({
      node,
      packageManager,
      installCommand: requiredInstallCommand,
      verifyCommand: requiredVerifyCommand,
      workflow,
    }),
    acceptance: Object.freeze({ scenarioContract }),
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

function assertStringArray(value, label, { nonEmpty = true } = {}) {
  assertCondition(Array.isArray(value) && (!nonEmpty || value.length > 0),
    `${label} must be ${nonEmpty ? "a non-empty" : "an"} array`);
  for (const item of value) assertNonEmptyString(item, `${label} entry`);
}

function assertVaultRelativePath(value, label) {
  if (value === "") return value;
  return assertSafeRelativePath(value, label);
}

function validateProductScenarios(input, config) {
  assertExactKeys(input,
    ["schemaVersion", "kind", "pluginId", "materializer", "scenarios"],
    ["schemaVersion", "kind", "pluginId", "materializer", "scenarios"],
    "Product scenarios");
  assertCondition(input.schemaVersion === PRODUCT_SCENARIOS_SCHEMA_VERSION,
    `Product scenarios schemaVersion must be ${PRODUCT_SCENARIOS_SCHEMA_VERSION}`);
  assertCondition(input.kind === PRODUCT_SCENARIOS_KIND,
    `Product scenarios kind must be ${PRODUCT_SCENARIOS_KIND}`);
  assertCondition(input.pluginId === config.plugin.id,
    "Product scenarios pluginId must match the release config");
  assertExactKeys(input.materializer, ["kind", "roots"], ["kind", "roots"],
    "Product scenarios materializer");
  assertCondition(input.materializer.kind === "copy-v1",
    "Product scenarios materializer kind must be copy-v1");
  assertCondition(Array.isArray(input.materializer.roots) && input.materializer.roots.length > 0,
    "Product scenarios materializer roots must be a non-empty array");
  const roots = input.materializer.roots.map((root, index) => {
    assertExactKeys(root, ["source", "target"], ["source", "target"],
      `Product scenarios materializer root ${index}`);
    return Object.freeze({
      source: assertSafeRelativePath(root.source,
        `Product scenarios materializer root ${index} source`),
      target: assertVaultRelativePath(root.target,
        `Product scenarios materializer root ${index} target`),
    });
  });
  assertCondition(new Set(roots.map((root) => root.source)).size === roots.length,
    "Product scenarios materializer source roots must be unique");
  assertCondition(Array.isArray(input.scenarios) && input.scenarios.length > 0,
    "Product scenarios must contain at least one scenario");
  const scenarios = input.scenarios.map((scenario, index) => {
    assertExactKeys(scenario,
      ["id", "title", "surfaces", "requiredCapabilities", "steps", "expected"],
      ["id", "title", "surfaces", "requiredCapabilities", "steps", "expected"],
      `Product scenario ${index}`);
    const id = assertNonEmptyString(scenario.id, `Product scenario ${index} id`);
    assertCondition(scenarioIdPattern.test(id), `Product scenario id is invalid: ${id}`);
    const title = assertNonEmptyString(scenario.title, `Product scenario ${id} title`);
    assertStringArray(scenario.surfaces, `Product scenario ${id} surfaces`);
    const surfaces = [...scenario.surfaces];
    assertCondition(new Set(surfaces).size === surfaces.length &&
      surfaces.every((surface) => surface === "desktop" || surface === "android-emulator"),
    `Product scenario ${id} surfaces are invalid`);
    assertExactKeys(scenario.requiredCapabilities, surfaces, surfaces,
      `Product scenario ${id} requiredCapabilities`);
    const requiredCapabilities = Object.fromEntries(surfaces.map((surface) => {
      const capabilities = scenario.requiredCapabilities[surface];
      assertStringArray(capabilities,
        `Product scenario ${id} requiredCapabilities.${surface}`, { nonEmpty: false });
      assertCondition(new Set(capabilities).size === capabilities.length &&
        capabilities.every((capability) => hostCapabilities.includes(capability)) &&
        capabilities.every((capability, capabilityIndex) =>
          capabilityIndex === 0 || capabilities[capabilityIndex - 1].localeCompare(capability, "en") < 0),
      `Product scenario ${id} requiredCapabilities.${surface} are invalid`);
      assertCondition(surface === "android-emulator" || capabilities.length === 0,
        `Product scenario ${id} desktop capabilities must be empty`);
      return [surface, Object.freeze([...capabilities])];
    }));
    assertStringArray(scenario.steps, `Product scenario ${id} steps`);
    assertStringArray(scenario.expected, `Product scenario ${id} expected`);
    return Object.freeze({
      id,
      title,
      surfaces: Object.freeze(surfaces),
      requiredCapabilities: Object.freeze(requiredCapabilities),
      steps: Object.freeze([...scenario.steps]),
      expected: Object.freeze([...scenario.expected]),
    });
  });
  assertCondition(new Set(scenarios.map((scenario) => scenario.id)).size === scenarios.length,
    "Product scenario ids must be unique");
  const covered = new Set(scenarios.flatMap((scenario) => scenario.surfaces));
  assertCondition(covered.has("desktop"), "Product scenarios must cover desktop");
  assertCondition(config.plugin.isDesktopOnly || covered.has("android-emulator"),
    "Mobile-capable plugins must cover the Android emulator");
  assertCondition(!config.plugin.isDesktopOnly || !covered.has("android-emulator"),
    "Desktop-only plugins must not claim Android emulator scenarios");
  return Object.freeze({
    schemaVersion: PRODUCT_SCENARIOS_SCHEMA_VERSION,
    kind: PRODUCT_SCENARIOS_KIND,
    pluginId: input.pluginId,
    materializer: Object.freeze({ kind: "copy-v1", roots: Object.freeze(roots) }),
    scenarios: Object.freeze(scenarios),
  });
}

async function readRegularTreeFiles(projectRoot, relativeRoot) {
  const absoluteRoot = resolveInside(projectRoot, relativeRoot, "Product fixture root");
  await assertRegularDirectory(absoluteRoot, `Product fixture root ${relativeRoot}`);
  const records = [];
  async function visit(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = path.posix.join(relativeDirectory, entry.name);
      assertCondition(!entry.isSymbolicLink(),
        `Product fixture resource must not be a symbolic link: ${relative}`,
        "RELEASE_CORE_SCENARIO");
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else {
        assertCondition(entry.isFile(),
          `Product fixture resource must be a regular file: ${relative}`,
          "RELEASE_CORE_SCENARIO");
        const content = await readRegularFile(absolute, `Product fixture resource ${relative}`);
        records.push(Object.freeze({ path: relative, size: content.length, sha256: sha256(content) }));
      }
    }
  }
  await visit(absoluteRoot, relativeRoot);
  assertCondition(records.length > 0,
    `Product fixture root must contain at least one file: ${relativeRoot}`,
    "RELEASE_CORE_SCENARIO");
  return records;
}

async function readScenarioContract(projectRoot, config) {
  const relativePath = config.acceptance.scenarioContract;
  const contractPath = resolveInside(projectRoot, relativePath, "Product scenario contract path");
  const { source, value } = await readJsonRegular(contractPath, "Product scenario contract");
  assertCondition(canonicalJson(value).equals(source),
    "Product scenario contract must use canonical deterministic JSON serialization",
    "RELEASE_CORE_SCENARIO");
  const contract = validateProductScenarios(value, config);
  const resourceLists = await Promise.all(contract.materializer.roots.map((root) =>
    readRegularTreeFiles(projectRoot, root.source)));
  const resources = resourceLists.flat().sort((left, right) =>
    left.path.localeCompare(right.path, "en"));
  assertCondition(new Set(resources.map((record) => record.path)).size === resources.length,
    "Product scenario materializer roots overlap");
  const contractRecord = Object.freeze({
    path: relativePath,
    size: source.length,
    sha256: sha256(source),
  });
  const digestSha256 = sha256(canonicalJson({
    schemaVersion: 1,
    contract: contractRecord,
    resources,
  }));
  return Object.freeze({
    contract,
    record: Object.freeze({
      ...contractRecord,
      resources: Object.freeze(resources),
      digestSha256,
    }),
  });
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
  assertCondition(packageJson.engines?.node === config.build.node,
    "package.json engines.node must match the release config build node");
  assertCondition(packageJson.packageManager === config.build.packageManager,
    "package.json packageManager must match the release config build packageManager");
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
  const nodeVersionPath = resolveInside(root, config.paths.nodeVersion, "Node version path");
  const workflowPath = resolveInside(root, config.build.workflow, "Release workflow path");
  const [manifestRecord, packageRecord, packageLockRecord, versionsRecord, nodeVersionSource,
    workflowSource, scenarioContract] = await Promise.all([
    readJsonRegular(manifestPath, "manifest.json"),
    readJsonRegular(packagePath, "package.json"),
    readJsonRegular(packageLockPath, "package-lock.json"),
    readJsonRegular(versionsPath, "versions.json"),
    readRegularFile(nodeVersionPath, ".node-version"),
    readRegularFile(workflowPath, "Generated release workflow"),
    readScenarioContract(root, config),
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
  assertCondition(nodeVersionSource.equals(Buffer.from(`${config.build.node}\n`, "utf8")),
    ".node-version must contain the exact configured Node version and one LF");
  const expectedWorkflow = renderReleaseWorkflow(config);
  assertCondition(workflowSource.equals(expectedWorkflow),
    "Release workflow differs from the canonical generated workflow",
    "RELEASE_CORE_WORKFLOW");
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
    packageLock: Object.freeze(packageLockRecord.value),
    assets: production.assets,
    distRoot: production.distRoot,
    source,
    build: Object.freeze({
      nodeVersion: Object.freeze({
        path: config.paths.nodeVersion,
        size: nodeVersionSource.length,
        sha256: sha256(nodeVersionSource),
      }),
      lockfile: Object.freeze({
        path: config.paths.packageLock,
        size: packageLockRecord.source.length,
        sha256: sha256(packageLockRecord.source),
      }),
      workflow: Object.freeze({
        path: config.build.workflow,
        size: workflowSource.length,
        sha256: sha256(workflowSource),
      }),
    }),
    acceptance: scenarioContract,
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

export function computeProductPayloadDigest(records) {
  assertCondition(Array.isArray(records) && records.length >= 2,
    "Product payload requires at least main.js and manifest.json records");
  const normalized = records.map((record) => {
    assertAssetRecordShape(record, "Product payload asset");
    return { name: record.name, size: record.size, sha256: record.sha256 };
  }).sort((left, right) => left.name.localeCompare(right.name, "en"));
  assertCondition(new Set(normalized.map((record) => record.name)).size === normalized.length,
    "Product payload asset names must be unique");
  return sha256(canonicalJson({ schemaVersion: 1, assets: normalized }));
}

export async function buildCandidateBundle({
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
    entries: Object.freeze(zipEntries.map((entry) => entry.name).sort((left, right) =>
      left.localeCompare(right, "en"))),
  });
  const publicRecords = [...productionRecords, assetRecord(releaseArchiveName, archive)]
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const checksumBytes = buildSha256Sums(publicRecords);
  const checksumRecord = assetRecord("SHA256SUMS", checksumBytes);
  const candidateBundle = Object.freeze({
    schemaVersion: CANDIDATE_BUNDLE_SCHEMA_VERSION,
    kind: CANDIDATE_BUNDLE_KIND,
    plugin: Object.freeze({
      id: project.config.plugin.id,
      name: project.config.plugin.name,
      version: project.version,
      minAppVersion: project.config.plugin.minAppVersion,
      isDesktopOnly: project.config.plugin.isDesktopOnly,
    }),
    source: Object.freeze({
      commit: project.source.commit,
      tree: project.source.tree,
      targetTag: Object.freeze({ name: project.version, commit: project.source.commit }),
    }),
    product: Object.freeze({
      payloadSha256: computeProductPayloadDigest(productionRecords),
      assets: Object.freeze(productionRecords),
    }),
    build: Object.freeze({
      toolchain: Object.freeze({
        node: project.config.build.node,
        packageManager: project.config.build.packageManager,
      }),
      commands: Object.freeze({
        install: project.config.build.installCommand,
        verify: project.config.build.verifyCommand,
      }),
      nodeVersion: project.build.nodeVersion,
      lockfile: project.build.lockfile,
      workflow: project.build.workflow,
      releaseCore: Object.freeze({ version: core.version, vendoredSha256: core.sha256 }),
    }),
    acceptance: Object.freeze({ scenarioContract: project.acceptance.record }),
    distribution: Object.freeze({
      archive: archiveRecord,
      checksums: checksumRecord,
      publicAssets: Object.freeze(publicRecords),
    }),
  });
  const bundleBytes = canonicalJson(candidateBundle);
  const bundleSha256 = sha256(bundleBytes);
  const files = new Map(project.assets);
  files.set(releaseArchiveName, archive);
  files.set("SHA256SUMS", checksumBytes);
  files.set("candidate-bundle.json", bundleBytes);
  const bundleDirectory = await createExactDirectory(
    assertNonEmptyString(outputDirectory, "outputDirectory"), files);
  return Object.freeze({
    status: "created",
    bundleDirectory,
    candidateBundle,
    bundleSha256,
    productPayloadSha256: candidateBundle.product.payloadSha256,
    scenarioContractSha256: candidateBundle.acceptance.scenarioContract.digestSha256,
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

function assertPathRecordShape(record, label) {
  assertExactKeys(record, ["path", "size", "sha256"], ["path", "size", "sha256"], label);
  assertSafeRelativePath(record.path, `${label} path`);
  assertCondition(Number.isSafeInteger(record.size) && record.size >= 0,
    `${label} size must be a non-negative integer`);
  assertSha256(record.sha256, `${label} sha256`);
}

function assertScenarioContractRecordShape(record, config) {
  assertExactKeys(record, ["path", "size", "sha256", "resources", "digestSha256"],
    ["path", "size", "sha256", "resources", "digestSha256"],
    "Candidate Bundle scenario contract");
  assertPathRecordShape({ path: record.path, size: record.size, sha256: record.sha256 },
    "Candidate Bundle scenario contract file");
  assertCondition(record.path === config.acceptance.scenarioContract,
    "Candidate Bundle scenario contract path differs from release config");
  assertCondition(Array.isArray(record.resources) && record.resources.length > 0,
    "Candidate Bundle scenario resources must be a non-empty array");
  for (const resource of record.resources) {
    assertPathRecordShape(resource, "Candidate Bundle scenario resource");
  }
  const resourcePaths = record.resources.map((resource) => resource.path);
  assertCondition(new Set(resourcePaths).size === resourcePaths.length,
    "Candidate Bundle scenario resource paths must be unique");
  const sortedResourcePaths = [...resourcePaths].sort((left, right) =>
    left.localeCompare(right, "en"));
  assertCondition(JSON.stringify(resourcePaths) === JSON.stringify(sortedResourcePaths),
    "Candidate Bundle scenario resources must be sorted");
  assertSha256(record.digestSha256, "Candidate Bundle scenario contract digest");
  const expectedDigest = sha256(canonicalJson({
    schemaVersion: 1,
    contract: { path: record.path, size: record.size, sha256: record.sha256 },
    resources: record.resources,
  }));
  assertCondition(record.digestSha256 === expectedDigest,
    "Candidate Bundle scenario contract aggregate digest is invalid");
}

function assertCandidateBundleShape(candidateBundle, config) {
  assertExactKeys(candidateBundle,
    ["schemaVersion", "kind", "plugin", "source", "product", "build", "acceptance", "distribution"],
    ["schemaVersion", "kind", "plugin", "source", "product", "build", "acceptance", "distribution"],
    "Candidate Bundle");
  assertCondition(candidateBundle.schemaVersion === CANDIDATE_BUNDLE_SCHEMA_VERSION,
    `Candidate Bundle schemaVersion must be ${CANDIDATE_BUNDLE_SCHEMA_VERSION}`);
  assertCondition(candidateBundle.kind === CANDIDATE_BUNDLE_KIND,
    `Candidate Bundle kind must be ${CANDIDATE_BUNDLE_KIND}`);
  assertExactKeys(candidateBundle.plugin,
    ["id", "name", "version", "minAppVersion", "isDesktopOnly"],
    ["id", "name", "version", "minAppVersion", "isDesktopOnly"],
    "Candidate Bundle plugin");
  assertCondition(candidateBundle.plugin.id === config.plugin.id &&
    candidateBundle.plugin.name === config.plugin.name &&
    candidateBundle.plugin.minAppVersion === config.plugin.minAppVersion &&
    candidateBundle.plugin.isDesktopOnly === config.plugin.isDesktopOnly,
  "Candidate Bundle plugin identity must match release config");
  assertStableVersion(candidateBundle.plugin.version, "Candidate Bundle plugin version");
  assertExactKeys(candidateBundle.source, ["commit", "tree", "targetTag"],
    ["commit", "tree", "targetTag"], "Candidate Bundle source");
  assertGitObject(candidateBundle.source.commit, "Candidate Bundle source commit");
  assertGitObject(candidateBundle.source.tree, "Candidate Bundle source tree");
  assertExactKeys(candidateBundle.source.targetTag, ["name", "commit"], ["name", "commit"],
    "Candidate Bundle target tag");
  assertCondition(candidateBundle.source.targetTag.name === candidateBundle.plugin.version &&
    candidateBundle.source.targetTag.commit === candidateBundle.source.commit,
  "Candidate Bundle target tag must bind the plugin version and source commit");

  assertExactKeys(candidateBundle.product, ["payloadSha256", "assets"],
    ["payloadSha256", "assets"], "Candidate Bundle product");
  assertCondition(Array.isArray(candidateBundle.product.assets) &&
    candidateBundle.product.assets.length >= 2, "Candidate Bundle product assets must be an array");
  for (const record of candidateBundle.product.assets) {
    assertAssetRecordShape(record, "Candidate Bundle product asset");
  }
  assertCondition(candidateBundle.product.payloadSha256 ===
    computeProductPayloadDigest(candidateBundle.product.assets),
  "Candidate Bundle product payload digest is invalid");

  assertExactKeys(candidateBundle.build,
    ["toolchain", "commands", "nodeVersion", "lockfile", "workflow", "releaseCore"],
    ["toolchain", "commands", "nodeVersion", "lockfile", "workflow", "releaseCore"],
    "Candidate Bundle build");
  assertExactKeys(candidateBundle.build.toolchain, ["node", "packageManager"],
    ["node", "packageManager"], "Candidate Bundle toolchain");
  assertCondition(candidateBundle.build.toolchain.node === config.build.node &&
    candidateBundle.build.toolchain.packageManager === config.build.packageManager,
  "Candidate Bundle toolchain differs from release config");
  assertExactKeys(candidateBundle.build.commands, ["install", "verify"],
    ["install", "verify"], "Candidate Bundle build commands");
  assertCondition(candidateBundle.build.commands.install === config.build.installCommand &&
    candidateBundle.build.commands.verify === config.build.verifyCommand,
  "Candidate Bundle build commands differ from release config");
  for (const [name, record] of Object.entries({
    nodeVersion: candidateBundle.build.nodeVersion,
    lockfile: candidateBundle.build.lockfile,
    workflow: candidateBundle.build.workflow,
  })) {
    assertPathRecordShape(record, `Candidate Bundle build ${name}`);
  }
  assertCondition(candidateBundle.build.nodeVersion.path === config.paths.nodeVersion &&
    candidateBundle.build.lockfile.path === config.paths.packageLock &&
    candidateBundle.build.workflow.path === config.build.workflow,
  "Candidate Bundle build paths differ from release config");
  assertExactKeys(candidateBundle.build.releaseCore, ["version", "vendoredSha256"],
    ["version", "vendoredSha256"], "Candidate Bundle releaseCore");
  assertCondition(candidateBundle.build.releaseCore.version === RELEASE_CORE_VERSION,
    "Candidate Bundle release-core version differs from this runtime");
  assertSha256(candidateBundle.build.releaseCore.vendoredSha256,
    "Candidate Bundle release-core digest");

  assertExactKeys(candidateBundle.acceptance, ["scenarioContract"], ["scenarioContract"],
    "Candidate Bundle acceptance");
  assertScenarioContractRecordShape(candidateBundle.acceptance.scenarioContract, config);

  assertExactKeys(candidateBundle.distribution, ["archive", "checksums", "publicAssets"],
    ["archive", "checksums", "publicAssets"], "Candidate Bundle distribution");
  assertExactKeys(candidateBundle.distribution.archive, ["name", "size", "sha256", "entries"],
    ["name", "size", "sha256", "entries"], "Candidate Bundle archive");
  const archiveRecord = candidateBundle.distribution.archive;
  assertPublicAssetName(archiveRecord.name);
  assertCondition(Number.isSafeInteger(archiveRecord.size) && archiveRecord.size > 0,
    "Candidate Bundle archive size must be positive");
  assertSha256(archiveRecord.sha256, "Candidate Bundle archive digest");
  assertCondition(Array.isArray(archiveRecord.entries) && archiveRecord.entries.length >= 2,
    "Candidate Bundle archive entries must be an array");
  for (const name of archiveRecord.entries) normalizeArchiveName(name);
  assertAssetRecordShape(candidateBundle.distribution.checksums,
    "Candidate Bundle checksums");
  assertCondition(candidateBundle.distribution.checksums.name === "SHA256SUMS",
    "Candidate Bundle checksums name must be SHA256SUMS");
  assertCondition(Array.isArray(candidateBundle.distribution.publicAssets) &&
    candidateBundle.distribution.publicAssets.length >= 3,
  "Candidate Bundle public assets must be an array");
  for (const record of candidateBundle.distribution.publicAssets) {
    assertAssetRecordShape(record, "Candidate Bundle public asset");
  }
}

function assertExactNameList(actual, expected, label) {
  const actualSorted = [...actual].sort((left, right) => left.localeCompare(right, "en"));
  const expectedSorted = [...expected].sort((left, right) => left.localeCompare(right, "en"));
  assertCondition(JSON.stringify(actualSorted) === JSON.stringify(expectedSorted),
    `${label} must be exactly: ${expectedSorted.join(", ")}`);
}

async function verifyCandidateBundleContents({ config, bundleDirectory }) {
  const bundleRoot = path.resolve(assertNonEmptyString(bundleDirectory, "bundleDirectory"));
  await assertRegularDirectory(bundleRoot, "Candidate Bundle directory");
  const bundleBytes = await readRegularFile(path.join(bundleRoot, "candidate-bundle.json"),
    "candidate-bundle.json");
  let candidateBundle;
  try {
    candidateBundle = JSON.parse(bundleBytes.toString("utf8"));
  } catch (error) {
    fail("candidate-bundle.json is invalid UTF-8 JSON", "RELEASE_CORE_CANDIDATE", {
      cause: error,
    });
  }
  assertCandidateBundleShape(candidateBundle, config);
  assertCondition(canonicalJson(candidateBundle).equals(bundleBytes),
    "candidate-bundle.json must use canonical deterministic serialization",
    "RELEASE_CORE_CANDIDATE");
  const core = await getReleaseCoreIdentity();
  assertCondition(candidateBundle.build.releaseCore.vendoredSha256 === core.sha256,
    "Candidate Bundle was built by different release-core bytes",
    "RELEASE_CORE_CANDIDATE");

  const productNames = candidateBundle.product.assets.map((record) => record.name);
  const expectedProductNames = config.assets.styles === "required"
    ? ["main.js", "manifest.json", "styles.css"]
    : productNames.includes("styles.css")
      ? ["main.js", "manifest.json", "styles.css"]
      : ["main.js", "manifest.json"];
  assertExactNameList(productNames, expectedProductNames,
    "Candidate Bundle product asset inventory");
  const expectedArchiveName = archiveName(config.plugin.id, candidateBundle.plugin.version);
  assertCondition(candidateBundle.distribution.archive.name === expectedArchiveName,
    "Candidate Bundle archive name is invalid");
  const expectedPublicNames = [...expectedProductNames, expectedArchiveName];
  const expectedBundleNames = [...expectedPublicNames, "SHA256SUMS", "candidate-bundle.json"];
  const entries = await readdir(bundleRoot, { withFileTypes: true });
  for (const entry of entries) {
    assertCondition(entry.isFile() && !entry.isSymbolicLink(),
      `Candidate Bundle entry must be a regular file: ${entry.name}`,
      "RELEASE_CORE_HANDOFF");
  }
  assertExactNameList(entries.map((entry) => entry.name), expectedBundleNames,
    "Candidate Bundle inventory");

  const publicFiles = new Map();
  for (const name of expectedPublicNames) {
    publicFiles.set(name, await readRegularFile(path.join(bundleRoot, name),
      `Candidate Bundle ${name}`));
  }
  for (const record of candidateBundle.product.assets) {
    const content = publicFiles.get(record.name);
    assertCondition(record.size === content.length && record.sha256 === sha256(content),
      `Candidate Bundle product asset mismatch: ${record.name}`, "RELEASE_CORE_HANDOFF");
  }
  const archiveBytes = publicFiles.get(expectedArchiveName);
  const archiveRecord = candidateBundle.distribution.archive;
  assertCondition(archiveRecord.size === archiveBytes.length &&
    archiveRecord.sha256 === sha256(archiveBytes),
  "Candidate Bundle archive hash/size mismatch", "RELEASE_CORE_HANDOFF");
  const expectedZip = createDeterministicZip(candidateBundle.product.assets.map((record) => ({
    name: `${config.plugin.id}/${record.name}`,
    content: publicFiles.get(record.name),
  })));
  assertCondition(archiveBytes.equals(expectedZip),
    "Release archive is not the deterministic byte-exact wrapper of loose assets",
    "RELEASE_CORE_HANDOFF");
  const parsedArchive = readDeterministicZip(archiveBytes);
  const expectedArchiveEntries = expectedProductNames.map((name) => `${config.plugin.id}/${name}`);
  assertExactNameList(parsedArchive.keys(), expectedArchiveEntries, "Release archive inventory");
  assertExactNameList(archiveRecord.entries, expectedArchiveEntries,
    "Candidate Bundle archive inventory");
  for (const name of expectedProductNames) {
    assertCondition(parsedArchive.get(`${config.plugin.id}/${name}`).equals(publicFiles.get(name)),
      `Release archive entry differs from loose asset: ${name}`, "RELEASE_CORE_HANDOFF");
  }
  const publicRecords = expectedPublicNames.map((name) => assetRecord(name, publicFiles.get(name)))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  assertCondition(JSON.stringify(publicRecords) ===
    JSON.stringify(candidateBundle.distribution.publicAssets),
  "Candidate Bundle public asset records are invalid", "RELEASE_CORE_HANDOFF");
  const checksumBytes = await readRegularFile(path.join(bundleRoot, "SHA256SUMS"), "SHA256SUMS");
  assertCondition(checksumBytes.equals(buildSha256Sums(publicRecords)),
    "SHA256SUMS does not exactly match sorted public assets", "RELEASE_CORE_HANDOFF");
  assertCondition(candidateBundle.distribution.checksums.size === checksumBytes.length &&
    candidateBundle.distribution.checksums.sha256 === sha256(checksumBytes),
  "Candidate Bundle checksum record mismatch", "RELEASE_CORE_HANDOFF");
  return Object.freeze({
    status: "transport-verified",
    bundleDirectory: bundleRoot,
    candidateBundle: Object.freeze(candidateBundle),
    bundleSha256: sha256(bundleBytes),
    productPayloadSha256: candidateBundle.product.payloadSha256,
    scenarioContractSha256: candidateBundle.acceptance.scenarioContract.digestSha256,
    publicAssets: Object.freeze(publicRecords),
    publicFiles,
  });
}

export async function verifyCandidateBundleArchive({ config: configInput, bundleDirectory }) {
  const config = validateReleaseConfig(configInput);
  return verifyCandidateBundleContents({ config, bundleDirectory });
}

function assertRecordEqual(actual, expected, label) {
  assertCondition(JSON.stringify(actual) === JSON.stringify(expected), `${label} differs`);
}

async function readTransportSourceMetadata({ projectRoot, config, version, commandRunner,
  requireClean }) {
  const root = path.resolve(projectRoot);
  const manifestPath = resolveInside(root, config.paths.manifest, "Manifest path");
  const packagePath = resolveInside(root, config.paths.package, "Package path");
  const packageLockPath = resolveInside(root, config.paths.packageLock, "Package lock path");
  const versionsPath = resolveInside(root, config.paths.versions, "Versions path");
  const nodeVersionPath = resolveInside(root, config.paths.nodeVersion, "Node version path");
  const workflowPath = resolveInside(root, config.build.workflow, "Release workflow path");
  const [manifestRecord, packageRecord, packageLockRecord, versionsRecord, nodeVersionSource,
    workflowSource, scenarioContract] = await Promise.all([
    readJsonRegular(manifestPath, "manifest.json"),
    readJsonRegular(packagePath, "package.json"),
    readJsonRegular(packageLockPath, "package-lock.json"),
    readJsonRegular(versionsPath, "versions.json"),
    readRegularFile(nodeVersionPath, ".node-version"),
    readRegularFile(workflowPath, "Generated release workflow"),
    readScenarioContract(root, config),
  ]);
  const releaseVersion = assertPackageContract(manifestRecord.value, packageRecord.value,
    packageLockRecord.value, versionsRecord.value, config, version);
  assertCondition(nodeVersionSource.equals(Buffer.from(`${config.build.node}\n`, "utf8")),
    ".node-version must contain the exact configured Node version and one LF");
  assertCondition(workflowSource.equals(renderReleaseWorkflow(config)),
    "Release workflow differs from the canonical generated workflow",
    "RELEASE_CORE_WORKFLOW");
  const source = await readGitIdentity(root, releaseVersion, commandRunner, {
    checkTag: true,
    requireClean,
  });
  return Object.freeze({
    root,
    source,
    manifestSource: manifestRecord.source,
    build: Object.freeze({
      nodeVersion: Object.freeze({ path: config.paths.nodeVersion, size: nodeVersionSource.length,
        sha256: sha256(nodeVersionSource) }),
      lockfile: Object.freeze({ path: config.paths.packageLock, size: packageLockRecord.source.length,
        sha256: sha256(packageLockRecord.source) }),
      workflow: Object.freeze({ path: config.build.workflow, size: workflowSource.length,
        sha256: sha256(workflowSource) }),
    }),
    acceptance: scenarioContract,
  });
}

export async function verifyTransportCandidateBundle({
  projectRoot,
  config: configInput,
  bundleDirectory,
  commandRunner = defaultCommandRunner,
  requireClean = true,
}) {
  const config = validateReleaseConfig(configInput);
  const verified = await verifyCandidateBundleContents({ config, bundleDirectory });
  const metadata = await readTransportSourceMetadata({
    projectRoot,
    config,
    version: verified.candidateBundle.plugin.version,
    commandRunner,
    requireClean,
  });
  const candidateBundle = verified.candidateBundle;
  assertCondition(candidateBundle.source.commit === metadata.source.commit &&
    candidateBundle.source.tree === metadata.source.tree,
  "Candidate Bundle source commit/tree differs from the current project",
  "RELEASE_CORE_CANDIDATE");
  assertCondition(verified.publicFiles.get("manifest.json").equals(metadata.manifestSource),
    "Candidate Bundle manifest differs from the source manifest",
    "RELEASE_CORE_CANDIDATE");
  assertRecordEqual(candidateBundle.build.nodeVersion, metadata.build.nodeVersion,
    "Candidate Bundle Node version identity");
  assertRecordEqual(candidateBundle.build.lockfile, metadata.build.lockfile,
    "Candidate Bundle lockfile identity");
  assertRecordEqual(candidateBundle.build.workflow, metadata.build.workflow,
    "Candidate Bundle workflow identity");
  assertRecordEqual(candidateBundle.acceptance.scenarioContract, metadata.acceptance.record,
    "Candidate Bundle scenario contract identity");
  return verified;
}

export async function verifySourceCandidateBundle(options) {
  const config = validateReleaseConfig(options.config);
  const verified = await verifyTransportCandidateBundle({ ...options, config });
  const project = await validateReleaseProject({
    projectRoot: options.projectRoot,
    config,
    version: verified.candidateBundle.plugin.version,
    checkTag: true,
    requireClean: options.requireClean ?? true,
    commandRunner: options.commandRunner ?? defaultCommandRunner,
  });
  for (const [name, content] of project.assets) {
    assertCondition(verified.publicFiles.get(name)?.equals(content),
      `Candidate Bundle differs from current production asset: ${name}`,
      "RELEASE_CORE_CANDIDATE");
  }
  return Object.freeze({ ...verified, status: "source-verified" });
}

export function buildPublicationAuthorization({
  repository,
  tag,
  commit,
  bundleSha256,
  acceptanceClosureSha256,
}) {
  assertCondition(repositoryPattern.test(assertNonEmptyString(repository, "Publication repository")),
    "Publication repository must use owner/name");
  assertStableVersion(tag, "Publication tag");
  assertGitObject(commit, "Publication commit");
  assertSha256(bundleSha256, "Publication Candidate Bundle digest");
  assertSha256(acceptanceClosureSha256, "Publication acceptance closure digest");
  return `publish ${repository}@${tag} commit=${commit} bundle=${bundleSha256} acceptance=${acceptanceClosureSha256}`;
}

async function assertCurrentExactTag(projectRoot, candidateBundle, commandRunner) {
  const current = await readGitIdentity(projectRoot, candidateBundle.plugin.version, commandRunner);
  assertCondition(current.tag.state === "exact",
    `Publication requires the exact current tag ${candidateBundle.plugin.version}`,
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  assertCondition(current.commit === candidateBundle.source.commit &&
    current.tree === candidateBundle.source.tree,
  "Publication tag/source differs from Candidate Bundle commit/tree",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  return current;
}

export async function validatePublicationBoundary({
  projectRoot,
  config: configInput,
  verifiedBundle,
  bundleSha256,
  acceptanceClosurePath,
  acceptanceClosureSha256,
  authorization,
  commandRunner = defaultCommandRunner,
}) {
  const config = validateReleaseConfig(configInput);
  assertPlainObject(verifiedBundle, "verifiedBundle");
  assertSha256(bundleSha256, "Expected Candidate Bundle digest");
  assertCondition(bundleSha256 === verifiedBundle.bundleSha256,
    "Expected Candidate Bundle digest does not match candidate-bundle.json",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  assertSha256(acceptanceClosureSha256, "Expected acceptance closure digest");
  const closure = await readRegularFile(path.resolve(assertNonEmptyString(acceptanceClosurePath,
    "acceptanceClosurePath")), "Acceptance closure");
  assertCondition(closure.length > 0, "Acceptance closure must not be empty",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  assertCondition(sha256(closure) === acceptanceClosureSha256,
    "Acceptance closure digest mismatch", "RELEASE_CORE_PUBLICATION_BOUNDARY");
  await assertCurrentExactTag(path.resolve(projectRoot), verifiedBundle.candidateBundle,
    commandRunner);
  const expectedAuthorization = buildPublicationAuthorization({
    repository: config.publication.repository,
    tag: verifiedBundle.candidateBundle.plugin.version,
    commit: verifiedBundle.candidateBundle.source.commit,
    bundleSha256,
    acceptanceClosureSha256,
  });
  assertCondition(typeof authorization === "string" && authorization === expectedAuthorization,
    "Manual publication authorization is missing or does not bind the exact Candidate Bundle and acceptance closure",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  return Object.freeze({
    status: "authorized",
    repository: config.publication.repository,
    tag: verifiedBundle.candidateBundle.plugin.version,
    commit: verifiedBundle.candidateBundle.source.commit,
    bundleSha256,
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
  verifiedBundle,
  commandRunner,
  env,
  releaseRecord,
}) {
  const repository = config.publication.repository;
  const candidateBundle = verifiedBundle.candidateBundle;
  const tag = candidateBundle.plugin.version;
  assertPlainObject(releaseRecord, "GitHub Release");
  assertCondition(releaseRecord.tag_name === tag && releaseRecord.draft === false &&
    releaseRecord.prerelease === false && releaseRecord.immutable === true &&
    typeof releaseRecord.published_at === "string" && releaseRecord.published_at.length > 0,
  "GitHub Release must be the exact immutable published stable tag", "RELEASE_CORE_GITHUB");
  assertCondition(Array.isArray(releaseRecord.assets), "GitHub Release assets must be an array",
    "RELEASE_CORE_GITHUB");
  const expectedNames = verifiedBundle.publicAssets.map((record) => record.name);
  assertExactNameList(releaseRecord.assets.map((asset) => asset?.name), expectedNames,
    "GitHub Release public asset inventory");
  const expectedByName = new Map(verifiedBundle.publicAssets.map((record) => [record.name, record]));
  for (const asset of releaseRecord.assets) {
    assertPlainObject(asset, `GitHub Release asset ${String(asset?.name)}`);
    const expected = expectedByName.get(asset.name);
    assertCondition((typeof asset.id === "number" || typeof asset.id === "string") &&
      asset.size === expected.size && asset.state === "uploaded" &&
      asset.digest === `sha256:${expected.sha256}`,
    `GitHub Release asset metadata mismatch: ${asset.name}`, "RELEASE_CORE_GITHUB");
    const hosted = await githubAssetBytes(commandRunner, repository, asset.id,
      { cwd: projectRoot, env });
    assertCondition(hosted.equals(verifiedBundle.publicFiles.get(asset.name)),
      `GitHub Release hosted bytes mismatch: ${asset.name}`, "RELEASE_CORE_GITHUB");
    await invokeCommand(commandRunner, "gh", [
      "attestation",
      "verify",
      path.join(verifiedBundle.bundleDirectory, asset.name),
      "--repo",
      repository,
      "--signer-workflow",
      `${repository}/.github/workflows/release.yml`,
      "--source-ref",
      `refs/tags/${tag}`,
      "--source-digest",
      candidateBundle.source.commit,
      "--deny-self-hosted-runners",
    ], { cwd: projectRoot, env });
  }
  const remoteTagCommit = await resolveRemoteTagCommit(commandRunner, repository, tag,
    { cwd: projectRoot, env });
  assertCondition(remoteTagCommit === candidateBundle.source.commit,
    "GitHub tag source commit differs from Candidate Bundle source", "RELEASE_CORE_GITHUB");
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
  verifiedBundle,
  commandRunner = defaultCommandRunner,
  env = process.env,
  releaseRecord,
}) {
  const config = validateReleaseConfig(configInput);
  await assertCurrentExactTag(path.resolve(projectRoot), verifiedBundle.candidateBundle,
    commandRunner);
  const record = releaseRecord ?? await fetchRelease(commandRunner, config.publication.repository,
    verifiedBundle.candidateBundle.plugin.version, { cwd: projectRoot, env }, false);
  return verifyHostedRecord({
    projectRoot: path.resolve(projectRoot),
    config,
    verifiedBundle,
    commandRunner,
    env,
    releaseRecord: record,
  });
}

async function inspectExistingGitHubRelease({
  projectRoot,
  config,
  verifiedBundle,
  commandRunner,
  env,
}) {
  const repository = config.publication.repository;
  const tag = verifiedBundle.candidateBundle.plugin.version;
  const existing = await fetchRelease(commandRunner, repository, tag,
    { cwd: projectRoot, env }, true);
  if (existing === null) {
    return Object.freeze({ status: "missing", repository, tag });
  }
  const verified = await verifyPublishedRelease({
    projectRoot,
    config,
    verifiedBundle,
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
  verifiedBundle,
  bundleSha256,
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
    verifiedBundle,
    bundleSha256,
    acceptanceClosurePath,
    acceptanceClosureSha256,
    authorization,
    commandRunner,
  });
  return inspectExistingGitHubRelease({
    projectRoot: root,
    config,
    verifiedBundle,
    commandRunner,
    env,
  });
}

async function publishGitHub({
  projectRoot,
  config: configInput,
  verifiedBundle,
  boundary,
  commandRunner,
  env,
  notesFile,
}) {
  const config = validateReleaseConfig(configInput);
  assertCondition(boundary?.status === "authorized", "Publication boundary is not authorized",
    "RELEASE_CORE_PUBLICATION_BOUNDARY");
  const tag = verifiedBundle.candidateBundle.plugin.version;
  const preflight = await inspectExistingGitHubRelease({
    projectRoot,
    config,
    verifiedBundle,
    commandRunner,
    env,
  });
  if (preflight.status === "exact") {
    return Object.freeze({ status: "noop", repository: config.publication.repository, tag });
  }
  const arguments_ = ["release", "create", tag];
  for (const record of verifiedBundle.publicAssets) {
    arguments_.push(path.join(verifiedBundle.bundleDirectory, record.name));
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
  await verifyPublishedRelease({ projectRoot, config, verifiedBundle, commandRunner, env });
  return Object.freeze({ status: "created", repository: config.publication.repository, tag });
}

function workflowSource(npmVersion) {
  return `name: Release
run-name: release \${{ inputs.release_run_id }}

on:
  workflow_dispatch:
    inputs:
      release_run_id:
        description: Stable workspace release-run UUID
        required: true
        type: string
      mode:
        description: Explicit release operation
        required: true
        default: verify
        type: choice
        options:
          - verify
          - publish
      candidate_commit:
        description: Exact accepted source commit
        required: true
        type: string
      candidate_bundle_digest:
        description: SHA-256 of candidate-bundle.json
        required: true
        type: string
      acceptance_closure_digest:
        description: SHA-256 of the decoded acceptance closure
        required: true
        type: string
      acceptance_closure_b64:
        description: Canonical base64 acceptance closure
        required: true
        type: string
      release_authorization:
        description: Exact publication authorization phrase
        required: true
        type: string
      authorization_digest:
        description: SHA-256 of the decoded authorization record
        required: true
        type: string
      authorization_b64:
        description: Canonical base64 authorization record
        required: true
        type: string

permissions:
  contents: read

concurrency:
  group: release-\${{ github.repository }}
  cancel-in-progress: false

jobs:
  verify:
    name: Rebuild and verify exact Candidate Bundle
    if: github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    permissions:
      contents: read
    outputs:
      bundle_artifact_id: \${{ steps.bundle.outputs.artifact-id }}
      bundle_artifact_digest: \${{ steps.bundle.outputs.artifact-digest }}
    steps:
      - name: Validate dispatch identifiers
        shell: bash
        env:
          MODE: \${{ github.event.inputs.mode }}
          RELEASE_RUN_ID: \${{ inputs.release_run_id }}
          CANDIDATE_COMMIT: \${{ inputs.candidate_commit }}
          CANDIDATE_BUNDLE_DIGEST: \${{ inputs.candidate_bundle_digest }}
          ACCEPTANCE_CLOSURE_DIGEST: \${{ inputs.acceptance_closure_digest }}
          AUTHORIZATION_DIGEST: \${{ inputs.authorization_digest }}
        run: |
          set -euo pipefail
          [[ "$MODE" == "verify" || "$MODE" == "publish" ]]
          [[ "$RELEASE_RUN_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]]
          [[ "$CANDIDATE_COMMIT" =~ ^[0-9a-f]{40}$|^[0-9a-f]{64}$ ]]
          [[ "$CANDIDATE_BUNDLE_DIGEST" =~ ^[0-9a-f]{64}$ ]]
          [[ "$ACCEPTANCE_CLOSURE_DIGEST" =~ ^[0-9a-f]{64}$ ]]
          [[ "$AUTHORIZATION_DIGEST" =~ ^[0-9a-f]{64}$ ]]
          test "$CANDIDATE_COMMIT" = "$GITHUB_SHA"
          [[ "$GITHUB_REF_TYPE" == "tag" ]]
          [[ "$GITHUB_REF_NAME" =~ ^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$ ]]

      - name: Check out the exact source without persisted credentials
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ inputs.candidate_commit }}
          fetch-depth: 0
          persist-credentials: false

      - name: Verify tagged source identity
        shell: bash
        env:
          DEFAULT_BRANCH: \${{ github.event.repository.default_branch }}
        run: |
          set -euo pipefail
          test "$(git rev-parse --verify HEAD)" = "$GITHUB_SHA"
          test "$(git rev-parse --verify "refs/tags/$GITHUB_REF_NAME^{commit}")" = "$GITHUB_SHA"
          git merge-base --is-ancestor "$GITHUB_SHA" "origin/$DEFAULT_BRANCH"
          test -z "$(git status --porcelain=v1 --untracked-files=all)"

      - name: Set up exact Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version-file: .node-version
          cache: npm

      - name: Install exact npm
        shell: bash
        run: |
          set -euo pipefail
          npm install --global npm@${npmVersion} --no-audit --no-fund
          test "$(npm --version)" = "${npmVersion}"

      - name: Install locked dependencies
        run: ${requiredInstallCommand}

      - name: Run the one complete repository build and verification pass
        run: ${requiredVerifyCommand}

      - name: Build deterministic Candidate Bundle
        run: >-
          node scripts/release.mjs bundle
          --version "$GITHUB_REF_NAME"
          --output-dir "$RUNNER_TEMP/candidate-bundle"

      - name: Verify source candidate and expected Bundle identity
        shell: bash
        env:
          CANDIDATE_BUNDLE_DIGEST: \${{ inputs.candidate_bundle_digest }}
        run: |
          set -euo pipefail
          test "$(sha256sum "$RUNNER_TEMP/candidate-bundle/candidate-bundle.json" | cut -d ' ' -f 1)" = "$CANDIDATE_BUNDLE_DIGEST"
          node scripts/release.mjs verify-source --bundle-dir "$RUNNER_TEMP/candidate-bundle"

      - name: Upload fixed Candidate Bundle
        id: bundle
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7
        with:
          name: candidate-bundle-\${{ inputs.release_run_id }}
          path: \${{ runner.temp }}/candidate-bundle/
          if-no-files-found: error
          compression-level: 0
          overwrite: false
          retention-days: 1

  publish:
    name: Publish explicitly authorized Candidate Bundle
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.mode == 'publish'
    needs: verify
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: release
    permissions:
      actions: read
      attestations: write
      contents: write
      id-token: write
    steps:
      - name: Check out the exact source without persisted credentials
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ inputs.candidate_commit }}
          fetch-depth: 0
          persist-credentials: false

      - name: Set up exact Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version-file: .node-version

      - name: Download fixed Candidate Bundle by artifact ID
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          artifact-ids: \${{ needs.verify.outputs.bundle_artifact_id }}
          path: \${{ runner.temp }}/candidate-bundle
          digest-mismatch: error

      - name: Materialize exact acceptance and authorization evidence
        env:
          ACCEPTANCE_CLOSURE_B64: \${{ inputs.acceptance_closure_b64 }}
          AUTHORIZATION_B64: \${{ inputs.authorization_b64 }}
          RELEASE_PUBLISH_AUTHORIZATION: \${{ inputs.release_authorization }}
        run: >-
          node scripts/release.mjs materialize-evidence
          --bundle-dir "$RUNNER_TEMP/candidate-bundle"
          --output-dir "$RUNNER_TEMP/release-evidence"
          --run-id "\${{ inputs.release_run_id }}"
          --bundle-digest "\${{ inputs.candidate_bundle_digest }}"
          --acceptance-closure-digest "\${{ inputs.acceptance_closure_digest }}"
          --authorization-digest "\${{ inputs.authorization_digest }}"

      - name: Verify transported Bundle without rebuilding
        shell: bash
        env:
          ARTIFACT_DIGEST: \${{ needs.verify.outputs.bundle_artifact_digest }}
        run: |
          set -euo pipefail
          [[ "$ARTIFACT_DIGEST" =~ ^[0-9a-f]{64}$ ]]
          node scripts/release.mjs verify-transport --bundle-dir "$RUNNER_TEMP/candidate-bundle"

      - name: Verify publication boundary before attestation
        env:
          RELEASE_PUBLISH_AUTHORIZATION: \${{ inputs.release_authorization }}
        run: >-
          node scripts/release.mjs publication-boundary
          --bundle-dir "$RUNNER_TEMP/candidate-bundle"
          --bundle-digest "\${{ inputs.candidate_bundle_digest }}"
          --acceptance-closure "$RUNNER_TEMP/release-evidence/acceptance-closure.json"
          --acceptance-closure-digest "\${{ inputs.acceptance_closure_digest }}"

      - name: Preflight immutable GitHub Release
        id: publication_preflight
        shell: bash
        env:
          GH_TOKEN: \${{ github.token }}
          RELEASE_PUBLISH_AUTHORIZATION: \${{ inputs.release_authorization }}
        run: |
          set -euo pipefail
          result_path="$RUNNER_TEMP/publication-preflight.json"
          test ! -e "$result_path"
          node scripts/release.mjs publication-preflight \
            --bundle-dir "$RUNNER_TEMP/candidate-bundle" \
            --bundle-digest "\${{ inputs.candidate_bundle_digest }}" \
            --acceptance-closure "$RUNNER_TEMP/release-evidence/acceptance-closure.json" \
            --acceptance-closure-digest "\${{ inputs.acceptance_closure_digest }}" \
            > "$result_path"
          status="$(node --input-type=module - "$result_path" <<'NODE'
          import assert from "node:assert/strict";
          import { readFileSync } from "node:fs";
          const result = JSON.parse(readFileSync(process.argv[2], "utf8"));
          assert.ok(result.status === "missing" || result.status === "exact");
          process.stdout.write(result.status);
          NODE
          )"
          printf 'status=%s\\n' "$status" >> "$GITHUB_OUTPUT"

      - name: Stage exact public asset inventory
        if: steps.publication_preflight.outputs.status == 'missing'
        run: >-
          node scripts/release.mjs stage-public-assets
          --bundle-dir "$RUNNER_TEMP/candidate-bundle"
          --output-dir "$RUNNER_TEMP/release-public-assets"

      - name: Attest public release assets
        if: steps.publication_preflight.outputs.status == 'missing'
        uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2
        with:
          subject-path: \${{ runner.temp }}/release-public-assets/*

      - name: Create or prove the exact GitHub Release
        if: steps.publication_preflight.outputs.status == 'missing'
        env:
          GH_TOKEN: \${{ github.token }}
          RELEASE_PUBLISH_AUTHORIZATION: \${{ inputs.release_authorization }}
        run: >-
          node scripts/release.mjs publish-github
          --bundle-dir "$RUNNER_TEMP/candidate-bundle"
          --bundle-digest "\${{ inputs.candidate_bundle_digest }}"
          --acceptance-closure "$RUNNER_TEMP/release-evidence/acceptance-closure.json"
          --acceptance-closure-digest "\${{ inputs.acceptance_closure_digest }}"

  post_verify:
    name: Verify immutable hosted release state
    if: always() && github.event_name == 'workflow_dispatch' && github.event.inputs.mode == 'publish'
    needs:
      - verify
      - publish
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    permissions:
      actions: read
      attestations: read
      contents: read
    steps:
      - name: Check out the exact source without persisted credentials
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          ref: \${{ inputs.candidate_commit }}
          fetch-depth: 0
          persist-credentials: false

      - name: Set up exact Node.js
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version-file: .node-version

      - name: Download the same fixed Candidate Bundle
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          artifact-ids: \${{ needs.verify.outputs.bundle_artifact_id }}
          path: \${{ runner.temp }}/candidate-bundle
          digest-mismatch: error

      - name: Reverify transported Bundle without rebuilding
        run: >-
          node scripts/release.mjs verify-transport
          --bundle-dir "$RUNNER_TEMP/candidate-bundle"

      - name: Verify immutable hosted bytes and provenance
        env:
          GH_TOKEN: \${{ github.token }}
        run: >-
          node scripts/release.mjs post-verify
          --bundle-dir "$RUNNER_TEMP/candidate-bundle"
`;
}

export function renderReleaseWorkflow(configInput) {
  const config = validateReleaseConfig(configInput);
  const match = npmPackageManagerPattern.exec(config.build.packageManager);
  assertCondition(match !== null, "Configured package manager is not a supported exact npm pin");
  return Buffer.from(workflowSource(match[1]), "utf8");
}

export async function writeReleaseWorkflow({ projectRoot, config: configInput }) {
  const config = validateReleaseConfig(configInput);
  const root = path.resolve(projectRoot);
  const target = resolveInside(root, config.build.workflow, "Release workflow path");
  const parent = path.dirname(target);
  await assertRegularDirectory(parent, "Release workflow directory");
  await writeFile(target, renderReleaseWorkflow(config), { flag: "w", mode: 0o644 });
  return Object.freeze({ status: "written", workflow: config.build.workflow });
}

export async function checkReleaseWorkflow({ projectRoot, config: configInput }) {
  const config = validateReleaseConfig(configInput);
  const target = resolveInside(path.resolve(projectRoot), config.build.workflow,
    "Release workflow path");
  const actual = await readRegularFile(target, "Generated release workflow");
  assertCondition(actual.equals(renderReleaseWorkflow(config)),
    "Release workflow differs from the canonical generated workflow",
    "RELEASE_CORE_WORKFLOW");
  return Object.freeze({ status: "verified", workflow: config.build.workflow,
    sha256: sha256(actual) });
}

function decodeCanonicalBase64(value, maximumCharacters, maximumBytes, label) {
  assertCondition(typeof value === "string" && value.length > 0 &&
    value.length <= maximumCharacters, `${label} is missing or exceeds its input limit`);
  assertCondition(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value),
    `${label} must use canonical base64`);
  const bytes = Buffer.from(value, "base64");
  assertCondition(bytes.length > 0 && bytes.length <= maximumBytes &&
    bytes.toString("base64") === value, `${label} decoded bytes are invalid`);
  return bytes;
}

function assertPortableJson(value, label) {
  if (typeof value === "string") {
    const frozenGrpcMethod = [
      "/android.emulation.control.EmulatorController/getStatus",
      "/android.emulation.control.EmulatorController/getScreenshot",
      "/android.emulation.control.EmulatorController/sendTouch",
    ].includes(value);
    assertCondition(frozenGrpcMethod || !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value),
      `${label} contains an absolute path`);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) assertPortableJson(child, label);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) assertPortableJson(child, label);
  }
}

function parseCanonicalJson(bytes, label) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail(`${label} is not valid UTF-8 JSON`, "RELEASE_CORE_JSON", { cause: error });
  }
  assertCondition(canonicalJson(value).equals(bytes),
    `${label} must use canonical deterministic JSON serialization`, "RELEASE_CORE_JSON");
  assertPortableJson(value, label);
  return value;
}

function assertCanonicalTimestamp(value, label) {
  assertNonEmptyString(value, label);
  const milliseconds = Date.parse(value);
  assertCondition(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value,
    `${label} must be a canonical UTC ISO-8601 timestamp`);
}

const portableCandidateKeys = Object.freeze([
  "bundleSha256", "pluginId", "version", "commit", "tree", "productPayloadSha256",
  "scenarioContractSha256", "acceptanceCandidateIdentityHash",
]);

function assertPortableCandidate(candidate, label) {
  assertExactKeys(candidate, portableCandidateKeys, portableCandidateKeys, label);
  assertSha256(candidate.bundleSha256, `${label} Bundle digest`);
  assertCondition(pluginIdPattern.test(candidate.pluginId), `${label} plugin id is invalid`);
  assertStableVersion(candidate.version, `${label} version`);
  assertGitObject(candidate.commit, `${label} commit`);
  assertGitObject(candidate.tree, `${label} tree`);
  assertSha256(candidate.productPayloadSha256, `${label} product payload digest`);
  assertSha256(candidate.scenarioContractSha256, `${label} scenario contract digest`);
  assertSha256(candidate.acceptanceCandidateIdentityHash,
    `${label} acceptance candidate identity hash`);
}

function samePortableCandidate(left, right) {
  return portableCandidateKeys.every((key) => left[key] === right[key]);
}

function candidateFromVerifiedBundle(verifiedBundle) {
  const bundle = verifiedBundle.candidateBundle;
  return {
    bundleSha256: verifiedBundle.bundleSha256,
    pluginId: bundle.plugin.id,
    version: bundle.plugin.version,
    commit: bundle.source.commit,
    tree: bundle.source.tree,
    productPayloadSha256: bundle.product.payloadSha256,
    scenarioContractSha256: bundle.acceptance.scenarioContract.digestSha256,
    acceptanceCandidateIdentityHash: acceptanceCandidateIdentityHashFromBundle(bundle),
  };
}

function acceptanceCandidateIdentityHashFromBundle(bundle) {
  const assets = Object.fromEntries([...bundle.product.assets]
    .sort((left, right) => left.name.localeCompare(right.name, "en"))
    .map((asset) => [asset.name, { sha256: asset.sha256, size: asset.size }]));
  return sha256(JSON.stringify({
    pluginId: bundle.plugin.id,
    version: bundle.plugin.version,
    commit: bundle.source.commit,
    tree: bundle.source.tree,
    assets,
  }));
}

function validatePortableProductEvidence(record) {
  assertExactKeys(record,
    ["schemaVersion", "kind", "observedAt", "candidate", "surface", "status", "host",
      "inputTrace", "scenario"],
    ["schemaVersion", "kind", "observedAt", "candidate", "surface", "status", "host",
      "inputTrace", "scenario"],
    "Portable product evidence");
  assertCondition(record.schemaVersion === 3 &&
    record.kind === "obsidian-plugin-workspace/product-evidence-v3",
  "Portable product evidence schema/kind is unsupported");
  assertCanonicalTimestamp(record.observedAt, "Portable product evidence observedAt");
  assertCondition(["desktop", "android-emulator"].includes(record.surface),
    "Portable product evidence surface is invalid");
  assertCondition(record.status === "passed",
    "A passed acceptance closure may contain only passed product evidence");
  assertPortableCandidate(record.candidate, "Portable product evidence candidate");
  assertPlainObject(record.host, "Portable product evidence host");
  for (const field of ["profileId", "platform", "deviceKind", "deviceName", "osVersion",
    "obsidianVersion"]) {
    assertNonEmptyString(record.host[field], `Portable product evidence host ${field}`);
  }
  assertCondition(Array.isArray(record.host.inputMethods) && record.host.inputMethods.length > 0 &&
    record.host.inputMethods.every((value) => typeof value === "string" && value.length > 0),
  "Portable product evidence host inputMethods are invalid");
  if (record.surface === "desktop") {
    assertCondition(record.host.deviceKind === "desktop" && record.host.platform !== "android",
      "Portable desktop evidence has an invalid host");
    assertCondition(record.inputTrace === null,
      "Portable desktop evidence cannot contain an Android input trace");
  } else {
    validatePortableAndroidHost(record.host);
  }
  assertExactKeys(record.scenario,
    ["id", "source", "contractSha256", "requiredCapabilities", "result"],
    ["id", "source", "contractSha256", "requiredCapabilities", "result"],
    "Portable product evidence scenario");
  assertNonEmptyString(record.scenario.id, "Portable product evidence scenario id");
  assertCondition(record.scenario.source === "plugin-repository",
    "Portable product evidence scenario source is invalid");
  assertCondition(record.scenario.contractSha256 === record.candidate.scenarioContractSha256,
    "Portable product evidence scenario digest differs from its candidate");
  assertCondition(Array.isArray(record.scenario.requiredCapabilities) &&
    new Set(record.scenario.requiredCapabilities).size ===
      record.scenario.requiredCapabilities.length &&
    record.scenario.requiredCapabilities.every((capability, index) =>
      (capability === "touch.drag" || capability === "touch.longPress") &&
      (index === 0 || record.scenario.requiredCapabilities[index - 1]
        .localeCompare(capability, "en") < 0)),
  "Portable product evidence scenario capabilities are invalid");
  if (record.surface === "desktop") {
    assertCondition(record.scenario.requiredCapabilities.length === 0,
      "Portable desktop evidence cannot require Android touch capabilities");
  } else {
    validatePortableInputTraceSummary(record.inputTrace, record);
  }
  assertNonEmptyString(record.scenario.result, "Portable product evidence scenario result");
}

function validatePortableAndroidHost(host) {
  const keys = [
    "schemaVersion", "profileId", "platform", "deviceKind", "deviceName", "avdName",
    "osVersion", "apiLevel", "resolution", "orientation", "obsidianVersion", "sessionKind",
    "packageId", "inputMethods", "inputDriver",
  ];
  assertExactKeys(host, keys, keys, "Portable Android emulator host");
  assertCondition(host.schemaVersion === 2 && host.platform === "android" &&
    host.deviceKind === "emulator" && host.sessionKind === "external" &&
    host.packageId === "md.obsidian" && Number.isSafeInteger(host.apiLevel) && host.apiLevel > 0 &&
    host.resolution === "1080x2340" && host.orientation === "PORTRAIT" &&
    JSON.stringify(host.inputMethods) === JSON.stringify(["android-emulator-grpc-v1"]),
  "Portable Android emulator evidence has an invalid host");
  assertNonEmptyString(host.avdName, "Portable Android emulator AVD name");
  const driverKeys = [
    "id", "version", "endpoint", "capabilities", "rpcAllowlist", "emulator", "display",
  ];
  assertExactKeys(host.inputDriver, driverKeys, driverKeys,
    "Portable Android emulator input driver");
  assertCondition(host.inputDriver.id === "android-emulator-grpc-v1" &&
    host.inputDriver.version === "1.0.0" &&
    JSON.stringify(host.inputDriver.endpoint) ===
      JSON.stringify({ host: "127.0.0.1", port: "ephemeral" }) &&
    JSON.stringify(host.inputDriver.capabilities) ===
      JSON.stringify(["touch.longPress", "touch.drag"]) &&
    JSON.stringify(host.inputDriver.rpcAllowlist) === JSON.stringify([
      "/android.emulation.control.EmulatorController/getStatus",
      "/android.emulation.control.EmulatorController/getScreenshot",
      "/android.emulation.control.EmulatorController/sendTouch",
    ]) && JSON.stringify(host.inputDriver.emulator) === JSON.stringify({
      version: "36.6.11.0",
      buildId: "15507667",
      protoSha256: "5a18f729a3df31c3ede3a290af12acce2eca258133555f73126157749764a9c2",
    }) && JSON.stringify(host.inputDriver.display) === JSON.stringify({
      id: 0, width: 1080, height: 2340, orientation: "PORTRAIT",
    }),
  "Portable Android emulator input driver differs from the frozen contract");
}

function validatePortableInputTraceSummary(trace, evidence) {
  const keys = [
    "schemaVersion", "kind", "path", "sha256", "traceHash", "driver", "identity",
    "device", "status", "createdAt", "sealedAt", "actionCount", "actions", "rpcCalls",
    "residualTouches",
  ];
  assertExactKeys(trace, keys, keys, "Portable Android input trace summary");
  assertCondition(trace.schemaVersion === 1 &&
    trace.kind === "obsidian-plugin-workspace/android-input-trace-summary-v1",
  "Portable Android input trace summary schema/kind is unsupported");
  assertCondition(typeof trace.path === "string" && trace.path.startsWith("input-traces/") &&
    !trace.path.includes("\\") && !trace.path.split("/").some((segment) =>
      segment === "" || segment === "." || segment === ".."),
  "Portable Android input trace path is unsafe");
  assertSha256(trace.sha256, "Portable Android input trace file digest");
  assertSha256(trace.traceHash, "Portable Android input trace hash");
  assertExactKeys(trace.driver, ["id", "version", "rpcAllowlist"],
    ["id", "version", "rpcAllowlist"], "Portable Android input trace driver");
  assertCondition(trace.driver.id === "android-emulator-grpc-v1" &&
    trace.driver.version === "1.0.0" &&
    JSON.stringify(trace.driver.rpcAllowlist) ===
      JSON.stringify(evidence.host.inputDriver.rpcAllowlist),
  "Portable Android input trace driver differs from its host profile");
  const identityKeys = [
    "pluginId", "runId", "candidateIdentityHash", "inputManifestHash", "markerHash",
    "markerGeneration", "hostProfileId",
  ];
  assertExactKeys(trace.identity, identityKeys, identityKeys,
    "Portable Android input trace identity");
  assertCondition(trace.identity.pluginId === evidence.candidate.pluginId &&
    releaseRunIdPattern.test(trace.identity.runId) &&
    trace.identity.candidateIdentityHash === evidence.candidate.acceptanceCandidateIdentityHash &&
    trace.identity.hostProfileId === evidence.host.profileId &&
    Number.isSafeInteger(trace.identity.markerGeneration) && trace.identity.markerGeneration >= 0,
  "Portable Android input trace identity differs from its candidate or host");
  assertSha256(trace.identity.inputManifestHash,
    "Portable Android input trace input manifest hash");
  assertSha256(trace.identity.markerHash, "Portable Android input trace marker hash");
  const deviceKeys = [
    "avdName", "serial", "apiLevel", "emulatorVersion", "emulatorBuildId", "protoSha256",
    "display",
  ];
  assertExactKeys(trace.device, deviceKeys, deviceKeys, "Portable Android input trace device");
  assertCondition(trace.device.avdName === evidence.host.avdName &&
    /^emulator-\d+$/u.test(trace.device.serial) && trace.device.apiLevel === evidence.host.apiLevel &&
    trace.device.emulatorVersion === evidence.host.inputDriver.emulator.version &&
    trace.device.emulatorBuildId === evidence.host.inputDriver.emulator.buildId &&
    trace.device.protoSha256 === evidence.host.inputDriver.emulator.protoSha256 &&
    JSON.stringify(trace.device.display) === JSON.stringify(evidence.host.inputDriver.display),
  "Portable Android input trace device differs from its host profile");
  assertCanonicalTimestamp(trace.createdAt, "Portable Android input trace createdAt");
  assertCanonicalTimestamp(trace.sealedAt, "Portable Android input trace sealedAt");
  assertCondition(Date.parse(trace.sealedAt) >= Date.parse(trace.createdAt) &&
    Date.parse(evidence.observedAt) >= Date.parse(trace.sealedAt) && trace.status === "completed",
  "Portable passed Android input trace has invalid timing or status");
  assertCondition(Number.isSafeInteger(trace.actionCount) && trace.actionCount > 0,
    "Portable passed Android input trace must contain actions");
  assertExactKeys(trace.actions, ["tap", "longPress", "drag", "failed"],
    ["tap", "longPress", "drag", "failed"], "Portable Android input trace actions");
  assertCondition(Object.values(trace.actions).every((count) =>
    Number.isSafeInteger(count) && count >= 0) &&
    trace.actions.tap + trace.actions.longPress + trace.actions.drag === trace.actionCount &&
    trace.actions.failed === 0 && trace.residualTouches === 0,
  "Portable passed Android input trace action counts are invalid");
  for (const capability of evidence.scenario.requiredCapabilities) {
    const action = capability === "touch.drag" ? "drag" : "longPress";
    assertCondition(trace.actions[action] > 0,
      `Portable Android input trace does not exercise ${capability}`);
  }
  assertExactKeys(trace.rpcCalls, ["getStatus", "getScreenshot", "sendTouch"],
    ["getStatus", "getScreenshot", "sendTouch"], "Portable Android input trace RPC calls");
  assertCondition(Object.values(trace.rpcCalls).every((count) =>
    Number.isSafeInteger(count) && count >= 0) &&
    trace.rpcCalls.getStatus === trace.rpcCalls.getScreenshot &&
    trace.rpcCalls.getStatus >= trace.actionCount * 3 &&
    trace.rpcCalls.sendTouch >= trace.actionCount * 2,
  "Portable Android input trace RPC counts are invalid");
}

function validatePortableEquivalence(record, evidenceByDigest) {
  assertExactKeys(record,
    ["schemaVersion", "kind", "recordedAt", "surface", "hostProfileId",
      "sourceEvidenceSha256", "sourceCandidate", "targetCandidate", "identical", "reason"],
    ["schemaVersion", "kind", "recordedAt", "surface", "hostProfileId",
      "sourceEvidenceSha256", "sourceCandidate", "targetCandidate", "identical", "reason"],
    "Portable runtime equivalence");
  assertCondition(record.schemaVersion === 2 &&
    record.kind === "obsidian-plugin-workspace/runtime-equivalence-v2",
  "Portable runtime-equivalence schema/kind is unsupported");
  assertCanonicalTimestamp(record.recordedAt, "Portable runtime-equivalence recordedAt");
  assertCondition(["desktop", "android-emulator"].includes(record.surface),
    "Portable runtime-equivalence surface is invalid");
  assertNonEmptyString(record.hostProfileId, "Portable runtime-equivalence host profile");
  assertSha256(record.sourceEvidenceSha256,
    "Portable runtime-equivalence source evidence digest");
  assertPortableCandidate(record.sourceCandidate, "Portable runtime-equivalence source candidate");
  assertPortableCandidate(record.targetCandidate, "Portable runtime-equivalence target candidate");
  assertCondition(record.sourceCandidate.pluginId === record.targetCandidate.pluginId,
    "Portable runtime equivalence cannot cross plugin identities");
  assertExactKeys(record.identical, ["productPayloadSha256", "scenarioContractSha256"],
    ["productPayloadSha256", "scenarioContractSha256"],
    "Portable runtime-equivalence identical contract");
  assertCondition(record.identical.productPayloadSha256 ===
      record.sourceCandidate.productPayloadSha256 &&
    record.identical.productPayloadSha256 === record.targetCandidate.productPayloadSha256,
  "Portable runtime equivalence requires byte-identical product payloads");
  assertCondition(record.identical.scenarioContractSha256 ===
      record.sourceCandidate.scenarioContractSha256 &&
    record.identical.scenarioContractSha256 === record.targetCandidate.scenarioContractSha256,
  "Portable runtime equivalence requires identical scenario contracts");
  assertNonEmptyString(record.reason, "Portable runtime-equivalence reason");
  const evidence = evidenceByDigest.get(record.sourceEvidenceSha256);
  assertCondition(evidence !== undefined,
    "Portable runtime equivalence lacks its source evidence");
  assertCondition(samePortableCandidate(evidence.candidate, record.sourceCandidate) &&
    evidence.surface === record.surface && evidence.host.profileId === record.hostProfileId,
  "Portable runtime equivalence differs from its source evidence");
}

function validatePortableRecordWrappers(entries, validator, label) {
  assertCondition(Array.isArray(entries), `${label} must be an array`);
  const digests = [];
  const records = new Map();
  for (const entry of entries) {
    assertExactKeys(entry, ["sha256", "record"], ["sha256", "record"], `${label} wrapper`);
    assertSha256(entry.sha256, `${label} digest`);
    validator(entry.record);
    assertCondition(entry.sha256 === sha256(canonicalJson(entry.record)),
      `${label} wrapper digest mismatch`);
    assertCondition(!records.has(entry.sha256), `${label} digest is duplicated`);
    records.set(entry.sha256, entry.record);
    digests.push(entry.sha256);
  }
  const sorted = [...digests].sort((left, right) => left.localeCompare(right, "en"));
  assertCondition(JSON.stringify(digests) === JSON.stringify(sorted), `${label} must be sorted`);
  return records;
}

export function validatePortableAcceptanceClosure(value, { runId, verifiedBundle }) {
  assertExactKeys(value,
    ["schemaVersion", "kind", "runId", "closedAt", "status", "gatePassed",
      "authorizesPublication", "candidate", "policy", "surfaces", "evidence", "equivalences"],
    ["schemaVersion", "kind", "runId", "closedAt", "status", "gatePassed",
      "authorizesPublication", "candidate", "policy", "surfaces", "evidence", "equivalences"],
    "Acceptance closure");
  assertCondition(value.schemaVersion === 3 &&
    value.kind === "obsidian-plugin-workspace/release-acceptance-closure-v3",
  "Acceptance closure schema/kind is unsupported");
  assertCondition(value.runId === runId && value.status === "passed" &&
    value.gatePassed === true && value.authorizesPublication === false,
  "Acceptance closure does not close the exact run as passed");
  assertCanonicalTimestamp(value.closedAt, "Acceptance closure closedAt");
  assertPortableCandidate(value.candidate, "Acceptance closure candidate");
  const bundle = verifiedBundle.candidateBundle;
  const expectedCandidate = candidateFromVerifiedBundle(verifiedBundle);
  assertCondition(samePortableCandidate(value.candidate, expectedCandidate),
  "Acceptance closure candidate differs from the exact Candidate Bundle");
  assertExactKeys(value.policy, ["desktop", "androidEmulator", "androidPhysical", "ios"],
    ["desktop", "androidEmulator", "androidPhysical", "ios"], "Acceptance closure policy");
  assertCondition(value.policy.desktop === "required" &&
    value.policy.androidEmulator === "required-if-mobile" &&
    value.policy.androidPhysical === "out-of-scope" && value.policy.ios === "out-of-scope",
  "Acceptance closure policy is unsupported");
  assertExactKeys(value.surfaces, ["desktop", "androidEmulator", "androidPhysical", "ios"],
    ["desktop", "androidEmulator", "androidPhysical", "ios"], "Acceptance closure surfaces");
  assertCondition(Array.isArray(value.evidence) && value.evidence.length > 0,
    "Acceptance closure must contain evidence records");
  assertCondition(Array.isArray(value.equivalences),
    "Acceptance closure equivalences must be an array");
  const evidenceByDigest = validatePortableRecordWrappers(value.evidence,
    validatePortableProductEvidence, "Portable product evidence");
  const equivalenceByDigest = validatePortableRecordWrappers(value.equivalences,
    (record) => validatePortableEquivalence(record, evidenceByDigest),
    "Portable runtime equivalence");
  const claims = [];
  for (const [evidenceSha256, evidence] of evidenceByDigest) {
    let equivalenceSha256 = null;
    if (!samePortableCandidate(evidence.candidate, expectedCandidate)) {
      const matches = [...equivalenceByDigest].filter(([, equivalence]) =>
        equivalence.sourceEvidenceSha256 === evidenceSha256 &&
        samePortableCandidate(equivalence.targetCandidate, expectedCandidate));
      assertCondition(matches.length === 1,
        "Non-target portable evidence requires exactly one target runtime equivalence");
      equivalenceSha256 = matches[0][0];
    }
    claims.push({ evidenceSha256, evidence, equivalenceSha256 });
  }
  for (const digest of equivalenceByDigest.keys()) {
    assertCondition(claims.some((claim) => claim.equivalenceSha256 === digest),
      "Portable runtime equivalence is unused");
  }
  const requiredSurfaces = bundle.plugin.isDesktopOnly ? ["desktop"] :
    ["desktop", "android-emulator"];
  for (const surface of requiredSurfaces) {
    const matches = claims.filter((claim) => claim.evidence.surface === surface);
    assertCondition(matches.length === 1,
      `Acceptance closure requires exactly one passed ${surface} claim`);
    const verdictName = surface === "desktop" ? "desktop" : "androidEmulator";
    const verdict = value.surfaces[verdictName];
    assertExactKeys(verdict, ["required", "status", "evidenceSha256", "equivalenceSha256"],
      ["required", "status", "evidenceSha256", "equivalenceSha256"],
      `Acceptance closure ${verdictName} verdict`);
    assertCondition(verdict.required === true && verdict.status === "passed" &&
      verdict.evidenceSha256 === matches[0].evidenceSha256 &&
      verdict.equivalenceSha256 === matches[0].equivalenceSha256,
    `Acceptance closure ${verdictName} verdict differs from its evidence`);
  }
  assertCondition(claims.every((claim) => requiredSurfaces.includes(claim.evidence.surface)),
    "Acceptance closure contains evidence outside required surfaces");
  if (bundle.plugin.isDesktopOnly) {
    assertOutOfScopeVerdict(value.surfaces.androidEmulator, "androidEmulator");
  }
  assertOutOfScopeVerdict(value.surfaces.androidPhysical, "androidPhysical");
  assertOutOfScopeVerdict(value.surfaces.ios, "ios");
  return value;
}

function assertOutOfScopeVerdict(verdict, label) {
  assertExactKeys(verdict, ["required", "status", "reason"],
    ["required", "status", "reason"], `Acceptance closure ${label} verdict`);
  assertCondition(verdict.required === false && verdict.status === "out-of-scope",
    `Acceptance closure ${label} verdict must be out of scope`);
  assertNonEmptyString(verdict.reason, `Acceptance closure ${label} reason`);
}

function validatePortableAuthorization(value, {
  runId,
  bundleSha256,
  acceptanceClosureSha256,
  expectedAuthorization,
}) {
  assertExactKeys(value,
    ["schemaVersion", "kind", "runId", "authorizedAt", "singleCandidate",
      "authorizesPublication", "bindings", "confirmation"],
    ["schemaVersion", "kind", "runId", "authorizedAt", "singleCandidate",
      "authorizesPublication", "bindings", "confirmation"],
    "Publication authorization");
  assertCondition(value.schemaVersion === 2 &&
    value.kind === "obsidian-plugin-workspace/release-authorization-v2",
  "Publication authorization schema/kind is unsupported");
  assertCondition(value.runId === runId && value.singleCandidate === true &&
    value.authorizesPublication === true,
  "Publication authorization does not authorize the exact run");
  assertCanonicalTimestamp(value.authorizedAt, "Publication authorization authorizedAt");
  assertExactKeys(value.bindings,
    ["planSha256", "candidateBundleSha256", "acceptanceClosureSha256"],
    ["planSha256", "candidateBundleSha256", "acceptanceClosureSha256"],
    "Publication authorization bindings");
  assertSha256(value.bindings.planSha256, "Publication authorization plan digest");
  assertCondition(value.bindings.candidateBundleSha256 === bundleSha256 &&
    value.bindings.acceptanceClosureSha256 === acceptanceClosureSha256,
  "Publication authorization bindings differ from the exact release records");
  assertCondition(value.confirmation === expectedAuthorization,
    "Publication authorization confirmation differs from the exact phrase");
}

export async function materializePublicationEvidence({
  verifiedBundle,
  outputDirectory,
  runId,
  bundleSha256,
  acceptanceClosureSha256,
  acceptanceClosureBase64,
  authorizationSha256,
  authorizationBase64,
  expectedAuthorization,
}) {
  assertCondition(releaseRunIdPattern.test(assertNonEmptyString(runId, "Release run id")),
    "Release run id must be a UUID");
  assertSha256(bundleSha256, "Expected Candidate Bundle digest");
  assertCondition(bundleSha256 === verifiedBundle.bundleSha256,
    "Expected Candidate Bundle digest mismatch");
  assertSha256(acceptanceClosureSha256, "Expected acceptance closure digest");
  assertSha256(authorizationSha256, "Expected publication authorization digest");
  const closureBytes = decodeCanonicalBase64(acceptanceClosureBase64, 60_000, 45_000,
    "Acceptance closure");
  const authorizationBytes = decodeCanonicalBase64(authorizationBase64, 16_000, 12_000,
    "Publication authorization");
  assertCondition(sha256(closureBytes) === acceptanceClosureSha256,
    "Acceptance closure digest mismatch");
  assertCondition(sha256(authorizationBytes) === authorizationSha256,
    "Publication authorization digest mismatch");
  const closure = parseCanonicalJson(closureBytes, "Acceptance closure");
  const authorization = parseCanonicalJson(authorizationBytes, "Publication authorization");
  validatePortableAcceptanceClosure(closure, { runId, verifiedBundle });
  validatePortableAuthorization(authorization, {
    runId,
    bundleSha256,
    acceptanceClosureSha256,
    expectedAuthorization,
  });
  const output = await createExactDirectory(outputDirectory, new Map([
    ["acceptance-closure.json", closureBytes],
    ["authorization.json", authorizationBytes],
  ]));
  return Object.freeze({ status: "materialized", outputDirectory: output });
}

export async function stagePublicAssets({ verifiedBundle, outputDirectory }) {
  const files = new Map(verifiedBundle.publicAssets.map((record) => [
    record.name,
    verifiedBundle.publicFiles.get(record.name),
  ]));
  const output = await createExactDirectory(outputDirectory, files);
  return Object.freeze({ status: "staged", outputDirectory: output,
    assetCount: verifiedBundle.publicAssets.length });
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
  if (command === "workflow-write" || command === "workflow-check") {
    parseCliOptions(arguments_, []);
    return command === "workflow-write"
      ? writeReleaseWorkflow({ projectRoot, config })
      : checkReleaseWorkflow({ projectRoot, config });
  }
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
  if (command === "bundle") {
    const options = parseCliOptions(arguments_, ["--version", "--output-dir"],
      ["--output-dir"]);
    return buildCandidateBundle({
      projectRoot,
      config,
      outputDirectory: options.get("--output-dir"),
      version: options.get("--version"),
      commandRunner,
    });
  }
  if (command === "verify-source" || command === "verify-transport") {
    const options = parseCliOptions(arguments_, ["--bundle-dir"], ["--bundle-dir"]);
    const verify = command === "verify-source"
      ? verifySourceCandidateBundle
      : verifyTransportCandidateBundle;
    return verify({
      projectRoot,
      config,
      bundleDirectory: options.get("--bundle-dir"),
      commandRunner,
    });
  }
  if (command === "materialize-evidence") {
    const options = parseCliOptions(arguments_, [
      "--bundle-dir",
      "--output-dir",
      "--run-id",
      "--bundle-digest",
      "--acceptance-closure-digest",
      "--authorization-digest",
    ], [
      "--bundle-dir",
      "--output-dir",
      "--run-id",
      "--bundle-digest",
      "--acceptance-closure-digest",
      "--authorization-digest",
    ]);
    const verifiedBundle = await verifyTransportCandidateBundle({
      projectRoot,
      config,
      bundleDirectory: options.get("--bundle-dir"),
      commandRunner,
    });
    return materializePublicationEvidence({
      verifiedBundle,
      outputDirectory: options.get("--output-dir"),
      runId: options.get("--run-id"),
      bundleSha256: options.get("--bundle-digest"),
      acceptanceClosureSha256: options.get("--acceptance-closure-digest"),
      acceptanceClosureBase64: env.ACCEPTANCE_CLOSURE_B64,
      authorizationSha256: options.get("--authorization-digest"),
      authorizationBase64: env.AUTHORIZATION_B64,
      expectedAuthorization: env.RELEASE_PUBLISH_AUTHORIZATION,
    });
  }
  if (command === "stage-public-assets") {
    const options = parseCliOptions(arguments_, ["--bundle-dir", "--output-dir"],
      ["--bundle-dir", "--output-dir"]);
    const verifiedBundle = await verifyTransportCandidateBundle({
      projectRoot,
      config,
      bundleDirectory: options.get("--bundle-dir"),
      commandRunner,
    });
    return stagePublicAssets({
      verifiedBundle,
      outputDirectory: options.get("--output-dir"),
    });
  }
  if (command === "publication-boundary") {
    const options = parseCliOptions(arguments_, [
      "--bundle-dir",
      "--bundle-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ], [
      "--bundle-dir",
      "--bundle-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ]);
    const verifiedBundle = await verifyTransportCandidateBundle({
      projectRoot,
      config,
      bundleDirectory: options.get("--bundle-dir"),
      commandRunner,
    });
    return validatePublicationBoundary({
      projectRoot,
      config,
      verifiedBundle,
      bundleSha256: options.get("--bundle-digest"),
      acceptanceClosurePath: options.get("--acceptance-closure"),
      acceptanceClosureSha256: options.get("--acceptance-closure-digest"),
      authorization: env.RELEASE_PUBLISH_AUTHORIZATION,
      commandRunner,
    });
  }
  if (command === "publication-preflight") {
    const options = parseCliOptions(arguments_, [
      "--bundle-dir",
      "--bundle-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ], [
      "--bundle-dir",
      "--bundle-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ]);
    const verifiedBundle = await verifyTransportCandidateBundle({
      projectRoot,
      config,
      bundleDirectory: options.get("--bundle-dir"),
      commandRunner,
    });
    return preflightGitHubPublication({
      projectRoot,
      config,
      verifiedBundle,
      bundleSha256: options.get("--bundle-digest"),
      acceptanceClosurePath: options.get("--acceptance-closure"),
      acceptanceClosureSha256: options.get("--acceptance-closure-digest"),
      authorization: env.RELEASE_PUBLISH_AUTHORIZATION,
      commandRunner,
      env,
    });
  }
  if (command === "publish-github") {
    const options = parseCliOptions(arguments_, [
      "--bundle-dir",
      "--bundle-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
      "--notes-file",
    ], [
      "--bundle-dir",
      "--bundle-digest",
      "--acceptance-closure",
      "--acceptance-closure-digest",
    ]);
    const verifiedBundle = await verifyTransportCandidateBundle({
      projectRoot,
      config,
      bundleDirectory: options.get("--bundle-dir"),
      commandRunner,
    });
    const boundary = await validatePublicationBoundary({
      projectRoot,
      config,
      verifiedBundle,
      bundleSha256: options.get("--bundle-digest"),
      acceptanceClosurePath: options.get("--acceptance-closure"),
      acceptanceClosureSha256: options.get("--acceptance-closure-digest"),
      authorization: env.RELEASE_PUBLISH_AUTHORIZATION,
      commandRunner,
    });
    return publishGitHub({
      projectRoot: path.resolve(projectRoot),
      config,
      verifiedBundle,
      boundary,
      commandRunner,
      env,
      notesFile: options.get("--notes-file"),
    });
  }
  if (command === "post-verify") {
    const options = parseCliOptions(arguments_, ["--bundle-dir"], ["--bundle-dir"]);
    const verifiedBundle = await verifyTransportCandidateBundle({
      projectRoot,
      config,
      bundleDirectory: options.get("--bundle-dir"),
      commandRunner,
    });
    return verifyPublishedRelease({
      projectRoot,
      config,
      verifiedBundle,
      commandRunner,
      env,
    });
  }
  fail(`Unknown release command: ${String(command)}`, "RELEASE_CORE_CLI");
}

function printableReleaseResult(result) {
  const summary = {};
  for (const name of [
    "command",
    "status",
    "pluginId",
    "version",
    "commit",
    "tree",
    "bundleSha256",
    "bundleDirectory",
    "productPayloadSha256",
    "scenarioContractSha256",
    "repository",
    "tag",
    "workflow",
    "sha256",
    "assetCount",
    "outputDirectory",
  ]) {
    if (typeof result?.[name] === "string" || typeof result?.[name] === "number") {
      summary[name] = result[name];
    }
  }
  return summary;
}

export function createReleaseAdapter({ adapterUrl, config: configInput }) {
  const config = validateReleaseConfig(configInput);
  const adapterPath = fileURLToPath(assertNonEmptyString(adapterUrl, "adapterUrl"));
  const scriptDirectory = path.dirname(adapterPath);
  const projectRoot = path.resolve(scriptDirectory, "..");
  const lockPath = path.join(scriptDirectory, "vendor", "obsidian-release-core.lock.json");

  async function verifyReleaseCorePin() {
    const actual = await readRegularFile(lockPath, "Vendored release-core lock");
    const expected = await serializeReleaseCoreVendorLock();
    assertCondition(actual.equals(expected),
      "Vendored release-core differs from its exact lock", "RELEASE_CORE_VENDOR_LOCK");
  }

  async function run(argv = process.argv.slice(2), options = {}) {
    await verifyReleaseCorePin();
    return runReleaseCli({
      projectRoot,
      config,
      argv,
      env: options.env ?? process.env,
      commandRunner: options.commandRunner ?? defaultCommandRunner,
    });
  }

  async function runIfMain(options = {}) {
    const entryPoint = process.argv[1]
      ? pathToFileURL(path.resolve(process.argv[1])).href
      : undefined;
    if (adapterUrl !== entryPoint) return null;
    const result = await run(options.argv ?? process.argv.slice(2), options);
    process.stdout.write(`${JSON.stringify(printableReleaseResult(result))}\n`);
    return result;
  }

  return Object.freeze({
    projectRoot,
    releaseConfig: config,
    verifyReleaseCorePin,
    run,
    runIfMain,
  });
}
