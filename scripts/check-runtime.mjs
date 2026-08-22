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
if (Object.keys(packageJson.dependencies ?? {}).length !== 0) {
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
    if (rule.pattern.test(source)) {
      throw new Error(`${rule.label} is not allowed in plugin runtime source: ${path.relative(root, file)}`);
    }
  }
}

process.stdout.write(`Runtime contract passed for Node ${nodeVersion}; ${sourceFiles.length} source files are offline-only.\n`);
