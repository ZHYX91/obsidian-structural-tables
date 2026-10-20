import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { startBrowserHarness } from "./browser-harness-runner.mjs";

const bundle = await build({ entryPoints: ["tests/browser/plain-gfm-browser-harness.ts"], bundle: true,
  alias: { obsidian: path.resolve("tests/mocks/obsidian.ts") }, write: false, format: "iife", platform: "browser" });
const styles = await readFile("styles.css", "utf8");
let localFont = "sans-serif";
const server = createServer((request, response) => {
  if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html><head><meta charset="utf-8"><style>
    :root{--size-4-4:16px;--size-4-2:8px;--background-primary:#fff;--background-secondary:#f5f5f5;--text-normal:#222;--text-muted:#555;--background-modifier-border:#aaa;--font-ui-small:14px;--font-ui-smaller:12px;--radius-m:8px;--cursor:default}
    *{box-sizing:border-box}body{margin:20px;font:16px/1.5 ${JSON.stringify(localFont)}}button,select{font:inherit;padding:8px;margin:4px;min-height:44px}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #777}.cm-editor{max-height:540px;border:1px solid #aaa}.cm-scroller{overflow:auto}#host-menu{position:fixed;inset:12px 12px auto auto;background:#fff;z-index:10}
    ${styles}
    .structural-tables-gfm-preview{position:fixed;inset:24px;z-index:20;margin:auto;max-width:720px;max-height:calc(100vh - 48px);overflow:auto;padding:20px;border:1px solid #aaa;background:#fff;box-shadow:0 8px 32px #0003}.structural-tables-gfm-preview h2{margin-top:0}.structural-tables-gfm-preview>button{max-width:100%}
    @media(max-width:480px){.structural-tables-gfm-preview{inset:8px;max-height:calc(100vh - 16px);padding:12px}}
    </style></head><body><script src="/bundle.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let session;
try {
  session = await startBrowserHarness({ name: "gfm" });
  localFont = session.localFont;
  const address = server.address(); assert.ok(address !== null && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const { command, evaluate } = session;
  await command("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await session.navigate(origin + "/", "typeof window.gfmBrowser === 'object'");
  const settle = () => evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  const waitFor = (expression) => evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{if(${expression}){clearInterval(timer);resolve(true)}else if(++attempts>100){clearInterval(timer);reject(new Error('GFM fixture timed out: '+${JSON.stringify(expression)}))}},50)})`);
  const click = async (expression, button = "left") => {
    await evaluate(`(${expression})?.scrollIntoView({block:'nearest'})`); await settle();
    const bounds = await evaluate(`(()=>{const element=${expression};if(!element)return null;const r=element.getBoundingClientRect();const point={x:r.left+r.width/2,y:r.top+r.height/2};document.body.dataset.clickTarget=JSON.stringify({requested:element.outerHTML.slice(0,240),hit:document.elementFromPoint(point.x,point.y)?.outerHTML.slice(0,240),point});return point})()`);
    assert.ok(bounds, "Pointer target missing: " + expression);
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...bounds });
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...bounds, button, clickCount: 1 });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...bounds, button, clickCount: 1 });
    await settle();
  };
  const key = async (value, virtual, modifiers = 0) => {
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: value, windowsVirtualKeyCode: virtual, modifiers });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: value, windowsVirtualKeyCode: virtual, modifiers }); await settle();
  };
  const action = (name) => click(`window.gfmBrowser.action(${JSON.stringify(name)})`);
  // Windows normalizes text clipboard newlines to CRLF; compare the Markdown content.
  const clipboardMarkdown = async () => (await evaluate("navigator.clipboard.readText()")).replaceAll("\r\n", "\n");
  const orientation = async (value) => {
    await click("document.querySelector('.structural-tables-gfm-preview select')");
    await key(value === "keep" ? "Home" : "End", value === "keep" ? 36 : 35);
    await key("Enter", 13); await waitFor("window.gfmBrowser.state().copyReady");
    assert.equal((await evaluate("window.gfmBrowser.state()")).orientation, value);
  };
  const results = [];
  for (const mode of ["source", "owned", "native"]) {
    await evaluate(`window.gfmBrowser.reset(${JSON.stringify(mode)})`); await evaluate("window.gfmBrowser.rendered()"); await settle();
    if (mode === "source") await click("document.querySelector('#gfm-source')");
    else {
      await click(mode === "owned"
        ? "document.querySelector('[data-structural-source-table-index=\"1\"] td')"
        : "document.querySelectorAll('.cm-table-widget')[1].querySelector('td')", "right");
      await waitFor("document.querySelector('#gfm-menu-item') !== null");
      await click("document.querySelector('#gfm-menu-item')");
    }
    await waitFor("window.gfmBrowser.state().copyReady");
    let state = await evaluate("window.gfmBrowser.state()");
    assert.equal(state.writes, 0); assert.equal(state.source, state.initialSource);
    if (mode === "native") await orientation("transpose");
    else { assert.equal(state.orientation, "transpose"); assert.deepEqual(state.headers, ["Name", "Age", "City"]); }
    state = await evaluate("window.gfmBrowser.state()");
    const candidate = state.previewSource;
    await action("source"); state = await evaluate("window.gfmBrowser.state()");
    assert.equal(state.sourceVisible, true); assert.equal(state.previewVisible, false);
    await action("copy"); await waitFor("window.gfmBrowser.state().copyReady");
    assert.equal(await clipboardMarkdown(), candidate);
    await action("preview"); state = await evaluate("window.gfmBrowser.state()");
    assert.equal(state.previewVisible, true); assert.equal(state.sourceVisible, false);
    await action("replace"); await waitFor("!window.gfmBrowser.state().modal");
    state = await evaluate("window.gfmBrowser.state()");
    assert.equal(state.writes, 1); assert.equal(state.undoDepth, 1); assert.equal(state.focused, true);
    assert.equal(state.source, `Before stays.\n\n${state.targetSource}\n\nBetween stays.\n\n${candidate}\n\nAfter stays.`);
    const converted = state.source;
    await key("z", 90, 2); state = await evaluate("window.gfmBrowser.state()"); assert.equal(state.source, state.initialSource);
    await key("y", 89, 2); state = await evaluate("window.gfmBrowser.state()"); assert.equal(state.source, converted);
    assert.ok(state.pointers >= 5); results.push({ mode, exactCopy: true, secondIdenticalTable: true, oneWrite: true, keyboardUndoRedo: true });
  }
  await evaluate("window.gfmBrowser.reset('source')"); await click("document.querySelector('#gfm-source')");
  await waitFor("window.gfmBrowser.state().copyReady"); await orientation("keep");
  let state = await evaluate("window.gfmBrowser.state()"); assert.deepEqual(state.headers, ["", "", ""]);
  await action("copy"); await waitFor("window.gfmBrowser.state().copyReady");
  assert.equal(await clipboardMarkdown(), state.previewSource); assert.equal(state.writes, 0);
  await evaluate("window.gfmBrowser.switchFile()"); await action("replace");
  state = await evaluate("window.gfmBrowser.state()"); assert.equal(state.writes, 0); assert.equal(state.source, state.initialSource);
  assert.ok(state.notices.some((notice) => notice.includes("changed")));
  results.push({ mode: "keep-and-stale-file", emptyHeaderExplicit: true, exactCopy: true, staleWrites: 0 });

  await evaluate("window.gfmBrowser.reset('reading')"); await settle();
  await click("document.querySelector('#reading td')", "right"); await waitFor("document.querySelector('#gfm-menu-item') !== null");
  await click("document.querySelector('#gfm-menu-item')"); await waitFor("window.gfmBrowser.state().copyReady");
  state = await evaluate("window.gfmBrowser.state()"); assert.equal(state.replaceAvailable, false);
  await action("copy"); await waitFor("window.gfmBrowser.state().copyReady");
  assert.equal(await clipboardMarkdown(), state.previewSource);
  assert.equal((await evaluate("window.gfmBrowser.state()")).writes, 0);
  results.push({ mode: "reading", exactCopy: true, noReplacementAction: true, writes: 0 });

  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await evaluate("window.gfmBrowser.reset('ar')"); await click("document.querySelector('#gfm-source')");
  await waitFor("window.gfmBrowser.state().copyReady");
  state = await evaluate("window.gfmBrowser.state()"); assert.equal(state.interfaceDirection, "rtl");
  assert.equal(state.previewDirection, "ltr"); assert.equal(state.sourceDirection, "ltr");
  assert.deepEqual(state.headers, ["Name", "Age", "City"]); assert.equal(state.writes, 0);
  assert.ok(state.modalWidth < state.viewportWidth);
  for (const control of state.controls) { assert.ok(control.left >= 0 && control.right <= state.viewportWidth, JSON.stringify(control)); assert.ok(control.height >= 44); }
  const screenshot = await command("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(session.artifacts, "gfm-arabic-narrow.png"), Buffer.from(screenshot.data, "base64"));
  results.push({ mode: "arabic-narrow", noteDirectionIndependent: true, controlsFit: true, minimumTarget: 44 });
  await session.result({ status: "passed", scenarios: results });
} catch (error) {
  await session?.diagnose(error, "window.gfmBrowser?.state()"); throw error;
} finally {
  await session?.close(); await new Promise((resolve) => server.close(resolve));
}
