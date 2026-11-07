import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  packageManager: string;
  scripts: Record<string, string>;
  engines: { node: string };
};
const npmVersion = packageJson.packageManager.slice("npm@".length);
const sharedFiles = ["runtime-contract.mjs", "prepare-lint-dependencies.mjs", "check-lint-dependencies.mjs"];
const temporaryRoots: string[] = [];

function fixture(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "maintenance-tools-"));
  temporaryRoots.push(directory);
  mkdirSync(path.join(directory, "scripts"));
  mkdirSync(path.join(directory, "src"));
  for (const file of [...sharedFiles, "shared-tools.lock.json", "check-shared-tools.mjs", "check-runtime.mjs"]) {
    copyFileSync(path.join(root, "scripts", file), path.join(directory, "scripts", file));
  }
  for (const file of ["package.json", ".node-version"]) copyFileSync(path.join(root, file), path.join(directory, file));
  writeFileSync(path.join(directory, "main.ts"), "export {};\n");
  return directory;
}

function run(directory: string, args: string[], npm = npmVersion) {
  return spawnSync(process.execPath, args, {
    cwd: directory, encoding: "utf8", timeout: 15_000,
    env: { ...process.env, npm_config_user_agent: npm === "" ? "" : `npm/${npm} node/v${process.versions.node}` },
  });
}

function changePackage(directory: string, change: Partial<typeof packageJson>): void {
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ ...packageJson, ...change }));
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("shared maintenance tool entry points", () => {
  it("accepts the checked-in source snapshot and exact runtime without installed dependencies", () => {
    const result = run(fixture(), ["scripts/check-runtime.mjs"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Shared maintenance tools match the local source lock (3 files)");
    expect(result.stdout).toContain(npmVersion);
  });

  it.each(["0.0.0", ""])("rejects an incorrect or unavailable npm version: %j", (version) => {
    const result = run(fixture(), ["scripts/check-runtime.mjs"], version);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(version === "" ? "through npm" : `npm ${npmVersion} is required`);
  });

  it.each(["wrong-node", "inconsistent-pins", "floating-node", "missing-npm-prefix"])("rejects %s through the runtime entry", (kind) => {
    const directory = fixture();
    if (kind === "missing-npm-prefix") changePackage(directory, { packageManager: npmVersion });
    else {
      const node = kind === "floating-node" ? "24" : "99.0.0";
      changePackage(directory, { engines: { node } });
      if (kind !== "inconsistent-pins") writeFileSync(path.join(directory, ".node-version"), `${node}\n`);
    }
    const result = run(directory, ["scripts/check-runtime.mjs"]);
    expect(result.status).not.toBe(0);
    const message = kind === "missing-npm-prefix" ? "packageManager must pin npm"
      : kind === "inconsistent-pins" ? "engines.node must match .node-version exactly"
        : kind === "floating-node" ? ".node-version must pin an exact Node.js version"
          : "Node.js 99.0.0 is required";
    expect(result.stderr).toContain(message);
  });

  it.each(sharedFiles)("rejects local drift before loading %s", (file) => {
    const directory = fixture();
    const target = path.join(directory, "scripts", file);
    writeFileSync(target, readFileSync(target, "utf8") + "\nprocess.exit(77);\n");
    const result = run(directory, ["scripts/check-runtime.mjs"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Shared maintenance tool drift: scripts/${file}`);
  });

  it("rejects a lock that omits one of the shared tools", () => {
    const directory = fixture();
    const target = path.join(directory, "scripts/shared-tools.lock.json");
    const lock = JSON.parse(readFileSync(target, "utf8")) as { files: Record<string, string> };
    delete lock.files["scripts/runtime-contract.mjs"];
    writeFileSync(target, JSON.stringify(lock));
    const result = run(directory, ["scripts/check-shared-tools.mjs"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("The lock must cover all three maintenance tools");
  });

  it.each(["check:runtime", "prelint", "postinstall", "prebuild", "prebuild:bundle", "prebuild:quick"]
    .filter((command) => packageJson.scripts[command] !== undefined))(
    "blocks drift through the real npm %s entry before executing the changed tool", (command) => {
      const directory = fixture();
      const target = path.join(directory, "scripts/prepare-lint-dependencies.mjs");
      writeFileSync(target, readFileSync(target, "utf8") + "\nprocess.exit(77);\n");
      const npmCli = process.env.npm_execpath;
      if (npmCli === undefined) throw new Error("Run the tooling entry-point tests through npm.");
      const result = run(directory, [npmCli, "run", command, "--silent"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Shared maintenance tool drift: scripts/prepare-lint-dependencies.mjs");
    },
  );
});
