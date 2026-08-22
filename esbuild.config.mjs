import { watch } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import esbuild from "esbuild";

const production = process.argv.includes("production");
const projectRoot = process.cwd();
const outputDirectory = path.join(projectRoot, "dist");
const staticAssets = ["manifest.json", "styles.css"];

const syncStaticAssets = async () => {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(staticAssets.map((asset) => copyFile(
    path.join(projectRoot, asset),
    path.join(outputDirectory, asset),
  )));
};

const context = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/language",
    "@codemirror/state",
    "@codemirror/view",
  ],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  outfile: path.join(outputDirectory, "main.js"),
  sourcemap: production ? false : "inline",
  minify: production,
  logLevel: "info",
  treeShaking: true,
});

if (production) {
  await rm(outputDirectory, { recursive: true, force: true });
  await context.rebuild();
  await syncStaticAssets();
  await context.dispose();
} else {
  await syncStaticAssets();
  await context.watch();
  const watcher = watch(projectRoot, (_event, filename) => {
    if (filename != null && staticAssets.includes(filename.toString())) {
      void syncStaticAssets();
    }
  });
  const shutdown = async () => {
    watcher.close();
    await context.dispose();
  };
  process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
  process.stdout.write("Watching TypeScript and static assets for changes...\n");
}
