import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";

const browser = process.argv[2] || process.env.CHROMIUM_PATH;
assert.ok(browser, "Usage: node scripts/check-table-transpose-browser.mjs <Chromium executable>");
const dir = await mkdtemp(path.join(os.tmpdir(), "structural-transpose-browser-"));
const bundle = await build({
  entryPoints: ["tests/browser/table-transpose-browser-harness.ts"],
  bundle: true,
  alias: { obsidian: path.resolve("tests/mocks/obsidian.ts") },
  format: "iife", platform: "browser", write: false,
});
const page = '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/bundle.js"></script></body></html>';
const server = createServer((request, response) => {
  if (request.url === "/bundle.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(bundle.outputFiles[0].text);
  } else {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(page);
  }
});
let child;
let socket;
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const url = "http://127.0.0.1:" + address.port + "/";
  child = spawn(browser, ["--headless=new", "--no-sandbox", "--disable-gpu",
    "--remote-debugging-port=0", "--user-data-dir=" + path.join(dir, "profile"),
    "--window-size=980,740", url], { stdio: "ignore", windowsHide: true });
  let port;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      port = (await readFile(path.join(dir, "profile", "DevToolsActivePort"), "utf8")).split("\n")[0];
      break;
    } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  assert.ok(port, "Chromium did not start its debugging endpoint");
  const tabs = await (await globalThis.fetch("http://127.0.0.1:" + port + "/json/list")).json();
  const tab = tabs.find((item) => item.type === "page");
  assert.ok(tab, "Chromium page is missing");
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const response = JSON.parse(String(event.data));
    const request = pending.get(response.id);
    if (request !== undefined) {
      pending.delete(response.id);
      if (response.error) request.reject(response.error);
      else request.resolve(response.result);
    }
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const response = await command("Runtime.evaluate", { expression, returnByValue: true });
    assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
    return response.result.value;
  };
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      ready = await evaluate("location.href === " + JSON.stringify(url)
        + " && typeof window.transposeBrowser === 'object'");
      if (ready) break;
    } catch { /* navigation may replace the initial execution context */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Browser fixture did not load");
  const clickConfirm = async () => {
    const bounds = await evaluate("(function(){ const b=Array.from(document.querySelectorAll('button'))"
      + ".find(x=>x.textContent==='Transpose anyway'); if(!b)return null;"
      + "const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
    assert.ok(bounds, "Confirmation button missing");
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: bounds.x, y: bounds.y });
    await command("Input.dispatchMouseEvent", { type: "mousePressed",
      x: bounds.x, y: bounds.y, button: "left", clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased",
      x: bounds.x, y: bounds.y, button: "left", clickCount: 1 });
  };
  await evaluate("window.transposeBrowser.reset('normal')");
  let state = await evaluate("window.transposeBrowser.result()");
  assert.equal(state.confirmationVisible, true);
  assert.equal(state.changes, 0);
  await clickConfirm();
  state = await evaluate("window.transposeBrowser.result()");
  assert.equal(state.changes, 1, JSON.stringify(state));
  assert.equal(state.rowHeaders, 1, JSON.stringify(state));
  assert.ok(state.pointers > 0, "Real mouse input did not generate pointerdown");
  const normal = state;

  await evaluate("window.transposeBrowser.reset('stale')");
  await evaluate("window.transposeBrowser.switchFile()");
  await clickConfirm();
  state = await evaluate("window.transposeBrowser.result()");
  assert.equal(state.changes, 0, JSON.stringify(state));
  assert.equal(state.rowHeaders, 0, JSON.stringify(state));
  assert.ok(state.notices.some((notice) => notice.includes("changed")), JSON.stringify(state));
  const stale = state;

  await evaluate("window.transposeBrowser.reset('popout-draft')");
  state = await evaluate("window.transposeBrowser.result()");
  assert.equal(state.changes, 0, JSON.stringify(state));
  assert.equal(state.confirmationVisible, false, JSON.stringify(state));
  assert.ok(state.notices.some((notice) => notice.includes("active cell draft")), JSON.stringify(state));
  process.stdout.write(JSON.stringify({
    status: "passed", browser: path.basename(browser),
    scenarios: ["real pointer confirmation", "rebound file refusal", "popout draft guard"],
    normal: { writes: normal.changes, pointerdowns: normal.pointers, rowHeaders: normal.rowHeaders },
    stale: { writes: stale.changes },
  }) + "\n");
} finally {
  socket?.close();
  child?.kill();
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
}
