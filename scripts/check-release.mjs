import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), "utf8"));
const [packageJson, lock, manifest, versions] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("manifest.json"),
  readJson("versions.json"),
]);
const version = packageJson.version;
if (manifest.version !== version || lock.version !== version || lock.packages?.[""]?.version !== version) {
  throw new Error("package.json, package-lock.json, and manifest.json versions must match.");
}
if (versions[version] !== manifest.minAppVersion) {
  throw new Error("versions.json must map the current version to manifest.minAppVersion.");
}
if (manifest.id !== "structural-tables" || manifest.name !== "Structural Tables") {
  throw new Error("Manifest identity changed unexpectedly.");
}
if (manifest.isDesktopOnly !== false) {
  throw new Error("Structural Tables must remain available on supported Android hosts.");
}
const expectedFiles = ["main.js", "manifest.json", "styles.css"];
const actualFiles = (await readdir(path.join(root, "dist"))).sort();
if (JSON.stringify(actualFiles) !== JSON.stringify([...expectedFiles].sort())) {
  throw new Error(`dist must contain exactly ${expectedFiles.join(", ")}; received ${actualFiles.join(", ")}`);
}
for (const name of expectedFiles) {
  const info = await stat(path.join(root, "dist", name));
  if (!info.isFile() || info.size === 0) throw new Error(`dist/${name} is missing or empty.`);
}
for (const staticFile of ["manifest.json", "styles.css"]) {
  const [source, built] = await Promise.all([
    readFile(path.join(root, staticFile)),
    readFile(path.join(root, "dist", staticFile)),
  ]);
  if (!source.equals(built)) throw new Error(`dist/${staticFile} is stale.`);
}
const bundle = await readFile(path.join(root, "dist", "main.js"), "utf8");
if (Buffer.byteLength(bundle) > 1_500_000) throw new Error("Production bundle exceeds the 1.5 MB release budget.");
if (bundle.includes("sourceMappingURL=") || bundle.includes("D:\\Projects\\")) {
  throw new Error("Production bundle contains development-only source metadata.");
}
for (const external of ["obsidian", "@codemirror/state", "@codemirror/view"]) {
  if (!bundle.includes(`require("${external}")`)) throw new Error(`Expected runtime external was not preserved: ${external}`);
}
process.stdout.write(`Release contract passed for Structural Tables ${version}; bundle=${Buffer.byteLength(bundle)} bytes.\n`);
