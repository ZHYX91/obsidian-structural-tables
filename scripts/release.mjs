import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import config from "../release.config.mjs";
import {
  runReleaseCli,
  serializeReleaseCoreVendorLock,
} from "./vendor/obsidian-release-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(scriptDirectory, "..");
export { config as releaseConfig };

export async function verifyReleaseCorePin() {
  const actual = await readFile(path.join(
    scriptDirectory,
    "vendor",
    "obsidian-release-core.lock.json",
  ));
  const expected = await serializeReleaseCoreVendorLock();
  if (!actual.equals(expected)) {
    throw new Error("Vendored release-core differs from its exact lock");
  }
}

export async function run(argv = process.argv.slice(2), options = {}) {
  await verifyReleaseCorePin();
  return runReleaseCli({
    projectRoot,
    config,
    argv,
    env: options.env ?? process.env,
    commandRunner: options.commandRunner,
  });
}

function printableResult(result) {
  const summary = {};
  for (const name of [
    "command",
    "status",
    "pluginId",
    "version",
    "commit",
    "tree",
    "candidateSha256",
    "handoffDirectory",
    "repository",
    "tag",
  ]) {
    if (typeof result[name] === "string") summary[name] = result[name];
  }
  return summary;
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (import.meta.url === entryPoint) {
  const result = await run();
  process.stdout.write(`${JSON.stringify(printableResult(result))}\n`);
}
