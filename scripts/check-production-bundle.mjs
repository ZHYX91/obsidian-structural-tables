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
if (Buffer.byteLength(bundle) > 1_500_000) {
  throw new Error("Production bundle exceeds the 1.5 MB release budget.");
}
if (bundle.includes("sourceMappingURL=") || bundle.includes("D:\\Projects\\")) {
  throw new Error("Production bundle contains development-only source metadata.");
}
for (const external of ["obsidian", "@codemirror/state", "@codemirror/view"]) {
  if (!bundle.includes(`require("${external}")`)) {
    throw new Error(`Expected runtime external was not preserved: ${external}`);
  }
}

process.stdout.write(
  `Production bundle contract passed for Structural Tables; bundle=${Buffer.byteLength(bundle)} bytes.\n`,
);
