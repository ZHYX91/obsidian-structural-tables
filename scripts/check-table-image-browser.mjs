import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";

const browser = process.argv[2];
assert.ok(browser, "Usage: node scripts/check-table-image-browser.mjs <Chromium executable>");
const root = process.cwd();
const outputRoot = path.resolve(root, "dist");
await mkdir(outputRoot, { recursive: true });
const temporary = await mkdtemp(path.join(outputRoot, "image-browser-"));
const bundle = await build({ entryPoints: ["tests/browser/table-image-harness.ts"], bundle: true,
  alias: { obsidian: path.resolve("tests/mocks/obsidian.ts") }, write: false, format: "iife", platform: "browser" });
const [source, styles, attachment] = await Promise.all([
  readFile("acceptance/fixtures/Table image export.md", "utf8"), readFile("styles.css", "utf8"), readFile("acceptance/fixtures/table-image-local.svg"),
]);
const html = `<html><head><style>body{--background-primary:#fff;--text-normal:#222;--font-text:sans-serif;--font-text-size:16px}table{border-collapse:collapse}td,th{border:1px solid #777;padding:8px}svg{display:inline-block}${styles}</style></head><body><svg width="0" height="0"><defs><path id="math-glyph" d="M0 20L15 0L30 20Z" fill="#00a000"/></defs></svg><script id="input" type="application/json">${JSON.stringify(source).replaceAll("<", "\\u003c")}</script><pre id="result">pending</pre><script src="/bundle.js"></script></body></html>`;
const server = createServer((request, response) => {
  if (request.url === "/attachment.svg") { response.setHeader("Content-Type", "image/svg+xml"); response.end(attachment); }
  else if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
  else { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let child;
let socket;
try {
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  child = spawn(browser, ["--headless=new", "--no-sandbox", "--disable-gpu", "--remote-debugging-port=0",
    `--user-data-dir=${path.join(temporary, "profile")}`, "--window-size=800,600", `http://127.0.0.1:${address.port}/`],
  { stdio: "ignore", windowsHide: true });
  let port;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { port = (await readFile(path.join(temporary, "profile", "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.ok(port, "Chromium did not open its isolated debugging endpoint");
  const tabs = await (await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const tab = tabs.find((value) => value.type === "page");
  assert.ok(tab, "Chromium page missing");
  socket = new globalThis.WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let id = 0;
  const requests = new Map();
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(String(event.data));
    const pending = requests.get(response.id);
    if (pending) { requests.delete(response.id); response.error ? pending.reject(response.error) : pending.resolve(response.result); }
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1; requests.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluation = await command("Runtime.evaluate", { awaitPromise: true, returnByValue: true,
    expression: `new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{const value=document.getElementById('result')?.textContent;if(value&&value!=='pending'){clearInterval(timer);resolve(value);}else if(++attempts>500){clearInterval(timer);reject(new Error('PNG smoke timed out'));}},50);})` });
  assert.ok(!evaluation.exceptionDetails, JSON.stringify(evaluation));
  const result = JSON.parse(evaluation.result.value);
  await writeFile(path.join(temporary, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  assert.equal(result.passed, true, JSON.stringify(result));
  process.stdout.write(`Browser pipeline smoke (not Obsidian acceptance): ${JSON.stringify(result)}\n`);
  await command("Browser.close");
  if (child.exitCode === null) await once(child, "exit");
} finally {
  socket?.close();
  if (child && child.exitCode === null) { child.kill(); await once(child, "exit"); }
  await new Promise((resolve) => server.close(resolve));
  assert.equal(path.dirname(temporary), outputRoot);
  await rm(temporary, { recursive: true, maxRetries: 10, retryDelay: 200 });
}
