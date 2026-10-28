import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { startBrowserHarness } from "./browser-harness-runner.mjs";

const browser = process.argv[2] || process.env.CHROMIUM_PATH;
assert.ok(browser, "Usage: node scripts/check-table-transpose-browser.mjs <Chromium executable>");
const scenario = process.argv[3] || "all";
const scenarios = ["transpose", "focus", "editing", "arrows", "history-bidi", "alignment"];
assert.ok(scenario === "all" || scenarios.includes(scenario), "Unknown transpose scenario: " + scenario);
const selected = (name) => scenario === "all" || scenario === name;
let localFont = "sans-serif";
const bundle = await build({
  entryPoints: ["tests/browser/table-transpose-browser-harness.ts"],
  bundle: true,
  alias: { obsidian: path.resolve("tests/mocks/obsidian.ts") },
  format: "iife", platform: "browser", write: false,
});
const styles = await readFile("styles.css", "utf8");
const page = '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css">'
  + '<style>body{margin:24px;font:16px/1.5 __FIXTURE_FONT__}.host-box-sizing *{box-sizing:border-box}.host-box-sizing .markdown-rendered{white-space:normal}.host-box-sizing .structural-tables-table{table-layout:fixed}.cm-editor{height:520px;border:1px solid #bbb}.cm-scroller{overflow:auto}.cm-content{padding-bottom:80px}td,th{padding:10px;border:1px solid #999}#host-menu{position:fixed;top:12px;right:12px;background:white;z-index:20}button{padding:12px}</style>'
  + '<style>.alignment-surface{--text-normal:#000;--table-selection:transparent}.alignment-surface .markdown-rendered{font:24px/32px __FIXTURE_FONT__;white-space:normal}.alignment-surface .structural-tables-table{table-layout:fixed}.alignment-surface textarea{caret-color:transparent;background:#fff!important;color:#000!important}</style>'
  + '<style>#target-note.switch-surface .cm-content{padding-inline-start:34px!important;}</style>'
  + '</head><body><script src="/bundle.js"></script></body></html>';
const server = createServer((request, response) => {
  if (request.url === "/bundle.js") {
    response.setHeader("Content-Type", "application/javascript");
    response.end(bundle.outputFiles[0].text);
  } else if (request.url === "/styles.css") {
    response.setHeader("Content-Type", "text/css"); response.end(styles);
  } else {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(page.replaceAll("__FIXTURE_FONT__", JSON.stringify(localFont)));
  }
});
let session;
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const url = "http://127.0.0.1:" + address.port + "/";
  session = await startBrowserHarness({ name: "transpose-" + scenario, browser });
  localFont = session.localFont;
  const { command, evaluate } = session;
  await session.navigate(url, "typeof window.transposeBrowser === 'object'");
  const settle = async () => {
    await session.ensureVisible();
    return evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  };
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
  let state;
  if (selected("transpose")) {
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
  state = await evaluate("window.transposeBrowser.result()");
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
      await evaluate("(function(){const table=document.querySelector('.structural-tables-table');const cell=table.querySelector('[data-structural-row=\"1\"][data-structural-column=\"1\"] .structural-tables-cell-content');const probe=document.createElement('textarea');probe.id='native-caret-probe';probe.value=cell.textContent;probe.dir='auto';document.body.append(probe);probe.focus();probe.setSelectionRange(0,0);})()");
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
  }
  if (selected("focus")) {
  for (const mode of ["focus", "focus-after", "focus-canceled", "focus-wide", "focus-wide-rtl", "focus-wide-edited", "focus-wide-edited-rtl", "focus-wide-edited-blank", "focus-wide-edited-blank-rtl", "focus-wide-edited-mouse", "focus-wide-edited-mouse-rtl", "focus-wide-edited-mouse-double", "focus-wide-edited-mouse-drag", "focus-wide-edited-mouse-shrink", "focus-wide-mouse-external", "focus-wide-mouse-external-rtl", "focus-wide-edited-mouse-shrink-detach",
    ...["mouse-above", "mouse-above-blank", "edited-mouse-above", "edited-mouse-above-blank"].flatMap((suffix) => ["focus-wide-" + suffix, "focus-wide-" + suffix + "-rtl"])]) {
    process.stdout.write(`Focus mode: ${mode}\n`);
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
    if (mode.includes("external")) {
      await evaluate("(function(){const button=document.body.appendChild(document.createElement('button'));button.id='outside-control';button.textContent='External';button.style.cssText='position:fixed;right:12px;top:150px';})()");
      await click(select("#outside-control")); state = await evaluate("window.transposeBrowser.result()"); assert.equal(state.draft, false);
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
      if (mode.includes("detach")) await evaluate("window.transposeBrowser.holdRendering()");
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: pointer.x, y: pointer.y });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", x: pointer.x, y: pointer.y, button: "left", clickCount });
      const duringPress = await evaluate("window.transposeBrowser.result()");
      assert.ok(Math.abs(duringPress.scrollTop - before.scrollTop) < 5 + Math.max(0, before.tableHeight - initialTableHeight), JSON.stringify({mode,stage:"during-mousedown",before:before.scrollTop,after:duringPress.scrollTop,geometry:duringPress.commitGeometry,changes:duringPress.changes,draft:duringPress.draft,anchor:duringPress.anchor,head:duringPress.head,trace:duringPress.focusTrace,notices:duringPress.notices}));
      if (mode.includes("detach")) {
        await evaluate("window.transposeBrowser.detach();window.transposeBrowser.releaseRendering()"); await evaluate("window.transposeBrowser.rendered()");
        assert.equal(await evaluate("window.transposeBrowser.detachedStyle()"), "");
        await evaluate("window.transposeBrowser.reattach()"); await settle(); await settle(); await settle();
        const reattached = await evaluate("window.transposeBrowser.result()");
        assert.equal(reattached.reservedHeight, ""); assert.ok(Math.abs(reattached.blockHeight - reattached.hostHeight) < 1, JSON.stringify({mode,block:reattached.blockHeight,host:reattached.hostHeight}));
      }
      await evaluate("new Promise(r=>setTimeout(r,100))");
      const end = mode.includes("drag") ? pointer.end : pointer;
      if (mode.includes("drag")) await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: end.x, y: end.y, button: "left", buttons: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left", clickCount }); await settle();
      if (mode.includes("detach")) await click("Array.from(document.querySelectorAll('#target-note .cm-line')).at(-1)");
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
      if (!mode.includes("detach")) assert.ok(Math.abs(state.horizontalScroll - before.horizontalScroll) < 1, JSON.stringify({ mode, before, after: state }));
    }
    if (edited) {
      const committed = state.source;
      await historyKey(); assert.equal((await evaluate("window.transposeBrowser.result()")).source, before.source);
      if (asyncMouse) { await evaluate("window.transposeBrowser.rendered()"); await settle(); assert.ok(["", null].includes((await evaluate("window.transposeBrowser.result()")).reservedHeight)); }
      await historyKey(true); assert.equal((await evaluate("window.transposeBrowser.result()")).source, committed);
      if (asyncMouse) { await evaluate("window.transposeBrowser.rendered()"); await settle(); assert.ok(["", null].includes((await evaluate("window.transposeBrowser.result()")).reservedHeight)); }
    }
    results.push({ mode, sourcePreserved: !edited, cellCommitted: edited, stableGeometry: !mode.includes("detach"), collapsedCaret: !nativeRange,
      ...(mode.includes("detach") ? { naturalHeightOnReconnect: true } : {}),
      ...(mode.startsWith("focus-wide") ? { ...(asyncMouse ? { realMouse: true, asynchronousRendering: true } : { realTouch: true }), localHorizontalScroll: !mode.includes("detach") } : {}) });
  }
  }
  if (selected("editing")) {
  // Each host menu stays visible until its public hide lifecycle runs. This
  // deliberately does not auto-remove the previous product menu on right-click.
  await evaluate("window.transposeBrowser.reset('switch')"); await settle();
  const menuSource = (await evaluate("window.transposeBrowser.switchState()")).source;
  await click(select("[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='0']"));
  for (const [table, column] of [[0, 1], [0, 0], [2, 1]]) {
    await click(select("[data-structural-source-table-index='" + table + "'] [data-structural-row='1'][data-structural-column='" + column + "']"), "right");
    assert.equal(await evaluate("document.querySelectorAll('#host-menu').length"), 1);
    assert.equal(await evaluate("document.querySelectorAll('textarea.structural-tables-cell-editor').length"), 0);
    assert.equal((await evaluate("window.transposeBrowser.switchState()")).source, menuSource);
  }
  results.push({ mode: "right-click-menu-replacement", singleVisibleMenu: true, sameTable: true, crossTable: true, sourcePreserved: true });
  // Real Chromium dispatches pointerdown, native focus ownership, pointerup
  // and click; invoking dblclick directly would miss the old-widget loss.
  for (const mode of ["switch", "switch-rtl"]) {
    await evaluate("window.transposeBrowser.reset(" + JSON.stringify(mode) + ")"); await settle();
    const initial = await evaluate("window.transposeBrowser.switchState()");
    const table0 = "[data-structural-source-table-index='0']";
    await click(select(table0 + " [data-structural-row='1'][data-structural-column='0']"));
    let editing = await evaluate("window.transposeBrowser.switchState()");
    assert.equal(editing.draft, "Alpha", JSON.stringify({mode,editing}));
    await evaluate("document.querySelector('textarea.structural-tables-cell-editor').select()");
    await command("Input.insertText", { text: "Changed Alpha" }); await settle();
    editing = await evaluate("window.transposeBrowser.switchState()");
    assert.equal(editing.draft, "Changed Alpha");
    const destination = table0 + " [data-structural-row='1'][data-structural-column='1']";
    const point = await evaluate("(function(){const e=document.querySelector(" + JSON.stringify(destination) + ");const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()");
    await command("Input.dispatchMouseEvent", { type:"mouseMoved", x:point.x, y:point.y });
    await command("Input.dispatchMouseEvent", { type:"mousePressed", x:point.x, y:point.y, button:"left", clickCount:1 });
    const duringPress = await evaluate("window.transposeBrowser.switchState()");
    assert.equal(duringPress.source, initial.source, JSON.stringify({mode,duringPress}));
    await command("Input.dispatchMouseEvent", { type:"mouseReleased", x:point.x, y:point.y, button:"left", clickCount:1 });
    await settle(); await settle();
    editing = await evaluate("window.transposeBrowser.switchState()");
    assert.equal(editing.draft, "Beta", JSON.stringify({mode,editing}));
    assert.equal(editing.activeTable, "0", JSON.stringify({mode,editing}));
    assert.ok(editing.source.includes("Changed Alpha"), JSON.stringify({mode,editing}));
    await command("Input.insertText", { text: "!" }); await settle();
    editing = await evaluate("window.transposeBrowser.switchState()");
    assert.equal(editing.draft, "Beta!", JSON.stringify({mode,editing}));
    // Cross-table target shares the editor but not the original widget.
    await click(select("[data-structural-source-table-index='2'] [data-structural-row='1'][data-structural-column='1']"));
    editing = await evaluate("window.transposeBrowser.switchState()");
    assert.equal(editing.draft, "Delta", JSON.stringify({mode,editing}));
    assert.equal(editing.activeTable, "2", JSON.stringify({mode,editing}));
    assert.ok(editing.source.includes("Beta!"), JSON.stringify({mode,editing}));
    results.push({ mode:mode+"-first-pointer-switch", changes:editing.changes, firstClickEditsB:true, crossTable:true });
  }
  // A real held mouse gesture crosses the textarea/remount boundary.
  for (const origin of ["editor", "other", "cancel"]) {
    await evaluate("window.transposeBrowser.reset('switch')"); await settle();
    await click(select("[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='0']"));
    await evaluate("document.querySelector('textarea.structural-tables-cell-editor').select()");
    await command("Input.insertText", { text:"Range changed Alpha" }); await settle();
    const points = await evaluate("(()=>{const root=document.querySelector('[data-structural-source-table-index=\"0\"]');const point=e=>{const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}};return{editor:point(root.querySelector('textarea')),other:point(root.querySelector('[data-structural-row=\"2\"][data-structural-column=\"1\"]'))}})()");
    const start = origin === "other" ? points.other : points.editor;
    const end = origin === "other" ? points.editor : points.other;
    await command("Input.dispatchMouseEvent", { type:"mouseMoved", ...start });
    await command("Input.dispatchMouseEvent", { type:"mousePressed", ...start, button:"left", clickCount:1 });
    await command("Input.dispatchMouseEvent", { type:"mouseMoved", ...end, button:"left", buttons:1 });
    await settle();
    const ranged = await evaluate("({draft:document.querySelector('textarea.structural-tables-cell-editor')?.value??null,count:document.querySelectorAll('[data-structural-source-table-index=\"0\"] [aria-selected=\"true\"]').length,state:window.transposeBrowser.switchState()})");
    assert.equal(ranged.draft, null, JSON.stringify({origin,ranged}));
    assert.equal(ranged.count, 4, JSON.stringify({origin,ranged}));
    assert.ok(ranged.state.source.includes("Range changed Alpha"));
    assert.equal(ranged.state.changes, 1, JSON.stringify({origin,ranged}));
    if (origin === "cancel") {
      await command("Input.dispatchKeyEvent", { type:"keyDown", key:"Escape", code:"Escape", windowsVirtualKeyCode:27 });
      await command("Input.dispatchKeyEvent", { type:"keyUp", key:"Escape", code:"Escape", windowsVirtualKeyCode:27 });
    }
    await command("Input.dispatchMouseEvent", { type:"mouseReleased", ...end, button:"left", clickCount:1 });
    await settle();
    const after = await evaluate("({draft:document.querySelector('textarea.structural-tables-cell-editor')?.value??null,count:document.querySelectorAll('[data-structural-source-table-index=\"0\"] [aria-selected=\"true\"]').length,state:window.transposeBrowser.switchState()})");
    assert.equal(after.draft, null, JSON.stringify({origin,after}));
    assert.equal(after.count, origin === "cancel" ? 1 : 4, JSON.stringify({origin,after}));
    assert.equal(after.state.changes, 1);
    results.push({mode:"mouse-draft-grid-"+origin, selected:after.count, oneCommit:true, noTrailingEdit:true});
  }
  // Direct, unselected handle press and movement must reorder on its own.
  await evaluate("window.transposeBrowser.reset('switch')"); await settle();
  const beforeDrag = await evaluate("window.transposeBrowser.switchState()");
  const dragPoint = await evaluate("(function(){const root=document.querySelector('[data-structural-source-table-index=\\\"0\\\"]');const start=root.querySelector('[data-structural-row-handle=\\\"1\\\"]');const target=root.querySelector('[data-structural-row-handle=\\\"3\\\"]');const cell=root.querySelector('[data-structural-row=\\\"1\\\"][data-structural-column=\\\"0\\\"]');const a=start.getBoundingClientRect(),b=target.getBoundingClientRect(),c=cell.getBoundingClientRect();return {x:a.left+a.width/2,y:a.top+a.height/2,endY:b.bottom+8,cellX:c.left+c.width/3,cellY:c.top+c.height/2,startRect:{x:a.x,y:a.y,w:a.width,h:a.height},targetRect:{x:b.x,y:b.y,w:b.width,h:b.height}};})()");
  await command("Input.dispatchMouseEvent", { type:"mouseMoved", x:dragPoint.cellX, y:dragPoint.cellY });
  await command("Input.dispatchMouseEvent", { type:"mouseMoved", x:dragPoint.x, y:dragPoint.y });
  const beforeHandlePress = await evaluate("(function(){return {hit:document.elementFromPoint(" + dragPoint.x + "," + dragPoint.y + ")?.outerHTML?.slice(0,220),selected:[...document.querySelectorAll('.structural-tables-row-handle.is-selected')].map(e=>e.dataset.structuralRowHandle)};})()");
  assert.match(beforeHandlePress.hit ?? "", /structural-tables-row-handle/, JSON.stringify({dragPoint,beforeHandlePress}));
  await command("Input.dispatchMouseEvent", { type:"mousePressed", x:dragPoint.x, y:dragPoint.y, button:"left", clickCount:1 });
  await command("Input.dispatchMouseEvent", { type:"mouseMoved", x:dragPoint.x, y:dragPoint.endY, button:"left", buttons:1 });
  await command("Input.dispatchMouseEvent", { type:"mouseReleased", x:dragPoint.x, y:dragPoint.endY, button:"left", clickCount:1 });
  await settle();
  const moved = await evaluate("window.transposeBrowser.switchState()");
  assert.equal(moved.tables[0][1][0], "Next", JSON.stringify({beforeDrag,moved}));
  assert.equal(moved.tables[0][3][0], "Alpha", JSON.stringify({beforeDrag,moved}));
  results.push({ mode:"axis-first-gesture", sourceChanged:moved.source!==beforeDrag.source, rowsMoved:true });
  for (const axis of ["row", "column"]) {
    await evaluate("window.transposeBrowser.reset('switch')"); await settle();
    await click(select("[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='1']"));
    await evaluate("document.querySelector('textarea.structural-tables-cell-editor').select()");
    await command("Input.insertText", { text: "Changed Beta" });
    await click(select("[data-structural-source-table-index='0'] [data-structural-" + axis + "-handle='1']"));
    const axisState = await evaluate("({state:window.transposeBrowser.switchState(),selected:document.querySelectorAll('[data-structural-source-table-index=\"0\"] [aria-selected=\"true\"]').length,focus:document.activeElement?.getAttribute('data-structural-" + axis + "-handle')})");
    assert.equal(axisState.state.draft, null, JSON.stringify({axis,axisState}));
    assert.equal(axisState.state.changes, 1, JSON.stringify({axis,axisState}));
    assert.equal(axisState.focus, "1", JSON.stringify({axis,axisState}));
    assert.equal(axisState.selected, axis === "row" ? 2 : 4, JSON.stringify({axis,axisState}));
    results.push({ mode:"draft-to-" + axis + "-selection", fullAxis:true, liveFocus:true, oneCommit:true });
  }
  await evaluate("window.transposeBrowser.reset('switch')"); await settle();
  const draftDragBaseline = (await evaluate("window.transposeBrowser.switchState()")).source;
  await click(select("[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='0']"));
  await evaluate("document.querySelector('textarea.structural-tables-cell-editor').select()");
  await command("Input.insertText", { text: "Changed Alpha" }); await settle();
  const draftDragPoint = await evaluate("(()=>{const h=document.querySelector('[data-structural-source-table-index=\"0\"] [data-structural-row-handle=\"1\"]'),t=document.querySelector('[data-structural-source-table-index=\"0\"] [data-structural-row-handle=\"3\"]'),a=h.getBoundingClientRect(),b=t.getBoundingClientRect();return {x:a.left+a.width/2,y:a.top+a.height/2,endY:b.bottom+8}})()");
  await command("Input.dispatchMouseEvent", { type:"mousePressed", x:draftDragPoint.x, y:draftDragPoint.y, button:"left", clickCount:1 });
  assert.equal((await evaluate("window.transposeBrowser.switchState()")).changes, 0);
  await command("Input.dispatchMouseEvent", { type:"mouseMoved", x:draftDragPoint.x, y:draftDragPoint.endY, button:"left", buttons:1 });
  await command("Input.dispatchMouseEvent", { type:"mouseReleased", x:draftDragPoint.x, y:draftDragPoint.endY, button:"left", clickCount:1 });
  await settle();
  const draftMoved = await evaluate("({state:window.transposeBrowser.switchState(),focus:document.activeElement?.getAttribute('data-structural-row-handle'),selected:[...document.querySelectorAll('[data-structural-source-table-index=\"0\"] .structural-tables-row-handle.is-selected')].map(x=>x.dataset.structuralRowHandle)})");
  assert.equal(draftMoved.state.tables[0][3][0], "Changed Alpha", JSON.stringify(draftMoved));
  assert.equal(draftMoved.state.draft, null, JSON.stringify(draftMoved));
  assert.equal(draftMoved.state.changes, 1, JSON.stringify(draftMoved));
  assert.equal(draftMoved.focus, "3", JSON.stringify(draftMoved));
  assert.deepEqual(draftMoved.selected, ["3"], JSON.stringify(draftMoved));
  await historyKey();
  assert.equal((await evaluate("window.transposeBrowser.switchState()")).source, draftDragBaseline);
  results.push({ mode:"draft-held-axis-drag", realMouse:true, nativeRelease:true, liveFocus:true, oneUndo:true });
  await evaluate("window.transposeBrowser.reset('switch')"); await settle();
  await click(select("[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='0']"));
  await evaluate("document.querySelector('textarea.structural-tables-cell-editor').select()");
  await command("Input.insertText", { text: "Changed long draft ".repeat(12) });
  await settle();
  await evaluate("document.querySelector('[data-structural-source-table-index=\"0\"] [data-structural-row-handle=\"2\"]').scrollIntoView({block:'nearest'})");
  await settle();
  const axisHit = await evaluate("(()=>{const h=document.querySelector('[data-structural-source-table-index=\"0\"] [data-structural-row-handle=\"2\"]'),r=h.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('[data-structural-row-handle]')?.getAttribute('data-structural-row-handle')})()");
  assert.equal(axisHit, "2", "The long-draft context menu gesture must hit the live row handle");
  await click(select("[data-structural-source-table-index='0'] [data-structural-row-handle='2']"), "right");
  const axisMenu = await evaluate("({state:window.transposeBrowser.switchState(),menus:document.querySelectorAll('#host-menu').length,selected:[...document.querySelectorAll('[data-structural-source-table-index=\"0\"] .structural-tables-row-handle.is-selected')].map(x=>x.dataset.structuralRowHandle)})");
  assert.equal(axisMenu.state.draft, null, JSON.stringify(axisMenu));
  assert.equal(axisMenu.state.changes, 1, JSON.stringify(axisMenu));
  assert.equal(axisMenu.menus, 1, JSON.stringify(axisMenu));
  assert.deepEqual(axisMenu.selected, ["2"], JSON.stringify(axisMenu));
  results.push({ mode:"draft-axis-right-click", realMouse:true, longDraft:true, oneCommit:true, menuVisible:true });
  // The transparent hit target must not acquire the host button's outer focus
  // frame. Real keyboard modality paints its smaller grip, including in HC.
  for (const axis of ["row", "column"]) {
    await evaluate("window.transposeBrowser.reset('switch')"); await settle();
    await evaluate("(()=>{document.body.style.setProperty('--interactive-accent','rgb(124, 58, 237)');document.body.style.setProperty('--text-on-accent','rgb(255, 255, 255)');const s=document.head.appendChild(document.createElement('style'));s.id='handle-focus-theme';s.textContent='button:focus { outline: 3px solid red; box-shadow: 0 0 0 2px red; }';})()");
    const handle = select("[data-structural-source-table-index='0'] [data-structural-" + axis + "-handle='1']");
    const gripState = "(()=>{const b=document.activeElement,i=b.querySelector('.structural-tables-handle-icon'),s=getComputedStyle(b),t=getComputedStyle(i),r=b.getBoundingClientRect(),q=i.getBoundingClientRect();return {axis:b.className,selected:b.classList.contains('is-selected'),keyboard:b.matches(':focus-visible'),target:{width:r.width,height:r.height,background:s.backgroundColor,outline:s.outlineStyle,shadow:s.boxShadow},grip:{width:q.width,height:q.height,background:t.backgroundColor,outline:t.outlineStyle,outlineWidth:t.outlineWidth,outlineOffset:t.outlineOffset,outlineColor:t.outlineColor}}})()";
    await click(handle);
    await evaluate("Promise.all(document.getAnimations().map(a=>a.finished))");
    const mouse = await evaluate(gripState);
    assert.equal(mouse.selected, true, JSON.stringify({axis,mouse}));
    assert.equal(mouse.target.background, "rgba(0, 0, 0, 0)");
    assert.equal(mouse.target.outline, "none"); assert.equal(mouse.target.shadow, "none");
    assert.equal(mouse.grip.background, "rgb(124, 58, 237)");
    if (mouse.keyboard) {
      assert.equal(mouse.grip.outlineOffset, "-2px"); assert.equal(mouse.grip.outlineColor, "rgb(255, 255, 255)");
    } else assert.equal(mouse.grip.outline, "none");
    assert.ok(mouse.target.width > mouse.grip.width && mouse.target.height > mouse.grip.height, JSON.stringify(mouse));
    // A point outside the grip still belongs to the larger transparent button.
    assert.equal(await evaluate("(()=>{const b=" + handle + ",r=b.getBoundingClientRect();return document.elementFromPoint(r.left+1,r.top+1)===b})()"), true);
    await key(axis === "row" ? "ArrowDown" : "ArrowRight", axis === "row" ? "ArrowDown" : "ArrowRight", axis === "row" ? 40 : 39);
    await key("Enter", "Enter", 13);
    const keyboard = await evaluate(gripState);
    assert.equal(keyboard.keyboard, true, JSON.stringify({axis,keyboard}));
    assert.equal(keyboard.selected, true, JSON.stringify({axis,keyboard}));
    assert.equal(keyboard.target.outline, "none"); assert.equal(keyboard.target.shadow, "none");
    assert.equal(keyboard.grip.outline, "solid"); assert.equal(keyboard.grip.outlineWidth, "2px");
    assert.equal(keyboard.grip.outlineOffset, "-2px"); assert.equal(keyboard.grip.outlineColor, "rgb(255, 255, 255)");
    await click(handle);
    const inheritedMouse = await evaluate(gripState);
    assert.equal(inheritedMouse.target.outline, "none"); assert.equal(inheritedMouse.target.shadow, "none");
    if (inheritedMouse.keyboard) assert.equal(inheritedMouse.grip.outlineOffset, "-2px");
    await key(axis === "row" ? "ArrowDown" : "ArrowRight", axis === "row" ? "ArrowDown" : "ArrowRight", axis === "row" ? 40 : 39);
    await key("Enter", "Enter", 13);
    await command("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
    const highContrast = await evaluate(gripState);
    const systemHighlight = await evaluate("(()=>{const p=document.body.appendChild(document.createElement('span'));p.style.outline='2px solid Highlight';const c=getComputedStyle(p).outlineColor;p.remove();return c})()");
    assert.equal(highContrast.target.outline, "none"); assert.equal(highContrast.grip.outline, "solid");
    assert.equal(highContrast.grip.outlineWidth, "2px"); assert.equal(highContrast.grip.outlineColor, systemHighlight);
    await command("Emulation.setEmulatedMedia", { features: [] });
    await evaluate("document.querySelector('#handle-focus-theme').remove()");
    results.push({ mode: "handle-focus-" + axis, transparentHitTarget: true, mouseSelection: true, inheritedPointerFocusInset: true, innerKeyboardFocus: true, forcedColors: true });
  }
  // Real browser geometry for soft-wrapped textarea offsets; no synthetic
  // keydown can prove where Chromium actually drew those visual rows.
  const visual = await evaluate("window.transposeBrowser.visualCaretProbe()");
  assert.equal(visual.midExit, null, JSON.stringify(visual));
  assert.ok(visual.firstUp && visual.lastDown, JSON.stringify(visual));
  assert.ok(Number.isInteger(visual.preserved), JSON.stringify(visual));
  results.push({ mode:"visual-textarea-arrows", internalLineNative:true, firstLastExit:true });
  // Real consecutive clicks cross the rendered-text/textarea DOM boundary.
  for (const [raw, visible, tag] of [["Bright", "Bright", "span"], ["**Bright**", "Bright", "strong"],
    ["*Bright*", "Bright", "em"], ["`symbol`", "symbol", "code"], ["[Display](target)", "Display", "a"]]) {
    const setup = "window.transposeBrowser.setupPointerText(" + [raw, visible, tag].map(JSON.stringify).join(",") + ")";
    await evaluate(setup); await settle();
    const points = await evaluate("(()=>{const n=document.querySelector('[data-structural-row=\"1\"][data-structural-column=\"1\"] .structural-tables-cell-content').firstChild.firstChild;const p=o=>{const r=document.createRange();r.setStart(n,o);r.collapse(true);const b=r.getBoundingClientRect();return{x:b.left,y:b.top+b.height/2}};return{start:p(2),end:p(5)}})()");
    const modifiers = tag === "a" ? 1 : 0;
    await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...points.start });
    for (const clickCount of [1, 2]) {
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...points.start, button: "left", clickCount, modifiers });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.start, button: "left", clickCount, modifiers });
    }
    await settle();
    let state = await evaluate("window.transposeBrowser.result()");
    assert.equal(state.draftValue?.slice(state.draftStart, state.draftEnd), visible, JSON.stringify({raw,state}));
    assert.equal(state.changes, 0);
    await evaluate(setup); await settle();
    await command("Input.dispatchMouseEvent", { type: "mousePressed", ...points.start, button: "left", clickCount: 1, modifiers });
    for (let step = 1; step <= 5; step++) await command("Input.dispatchMouseEvent", {
      type: "mouseMoved", x: points.start.x + (points.end.x - points.start.x) * step / 5,
      y: points.start.y, buttons: 1, modifiers,
    });
    await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.end, button: "left", clickCount: 1, modifiers });
    await settle(); state = await evaluate("window.transposeBrowser.result()");
    assert.equal(state.draftValue?.slice(state.draftStart, state.draftEnd), visible.slice(2,5), JSON.stringify({raw,state}));
    assert.equal(state.changes, 0);
  }
  results.push({ mode: "rendered-text-gestures", actualDoubleClicks: 5, actualTextDrags: 5 });
  await evaluate("window.transposeBrowser.setupPointerText('[Display](target)','Display','a')"); await settle();
  await click(select("[data-structural-row='1'][data-structural-column='1'] a"));
  assert.equal(await evaluate("location.hash"), "#gesture-link");
  assert.equal((await evaluate("window.transposeBrowser.result()")).draft, false);
  results.push({ mode: "normal-link-activation", nativeAnchor: true });

  }
  if (selected("arrows")) {
  const fractional = await evaluate("window.transposeBrowser.fractionalCaretProbe()");
  for (const probe of fractional) {
    assert.ok(probe.first && probe.last, JSON.stringify(probe));
    assert.equal(probe.middle, null, JSON.stringify(probe));
    assert.ok(!Number.isInteger(probe.width), JSON.stringify(probe));
  }
  results.push({ mode: "fractional-textarea-width", cases: fractional.length, firstLastExit: true, internalLineNative: true });
  await evaluate("window.transposeBrowser.reset('switch')"); await settle();
  await click(select("[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='1']"));
  await command("Input.insertText", { text: "First visual line with enough words to wrap across this cell\nLast visual line" });
  await evaluate("(()=>{const e=document.querySelector('textarea');e.setSelectionRange(0,0)})()");
  await key("ArrowDown", "ArrowDown", 40);
  assert.equal((await evaluate("window.transposeBrowser.result()")).changes, 0, "An internal visual line must remain text-local");
  await evaluate("(()=>{const e=document.querySelector('textarea');e.setSelectionRange(e.value.length,e.value.length)})()");
  assert.ok(await evaluate("window.transposeBrowser.currentVisualExit()"), "The scrollable draft must expose measurable outer-line geometry");
  await key("ArrowDown", "ArrowDown", 40);
  const visualNavigation = await evaluate("window.transposeBrowser.switchState()");
  assert.equal(visualNavigation.changes, 1, JSON.stringify(visualNavigation));
  assert.equal(visualNavigation.activeRow, "2"); assert.equal(visualNavigation.activeColumn, "1");
  assert.equal(visualNavigation.draft, "Neighbor");
  results.push({ mode: "multiline-actual-arrows", internalLineNative: true, lastLineCommitsToNext: true });

  for (const alignment of ["left", "center", "right"]) {
    await evaluate("window.transposeBrowser.reset('switch')"); await settle();
    await click(select("[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='1']"));
    await command("Input.insertText", { text: "First line with enough words to wrap in a narrow pane" });
    await evaluate(`(()=>{const e=document.querySelector('textarea'); Object.assign(e.style,{width:'290px',height:'60px',fontSize:'16px',fontFamily:${JSON.stringify(localFont)},textAlign:${JSON.stringify(alignment)}});e.setSelectionRange(0,0)})()`);
    await key("ArrowDown", "ArrowDown", 40);
    const wrapped = await evaluate("window.transposeBrowser.result()");
    assert.equal(wrapped.changes, 0);
    assert.ok(wrapped.draftStart > 0 && wrapped.draftStart < wrapped.draftValue.length, JSON.stringify(wrapped));
    assert.ok(await evaluate("window.transposeBrowser.currentVisualExit()"), "The beginning of the final soft-wrapped line must be an outer visual line: " + alignment);
    await key("ArrowDown", "ArrowDown", 40);
    assert.equal((await evaluate("window.transposeBrowser.switchState()")).activeRow, "2");
  }
  results.push({ mode: "soft-wrapped-line-start-exit", alignments: ["left", "center", "right"] });

  }
  if (selected("history-bidi")) {
  await evaluate("window.transposeBrowser.reset('switch')"); await settle();
  await click(select("[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='0']"));
  await command("Input.insertText", { text: "Changed" });
  await click(select("[data-structural-source-table-index='0'] [data-structural-row='1'][data-structural-column='1']"));
  const historyBefore = await evaluate("window.transposeBrowser.result()");
  assert.equal(historyBefore.draft, true); assert.equal(historyBefore.changes, 1);
  await historyKey();
  const historyUndo = await evaluate("window.transposeBrowser.result()");
  assert.equal(historyUndo.source, historyBefore.initialSource);
  await historyKey(true);
  assert.equal((await evaluate("window.transposeBrowser.result()")).source, historyBefore.source);
  results.push({ mode: "untouched-cell-history", actualUndoRedoKeys: true });
  const bidi = await evaluate("window.transposeBrowser.interfaceBidi()");
  assert.ok(bidi.technicalLefts[0] < bidi.technicalLefts[1], JSON.stringify(bidi));
  assert.ok(bidi.pathLefts.every((left, index) => index === 0 || left > bidi.pathLefts[index - 1]), JSON.stringify(bidi));
  assert.ok(bidi.mappingLefts[0] < bidi.mappingLefts[1], JSON.stringify(bidi));
  assert.equal(bidi.pathText, "ملاحظات/تقارير/ملخص-2026.md"); assert.equal(bidi.codeDirection, "ltr"); assert.equal(bidi.mappingIsolation, "isolate");
  for (const positions of bidi.migrationPathLefts) assert.ok(positions.every((left, index) => index === 0 || left > positions[index - 1]), JSON.stringify(bidi));
  results.push({ mode: "arabic-interface-bidi", technicalExpressions: true, pathOrder: true, mappingOrder: true });
  results.push({ mode: "arabic-migration-preview", initialPathOrder: true, togglePathOrder: true });
  }
  if (selected("alignment")) {
  const alignmentCases = [];
  for (const direction of ["rtl", "ltr"]) {
    for (const alignment of ["default", "left", "center", "right"]) {
      for (const raw of ["North", "مرحبا"]) alignmentCases.push({ direction, alignment, raw, visible: raw, role: "body", geometry: true });
    }
    for (const role of ["column", "row"]) for (const alignment of ["default", "left", "center", "right"]) {
      for (const raw of ["North", "مرحبا"]) alignmentCases.push({ direction, alignment, raw, visible: raw, role, geometry: true });
    }
    for (const raw of ["ABC مرحبا 123", "مرحبا ABC 123"]) alignmentCases.push({ direction, alignment: "default", raw, visible: raw, role: "body", geometry: true });
    for (const raw of ["00123", ""]) alignmentCases.push({ direction, alignment: "default", raw, visible: raw, role: "body", geometry: false, typing: true });
    alignmentCases.push({ direction, alignment: "default", raw: "[123](EnglishTarget) مرحبا", visible: "123 مرحبا", role: "body", geometry: false });
    alignmentCases.push({ direction, alignment: "default", raw: "**مرحبا**", visible: "مرحبا", role: "body", geometry: false });
  }
  for (const input of alignmentCases) {
    await evaluate("window.transposeBrowser.setupAlignment(" + JSON.stringify(input) + ")"); await evaluate("window.transposeBrowser.rendered()"); await settle();
    const before = await evaluate("window.transposeBrowser.alignmentState()");
    await click(select("[data-structural-row='" + before.row + "'][data-structural-column='" + before.column + "']"));
    await evaluate("(function(){const e=document.querySelector('textarea.structural-tables-cell-editor');e.setSelectionRange(e.value.length,e.value.length);})()"); await settle();
    const after = await evaluate("window.transposeBrowser.alignmentState()");
    if (input.geometry) {
      const screenshot = await command("Page.captureScreenshot", { format: "png", clip: after.editor.bounds });
      const ink = await evaluate("(async function(){const image=new Image();image.src='data:image/png;base64,'+" + JSON.stringify(screenshot.data) + ";await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let left=canvas.width,right=-1;for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){const i=(y*canvas.width+x)*4;if(pixels[i]<100&&pixels[i+1]<100&&pixels[i+2]<100){left=Math.min(left,x);right=Math.max(right,x);}}return {left,right};})()");
      assert.ok(ink.right > ink.left, JSON.stringify({ input, ink }));
      const physical = after.editor.bounds.x + (ink.left + ink.right) / 2;
      const rendered = (before.rendered.left + before.rendered.right) / 2;
      assert.ok(Math.abs(physical - rendered) < 4, JSON.stringify({ input, physical, rendered, editor: after.editor, ink }));
    }
    assert.equal(after.editor.dir, "auto"); assert.equal(after.editor.direction, after.editor.nativeDirection, JSON.stringify({ input, after }));
    assert.equal(after.source, before.source); assert.equal(after.changes, 0);
    if (input.typing) for (const text of ["English", "العربية", "ABC\nمرحبا", "مرحبا\nABC"]) {
      await evaluate("document.querySelector('textarea.structural-tables-cell-editor').select()");
      await command("Input.insertText", { text }); await settle();
      const typed = await evaluate("window.transposeBrowser.alignmentState()");
      assert.equal(typed.editor.direction, typed.editor.nativeDirection); assert.equal(typed.source, before.source); assert.equal(typed.changes, 0);
    }
    await key("Escape", "Escape", 27);
    assert.equal((await evaluate("window.transposeBrowser.alignmentState()")).source, before.source);
  }
  results.push({ mode: "cell-draft-alignment", cases: alignmentCases.length, actualTextPixels: true, nativeDirection: true, explicitAlignment: true, sourcePreserved: true });
  }
  await session.result({ status: "passed", browser: path.basename(browser), group: scenario, scenarios: results });
} catch (error) {
  await session?.diagnose(error, `(()=>{const editor=document.querySelector('textarea.structural-tables-cell-editor');const style=editor&&getComputedStyle(editor);return {scenario:${JSON.stringify(scenario)},result:window.transposeBrowser?.result(),editor:editor&&{value:editor.value,selection:[editor.selectionStart,editor.selectionEnd],font:style.fontFamily,lineHeight:style.lineHeight,clientWidth:editor.clientWidth,clientHeight:editor.clientHeight,scrollHeight:editor.scrollHeight,bounds:editor.getBoundingClientRect().toJSON()}}})()`);
  throw error;
} finally {
  await session?.close();
  await new Promise((resolve) => server.close(resolve));
}
