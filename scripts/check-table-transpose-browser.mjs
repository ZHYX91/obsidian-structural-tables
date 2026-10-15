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
  + '<style>body{margin:24px;font:16px sans-serif}.host-box-sizing *{box-sizing:border-box}.host-box-sizing .markdown-rendered{white-space:normal}.host-box-sizing .structural-tables-table{table-layout:fixed}.cm-editor{height:520px;border:1px solid #bbb}.cm-scroller{overflow:auto}.cm-content{padding-bottom:80px}td,th{padding:10px;border:1px solid #999}#host-menu{position:fixed;top:12px;right:12px;background:white;z-index:20}button{padding:12px}</style>'
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
  const tap = async (expression) => {
    const bounds = await evaluate("(function(){const b=" + expression + ";b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
    await command("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds.x, y: bounds.y }] });
    await command("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await settle();
  };
  const clickConfirm = () => click("Array.from(document.querySelectorAll('button')).find(x=>x.textContent==='Transpose anyway')");
  const historyKey = async (redo = false) => {
    const key = redo ? "y" : "z";
    const code = redo ? "KeyY" : "KeyZ";
    const windowsVirtualKeyCode = redo ? 89 : 90;
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, modifiers: 2 });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers: 2 });
    await settle();
  };
  const key = async (name, code = name, windowsVirtualKeyCode = 0) => {
    await command("Input.dispatchKeyEvent", { type: "keyDown", key: name, code, windowsVirtualKeyCode });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key: name, code, windowsVirtualKeyCode });
    await settle();
  };
  const results = [];
  for (const mode of ["owned", "source", "native", "native-child", "popout-source"]) {
    await evaluate("window.transposeBrowser.reset(" + JSON.stringify(mode) + ")"); await settle();
    if (mode === "source" || mode === "native-child" || mode === "popout-source") await click(select("#transpose-source"));
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
    assert.equal(state.editorFocused, true, JSON.stringify({ mode, ...state }));
    if (mode !== "owned") assert.equal(state.contentFocused, true, JSON.stringify({ mode, ...state }));
    const transposed = state.source;
    await historyKey();
    state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, state.beforeTranspose, JSON.stringify({ mode, ...state }));
    assert.equal(state.editorFocused, true, JSON.stringify(state));
    if (mode !== "owned") assert.equal(state.contentFocused, true, JSON.stringify(state));
    await historyKey();
    state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, state.initialSource);
    await historyKey(true);
    state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, state.beforeTranspose);
    await historyKey(true);
    state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, transposed);
    results.push({ mode, writes: 1, keyboardUndoRedo: true, pointerdowns: state.pointers });
  }

  await evaluate("window.transposeBrowser.reset('source')"); await settle();
  await click(select("#transpose-source"));
  await evaluate("window.transposeBrowser.switchFile()");
  await clickConfirm();
  let state = await evaluate("window.transposeBrowser.result()");
  assert.equal(state.changes, 0, JSON.stringify(state));
  assert.equal(state.rowHeaders, 0, JSON.stringify(state));
  assert.equal(state.editorFocused, false, JSON.stringify(state));
  assert.ok(state.notices.some((notice) => notice.includes("changed")), JSON.stringify(state));
  results.push({ mode: "rebound-file", writes: state.changes });

  await evaluate("window.transposeBrowser.reset('popout-draft')"); await settle();
  await click(select("#transpose-source"));
  state = await evaluate("window.transposeBrowser.result()");
  assert.equal(state.changes, 0, JSON.stringify(state));
  assert.equal(state.confirmationVisible, false, JSON.stringify(state));
  assert.ok(state.notices.some((notice) => notice.includes("active cell draft")), JSON.stringify(state));
  results.push({ mode: "popout-draft", writes: state.changes });
  for (const mode of ["rtl", "ltr-arabic"]) {
    await evaluate("window.transposeBrowser.reset(" + JSON.stringify(mode) + ")"); await settle();
    state = await evaluate("window.transposeBrowser.result()");
    assert.equal(state.tableDirection, mode === "rtl" ? "rtl" : "ltr", JSON.stringify(state));
    assert.ok(mode === "rtl" ? state.cellLefts[0] > state.cellLefts[3] : state.cellLefts[0] < state.cellLefts[3], JSON.stringify(state));
    assert.equal(state.rowHeaders, 1);
    const before = state.source;
    await click(select("[data-structural-row='1'][data-structural-column='1']"), "right");
    await click(select("#menu-move-left"));
    state = await evaluate("window.transposeBrowser.result()");
    if (mode === "rtl") assert.deepEqual(state.rowValues.slice(1), ["Two", "ABC", "Three"]);
    else assert.equal(state.source, before, "A physical left move cannot cross the row-header boundary");
    if (mode === "rtl") {
      await historyKey(); state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, before);
      await key("ArrowLeft", "ArrowLeft", 37);
      state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.activeColumn, "2", JSON.stringify(state));
      await key("ArrowRight", "ArrowRight", 39);
      state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.activeColumn, "1", JSON.stringify(state));
    }
    results.push({ mode, leadingHeaders: true, physicalMenu: true, sourcePreserved: true });
  }
  for (const [action, column, expected] of [
    ["insert-left", 1, ["NorthX", "ABC", "", "Two", "Three"]],
    ["insert-right", 1, ["NorthX", "", "ABC", "Two", "Three"]],
    ["move-right", 2, ["NorthX", "Two", "ABC", "Three"]],
  ]) {
    await evaluate("window.transposeBrowser.reset('rtl')"); await settle();
    const before = await evaluate("window.transposeBrowser.result().source");
    await click(select("[data-structural-row='1'][data-structural-column='" + column + "']"), "right");
    await click(select("#menu-" + action));
    state = await evaluate("window.transposeBrowser.result()"); assert.deepEqual(state.rowValues, expected);
    await historyKey(); state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, before);
    results.push({ mode: "rtl-" + action, physicalMenu: true, keyboardUndo: true });
  }
  await evaluate("window.transposeBrowser.reset('rtl')"); await settle();
  const beforeRtlTranspose = await evaluate("window.transposeBrowser.result().source");
  await click(select("[data-structural-row='1'][data-structural-column='1']"), "right");
  await click(select("#transpose-menu-item"));
  const rtlTransposed = await evaluate("window.transposeBrowser.result().source");
  assert.notEqual(rtlTransposed, beforeRtlTranspose);
  await historyKey(); state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, beforeRtlTranspose);
  await historyKey(true); state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.source, rtlTransposed);
  results.push({ mode: "rtl-transpose", keyboardUndoRedo: true });
  for (const mode of ["rtl-ascii-draft", "ltr-arabic-draft", "ltr-mixed-draft"]) {
    for (const arrow of ["ArrowLeft", "ArrowRight"]) {
      await evaluate("window.transposeBrowser.reset(" + JSON.stringify(mode) + ")"); await settle();
      await evaluate("(function(){const table=document.querySelector('.structural-tables-table');const cell=table.querySelector('[data-structural-row=\"1\"][data-structural-column=\"1\"] .structural-tables-cell-content');const probe=document.createElement('textarea');probe.id='native-caret-probe';probe.value=cell.textContent;probe.dir=getComputedStyle(table).direction;document.body.append(probe);probe.focus();probe.setSelectionRange(0,0);})()");
      await key(arrow, arrow, arrow === "ArrowLeft" ? 37 : 39);
      const nativeCaret = await evaluate("(function(){const probe=document.querySelector('#native-caret-probe');const result=[probe.selectionStart,probe.selectionEnd];probe.remove();return result;})()");
      await click(select("[data-structural-row='1'][data-structural-column='1']"));
      await evaluate("document.querySelector('textarea.structural-tables-cell-editor').setSelectionRange(0,0)");
      const before = await evaluate("window.transposeBrowser.result().source");
      await key(arrow, arrow, arrow === "ArrowLeft" ? 37 : 39);
      state = await evaluate("window.transposeBrowser.result()");
      assert.equal(state.draft, true, JSON.stringify(state)); assert.equal(state.activeColumn, "1", JSON.stringify(state));
      assert.deepEqual([state.draftStart, state.draftEnd], nativeCaret, JSON.stringify(state));
      assert.equal(state.source, before); assert.equal(state.changes, 0);
      await key("Escape", "Escape", 27);
      results.push({ mode, arrow, nativeCaret: true, sourcePreserved: true });
    }
  }
  for (const mode of ["focus", "focus-after", "focus-canceled", "focus-wide", "focus-wide-rtl", "focus-wide-edited", "focus-wide-edited-rtl", "focus-wide-edited-blank", "focus-wide-edited-blank-rtl", "focus-wide-edited-mouse", "focus-wide-edited-mouse-rtl", "focus-wide-edited-mouse-double", "focus-wide-edited-mouse-drag", "focus-wide-edited-mouse-shrink",
    ...["mouse-above", "mouse-above-blank", "edited-mouse-above", "edited-mouse-above-blank"].flatMap((suffix) => ["focus-wide-" + suffix, "focus-wide-" + suffix + "-rtl"])]) {
    const asyncMouse = mode.includes("blank") || mode.includes("mouse");
    const nativeRange = mode.includes("double") || mode.includes("drag");
    const above = mode.includes("above");
    await evaluate("window.transposeBrowser.reset(" + JSON.stringify(mode) + ")"); await settle();
    const initial = await evaluate("window.transposeBrowser.result()"); const initialTableHeight = initial.tableHeight;
    await click(select("[data-structural-row='" + (asyncMouse ? "21" : "22") + "'][data-structural-column='" + (asyncMouse ? "2" : "4") + "']"));
    state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.draft, true, JSON.stringify(state));
    const edited = mode.includes("edited");
    const editedValue = mode.includes("shrink") ? "QA" : asyncMouse ? "Stir fried peppers 7 QA" : "last-cell-final-longx";
    if (edited) {
      await evaluate("document.querySelector('textarea.structural-tables-cell-editor').select()");
      await command("Input.insertText", { text: editedValue }); await settle();
      state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.draftValue, editedValue);
    }
    if (mode === "focus-canceled") {
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await settle(); state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.draft, false);
    }
    await evaluate("window.savedTable=document.querySelector('.structural-tables-live-preview table')");
    if (asyncMouse) { await evaluate("document.querySelector('#target-note .cm-scroller').scrollTop=" + (above ? "0" : "100000") + ";document.querySelector('.structural-tables-container').scrollLeft=" + (mode.endsWith("rtl") ? "-100" : "100")); await settle(); }
    const pointer = asyncMouse ? await evaluate(mode.includes("blank")
      ? "(function(){const r=document.querySelector('#target-note .cm-content').getBoundingClientRect();const x=r.left+r.width/2,y=" + (above ? "r.top+24" : "r.bottom-24") + ";return {x,y,target:document.elementFromPoint(x,y)?.className};})()"
      : "(function(){const line=Array.from(document.querySelectorAll('#target-note .cm-line'))" + (above ? "[0]" : ".at(-1)") + ";function point(offset){const range=document.createRange();range.setStart(line.firstChild,offset);range.setEnd(line.firstChild,offset+1);const r=range.getBoundingClientRect();return {x:r.left+1,y:r.top+r.height/2};}const start=point(7),end=point(Math.min(13,line.firstChild.length-1));return {...start,end,target:document.elementFromPoint(start.x,start.y)?.className};})()") : null;
    if (pointer !== null) { assert.match(pointer.target, mode.includes("blank") ? /cm-content/u : /cm-line/u, JSON.stringify(pointer)); state = await evaluate("window.transposeBrowser.result()"); }
    const before = state;
    if (mode.startsWith("focus-wide")) {
      assert.ok(before.horizontalOverflow > 100, JSON.stringify(before));
      assert.ok(Math.abs(before.horizontalScroll) > 10, JSON.stringify(before));
      // Opening a draft and tapping another location are separate actions.
      // Do not accidentally request native multi-click word/paragraph selection.
      await evaluate("new Promise(r=>setTimeout(r,600))");
    }
    // Real mousedown/focus/mouseup lets CodeMirror place the source caret; the
    // harness does not dispatch a replacement selection for this regression.
    if (pointer !== null) {
      const clickCount = mode.includes("double") ? 2 : 1;
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: pointer.x, y: pointer.y });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", x: pointer.x, y: pointer.y, button: "left", clickCount });
      const duringPress = await evaluate("window.transposeBrowser.result()");
      assert.ok(Math.abs(duringPress.scrollTop - before.scrollTop) < 5 + Math.max(0, before.tableHeight - initialTableHeight), JSON.stringify({mode,stage:"during-mousedown",before:before.scrollTop,after:duringPress.scrollTop,geometry:duringPress.commitGeometry,changes:duringPress.changes,draft:duringPress.draft,anchor:duringPress.anchor,head:duringPress.head,trace:duringPress.focusTrace,notices:duringPress.notices}));
      await evaluate("new Promise(r=>setTimeout(r,100))");
      const end = mode.includes("drag") ? pointer.end : pointer;
      if (mode.includes("drag")) await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: end.x, y: end.y, button: "left", buttons: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left", clickCount }); await settle();
      await evaluate("window.transposeBrowser.rendered()"); await settle();
    } else if (mode.startsWith("focus-wide")) await tap("Array.from(document.querySelectorAll('#target-note .cm-line')).at(-1)");
    else await click("Array.from(document.querySelectorAll('#target-note .cm-line')).at(-1)");
    state = await evaluate("window.transposeBrowser.result()");
    if (edited) { assert.equal(state.changes, 1); assert.equal(state.lastValue, editedValue); assert.equal(state.source, state.expectedEditedSource); }
    else { assert.equal(state.source, before.source); assert.equal(state.changes, 0); }
    assert.equal(state.draft, false);
    assert.equal(state.anchor === state.head, !nativeRange, JSON.stringify(state));
    if (above) assert.ok(Math.max(state.anchor,state.head) <= state.source.indexOf("\n"), JSON.stringify(state));
    else assert.ok(Math.min(state.anchor,state.head) >= state.source.lastIndexOf("\n"), JSON.stringify(state));
    if (nativeRange) assert.equal(state.source.slice(Math.min(state.anchor,state.head),Math.max(state.anchor,state.head)), mode.includes("double") ? "the" : "he tab");
    assert.equal(await evaluate("window.savedTable===document.querySelector('.structural-tables-live-preview table')"), !edited,
      JSON.stringify({ mode, beforeHorizontal: before.horizontalScroll, afterHorizontal: state.horizontalScroll, beforeVertical: before.scrollTop, afterVertical: state.scrollTop, sourcePreserved: before.source === state.source, anchor: state.anchor, head: state.head, trace: state.focusTrace }));
    assert.equal(state.spans, initial.spans);
    if (mode.includes("shrink")) {
      assert.ok(state.hostHeight < before.hostHeight, JSON.stringify({ mode, before: before.hostHeight, after: state.hostHeight }));
      assert.ok(Math.abs(state.blockHeight - state.hostHeight) < 1, JSON.stringify({ mode, blockHeight: state.blockHeight, hostHeight: state.hostHeight }));
    } else {
      assert.ok(Math.abs(state.tableHeight - initialTableHeight) < 1, JSON.stringify({ mode, initialTableHeight, beforeHeight: before.tableHeight, afterHeight: state.tableHeight }));
      assert.ok(Math.abs(state.scrollTop - before.scrollTop) < (edited ? 5 + Math.max(0, before.tableHeight - initialTableHeight) : 2), JSON.stringify({ mode, before: before.scrollTop, after: state.scrollTop, geometry:state.commitGeometry, trace:state.focusTrace }));
    }
    if (pointer !== null) {
      assert.equal(state.reservedHeight, "");
      if (edited) {
        const empty = state.commitGeometry.filter((sample) => sample.empty); assert.ok(empty.length > 0, JSON.stringify(state.commitGeometry));
        for (const sample of empty) assert.ok(sample.height >= before.hostHeight - 1 && Math.abs(sample.scrollTop - before.scrollTop) < 2, JSON.stringify({mode,beforeHeight:before.hostHeight,beforeScroll:before.scrollTop,sample}));
      }
      await evaluate("window.readyTable=document.querySelector('.structural-tables-live-preview table');window.transposeBrowser.refresh()"); await settle();
      const refreshed = await evaluate("window.transposeBrowser.result()");
      assert.equal(await evaluate("window.readyTable===document.querySelector('.structural-tables-live-preview table')"), true);
      assert.equal(refreshed.reservedHeight, ""); assert.ok(Math.abs(refreshed.scrollTop - state.scrollTop) < 1);
    }
    if (mode.startsWith("focus-wide")) {
      assert.equal(state.lastClickDetail, mode.includes("double") ? 2 : 1, JSON.stringify({ mode, trace: state.focusTrace }));
      assert.ok(Math.abs(state.horizontalScroll - before.horizontalScroll) < 1, JSON.stringify({ mode, before, after: state }));
    }
    if (edited) {
      const committed = state.source;
      await historyKey(); assert.equal((await evaluate("window.transposeBrowser.result()")).source, before.source);
      if (asyncMouse) { await evaluate("window.transposeBrowser.rendered()"); await settle(); assert.ok(["", null].includes((await evaluate("window.transposeBrowser.result()")).reservedHeight)); }
      await historyKey(true); assert.equal((await evaluate("window.transposeBrowser.result()")).source, committed);
      if (asyncMouse) { await evaluate("window.transposeBrowser.rendered()"); await settle(); assert.ok(["", null].includes((await evaluate("window.transposeBrowser.result()")).reservedHeight)); }
    }
    results.push({ mode, sourcePreserved: !edited, cellCommitted: edited, stableGeometry: true, collapsedCaret: !nativeRange,
      ...(mode.startsWith("focus-wide") ? { ...(asyncMouse ? { realMouse: true, asynchronousRendering: true } : { realTouch: true }), localHorizontalScroll: true } : {}) });
  }
  const bidi = await evaluate("window.transposeBrowser.interfaceBidi()");
  assert.ok(bidi.technicalLefts[0] < bidi.technicalLefts[1], JSON.stringify(bidi));
  assert.ok(bidi.pathLefts.every((left, index) => index === 0 || left > bidi.pathLefts[index - 1]), JSON.stringify(bidi));
  assert.ok(bidi.mappingLefts[0] < bidi.mappingLefts[1], JSON.stringify(bidi));
  assert.equal(bidi.pathText, "ملاحظات/تقارير/ملخص-2026.md"); assert.equal(bidi.codeDirection, "ltr"); assert.equal(bidi.mappingIsolation, "isolate");
  for (const positions of bidi.migrationPathLefts) assert.ok(positions.every((left, index) => index === 0 || left > positions[index - 1]), JSON.stringify(bidi));
  results.push({ mode: "arabic-interface-bidi", technicalExpressions: true, pathOrder: true, mappingOrder: true });
  results.push({ mode: "arabic-migration-preview", initialPathOrder: true, togglePathOrder: true });
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
