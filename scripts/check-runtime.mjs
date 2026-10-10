import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const nodeVersion = (await readFile(path.join(root, ".node-version"), "utf8")).trim();
const expectedNode = packageJson.engines?.node;

if (expectedNode !== nodeVersion) {
  throw new Error(`Node contract mismatch: package=${expectedNode} .node-version=${nodeVersion}`);
}
if (process.versions.node !== nodeVersion) {
  throw new Error(`Expected Node ${nodeVersion}, received ${process.versions.node}`);
}
// Browser-only dependencies are pinned and bundled; no host package loader or CDN.
const bundledDependencies = { "html-to-image": "1.11.13", yaml: "2.9.1" };
if (JSON.stringify(packageJson.dependencies ?? {}) !== JSON.stringify(bundledDependencies)) {
  throw new Error("Runtime dependencies must be reviewed and bundled intentionally.");
}

const sourceFiles = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collect(absolute);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      sourceFiles.push(absolute);
    }
  }
}
await collect(path.join(root, "src"));
sourceFiles.push(path.join(root, "main.ts"));

const forbidden = [
  { label: "Node runtime import", pattern: /(?:from\s+|require\()["'](?:node:|fs(?:\/|["'])|path["']|child_process["']|net["']|tls["'])/u },
  { label: "outbound fetch", pattern: /\bfetch\s*\(/u },
  { label: "XMLHttpRequest", pattern: /\bXMLHttpRequest\b/u },
  { label: "WebSocket", pattern: /\bWebSocket\b/u },
  { label: "telemetry SDK", pattern: /\b(?:Sentry|posthog|analytics)\b/iu },
];

for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  for (const rule of forbidden) {
    // The reviewed PNG renderer may embed active font/decoration resources.
    // It has no upload endpoint; all other product modules remain fetch-free.
    if (rule.label === "outbound fetch" && file === path.join(root, "src", "rendering", "table-image.ts")) continue;
    if (rule.pattern.test(source)) {
      throw new Error(`${rule.label} is not allowed in plugin runtime source: ${path.relative(root, file)}`);
    }
  }
}

process.stdout.write(`Runtime contract passed for Node ${nodeVersion}; ${sourceFiles.length} source files, with reviewed local PNG resource loading.\n`);
