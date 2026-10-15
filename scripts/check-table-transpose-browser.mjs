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
const styles = await readFile("styles.css", "utf8");
const page = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">'
  + '<style>body{margin:24px;font:16px sans-serif}.cm-editor{height:520px;border:1px solid #bbb}.cm-scroller{overflow:auto}.cm-content{padding-bottom:80px}td,th{padding:10px;border:1px solid #999}#host-menu{position:fixed;top:12px;right:12px;background:white;z-index:20}button{padding:12px}</style>'
  + '</head><body><script src="/bundle.js"></script></body></html>';
const server = createServer((request, response) => {
  if (request.url === "/bundle.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(bundle.outputFiles[0].text);
  } else if (request.url === "/styles.css") {
    response.setHeader("Content-Type", "text/css"); response.end(styles);
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
    const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
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
  const settle = () => evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  const click = async (expression, button = "left") => {
    const bounds = await evaluate("(function(){const b=" + expression + ";if(!b)return null;b.scrollIntoView({block:'nearest'});"
      + "const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
    assert.ok(bounds, "Pointer target missing: " + expression);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: bounds.x, y: bounds.y });
    await command("Input.dispatchMouseEvent", { type: "mousePressed",
      x: bounds.x, y: bounds.y, button, clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased",
      x: bounds.x, y: bounds.y, button, clickCount: 1 });
    await settle();
  };
  const select = (selector) => "document.querySelector(" + JSON.stringify(selector) + ")";
  const clickConfirm = () => click("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Transpose anyway')");
  const results = [];
  for (const mode of ["owned", "source", "native"]) {
    await evaluate("window.transposeBrowser.reset(" + JSON.stringify(mode) + ")"); await settle();
    if (mode === "source") await click(select("#transpose-source"));
    else {
      await click(select(mode === "owned" ? "[data-structural-row='1'][data-structural-column='0']" : ".cm-table-widget td"), "right");
      await click(select("#transpose-menu-item"));
    }
    let state = await evaluate("window.transposeBrowser.result()");
    assert.equal(state.confirmationVisible, true, JSON.stringify(state));
    assert.equal(state.changes, 0);
    if (mode === "owned") assert.equal(state.selectedCells, 0, "Modal focus should be allowed to clear visual selection");
    await clickConfirm();
    state = await evaluate("window.transposeBrowser.result()");
    assert.equal(state.changes, 1, JSON.stringify(state)); assert.equal(state.rowHeaders, 1, JSON.stringify(state));
    assert.equal(state.undoDepth, 2, JSON.stringify(state)); assert.equal(state.otherSource, "Other file stays.");
    assert.ok(state.source.startsWith("Before stays.\n\n") && state.source.endsWith("\n\nAfter stays."));
    assert.ok(state.pointers >= 2, "Real mouse input did not generate pointerdown");
    const transposed = state.source;
    await evaluate("window.transposeBrowser.undo()"); await settle();
    state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, state.beforeTranspose);
    await evaluate("window.transposeBrowser.undo()"); await settle();
    state = await evaluate("window.transposeBrowser.result()"); assert.ok(state.source.includes("North |"));
    await evaluate("window.transposeBrowser.redo();window.transposeBrowser.redo()"); await settle();
    state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, transposed);
    results.push({ mode, writes: 1, undoRedo: true, pointerdowns: state.pointers });
  }

  await evaluate("window.transposeBrowser.reset('source')"); await settle();
  await click(select("#transpose-source"));
  await evaluate("window.transposeBrowser.switchFile()");
  await clickConfirm();
  let state = await evaluate("window.transposeBrowser.result()");
  assert.equal(state.changes, 0, JSON.stringify(state));
  assert.equal(state.rowHeaders, 0, JSON.stringify(state));
  assert.ok(state.notices.some((notice) => notice.includes("changed")), JSON.stringify(state));
  results.push({ mode: "rebound-file", writes: state.changes });

  await evaluate("window.transposeBrowser.reset('popout-draft')"); await settle();
  await click(select("#transpose-source"));
  state = await evaluate("window.transposeBrowser.result()");
  assert.equal(state.changes, 0, JSON.stringify(state));
  assert.equal(state.confirmationVisible, false, JSON.stringify(state));
  assert.ok(state.notices.some((notice) => notice.includes("active cell draft")), JSON.stringify(state));
  results.push({ mode: "popout-draft", writes: state.changes });
  for (const mode of ["focus", "focus-after", "focus-canceled"]) {
    await evaluate("window.transposeBrowser.reset(" + JSON.stringify(mode) + ")"); await settle();
    await click(select("[data-structural-row='22'][data-structural-column='4']"));
    state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.draft, true, JSON.stringify(state));
    if (mode === "focus-canceled") {
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await settle(); state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.draft, false);
    }
    await evaluate("window.savedTable=document.querySelector('.structural-tables-live-preview table')");
    const before = state;
    // Real mousedown/focus/mouseup lets CodeMirror place the source caret; the
    // harness does not dispatch a replacement selection for this regression.
    await click("Array.from(document.querySelectorAll('#target-note .cm-line')).at(-1)");
    state = await evaluate("window.transposeBrowser.result()");
    assert.equal(state.source, before.source); assert.equal(state.changes, 0); assert.equal(state.draft, false);
    assert.equal(state.anchor, state.head, JSON.stringify(state));
    assert.ok(state.anchor >= state.source.lastIndexOf("\n"), JSON.stringify(state));
    assert.equal(await evaluate("window.savedTable===document.querySelector('.structural-tables-live-preview table')"), true);
    assert.equal(state.spans, 11); assert.ok(Math.abs(state.tableHeight - before.tableHeight) < 1, JSON.stringify(state));
    assert.ok(Math.abs(state.scrollTop - before.scrollTop) < 2, JSON.stringify({ before: before.scrollTop, after: state.scrollTop }));
    results.push({ mode, sourcePreserved: true, stableGeometry: true, collapsedCaret: true });
  }
  process.stdout.write(JSON.stringify({ status: "passed", browser: path.basename(browser), scenarios: results }) + "\n");
} finally {
  socket?.close();
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await stopped;
  }
  await new Promise((resolve) => server.close(resolve));
  // Chromium writes its profile asynchronously. Wait for process exit and
  // allow the OS to finish releasing child profile files before cleanup.
  await rm(dir, { recursive: true, force: true, maxRetries: 12, retryDelay: 150 });
}
