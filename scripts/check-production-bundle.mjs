import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

for (const staticFile of ["manifest.json", "styles.css"]) {
  const [source, built] = await Promise.all([
    readFile(path.join(root, staticFile)),
    readFile(path.join(root, "dist", staticFile)),
  ]);
  if (!source.equals(built)) {
    throw new Error(`dist/${staticFile} is stale.`);
  }
}

const bundle = await readFile(path.join(root, "dist", "main.js"), "utf8");
const thirdPartyNotices = await readFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), "utf8");
for (const line of thirdPartyNotices.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean)) {
  if (!bundle.includes(line)) {
    throw new Error(`Production bundle is missing third-party notice text: ${line}`);
  }
}
if (Buffer.byteLength(bundle) > 1_500_000) {
  throw new Error("Production bundle exceeds the 1.5 MB release budget.");
}
if (bundle.includes("sourceMappingURL=") || bundle.includes("D:\\Projects\\")) {
  throw new Error("Production bundle contains development-only source metadata.");
}
if (/require\(["'](?:yaml|html-to-image)["']\)/u.test(bundle)) {
  throw new Error("Runtime dependencies must be bundled, not required from the host.");
}
for (const external of ["obsidian", "@codemirror/state", "@codemirror/view"]) {
  if (!bundle.includes(`require("${external}")`)) {
    throw new Error(`Expected runtime external was not preserved: ${external}`);
  }
}

process.stdout.write(
  `Production bundle contract passed for Structural Tables; bundle=${Buffer.byteLength(bundle)} bytes.\n`,
);
