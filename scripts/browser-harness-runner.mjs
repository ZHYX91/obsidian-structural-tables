import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Shared local fixture transport. No Obsidian host, profile or user browser is used. */
export async function startBrowserHarness({ name, browser = process.argv[2] || process.env.CHROMIUM_PATH, width = 980, height = 740 }) {
  assert.ok(browser, "Provide a Chromium executable as the first argument or set CHROMIUM_PATH.");
  assert.match(name, /^[a-z0-9-]+$/u);
  const extraArgs = JSON.parse(process.env.CHROMIUM_ARGS_JSON || "[]");
  assert.ok(Array.isArray(extraArgs) && extraArgs.every((value) => typeof value === "string"), "CHROMIUM_ARGS_JSON must be a JSON array of Chromium arguments.");
  assert.ok(!extraArgs.some((value) => /^--(?:user-data-dir|remote-debugging-port|remote-debugging-address)(?:=|$)/u.test(value)),
    "The harness owns its isolated profile and loopback debugging endpoint.");
  const outputRoot = path.resolve(process.env.STRUCTURAL_BROWSER_ARTIFACTS || "dist/browser-checks");
  await mkdir(outputRoot, { recursive: true });
  const artifacts = await mkdtemp(path.join(outputRoot, name + "-"));
  const temporary = await mkdtemp(path.join(os.tmpdir(), "structural-browser-"));
  const profile = path.join(temporary, "profile");
  let child;
  let socket;
  let launchError;
  let stderr = "";
  let sequence = 0;
  let metadata = { suite: name, browser, node: process.version, platform: process.platform, extraArgs };
  const pending = new Map();
  const events = [];
  const recordEvent = (event) => { events.push(event); if (events.length > 100) events.shift(); };

  const close = async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      try { await command("Browser.close", {}, 2500); } catch { /* Process exit can close CDP before its response. */ }
    }
    socket?.close();
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Browser session closed")); }
    pending.clear();
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill();
      for (let attempt = 0; attempt < 30 && child.exitCode === null && child.signalCode === null; attempt += 1) await pause(100);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        for (let attempt = 0; attempt < 30 && child.exitCode === null && child.signalCode === null; attempt += 1) await pause(100);
      }
    }
    await writeFile(path.join(artifacts, "chromium-stderr.log"), stderr);
    await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  };

  const command = (method, params = {}, timeout = 30000) => new Promise((resolve, reject) => {
    if (socket?.readyState !== WebSocket.OPEN) { reject(new Error("Chromium CDP connection is not open: " + method)); return; }
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Chromium command timed out: " + method)); }, timeout);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression, timeout) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeout);
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };

  const diagnose = async (error, expression = "null") => {
    const result = { ...metadata, error: error instanceof Error ? error.stack : String(error), events };
    try { result.state = await evaluate(expression, 5000); } catch (failure) { result.stateError = String(failure); }
    try {
      const source = await evaluate("document.documentElement.outerHTML", 5000);
      await writeFile(path.join(artifacts, "page.html"), source);
      const screenshot = await command("Page.captureScreenshot", { format: "png" }, 5000);
      await writeFile(path.join(artifacts, "page.png"), Buffer.from(screenshot.data, "base64"));
    } catch (failure) { result.captureError = String(failure); }
    await writeFile(path.join(artifacts, "failure.json"), JSON.stringify(result, null, 2) + "\n");
    process.stderr.write(`Browser fixture failed; diagnostics: ${artifacts}\n`);
  };

  try {
    const args = ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--user-data-dir=" + profile,
      `--window-size=${width},${height}`, ...extraArgs, "about:blank"];
    child = spawn(browser, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    child.on("error", (error) => { launchError = error; });
    child.stderr.on("data", (data) => { stderr = (stderr + data.toString()).slice(-65536); });
    let port;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (launchError !== undefined) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Chromium exited before opening CDP. " + stderr.slice(-2000));
      try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
      catch { await pause(100); }
    }
    assert.ok(port, "Chromium did not start its isolated debugging endpoint. Check the executable, dependencies and CHROMIUM_ARGS_JSON.");
    const tabs = await (await globalThis.fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
    const tab = tabs.find((candidate) => candidate.type === "page");
    assert.ok(tab, "Chromium did not create a fixture page.");
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chromium WebSocket did not connect")), 5000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", (error) => { clearTimeout(timer); reject(error); }, { once: true });
    });
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data));
      const request = pending.get(response.id);
      if (request !== undefined) {
        clearTimeout(request.timer); pending.delete(response.id);
        if (response.error) request.reject(new Error(JSON.stringify(response.error)));
        else request.resolve(response.result);
      } else if (["Runtime.exceptionThrown", "Runtime.consoleAPICalled", "Log.entryAdded"].includes(response.method)) recordEvent(response);
    });
    socket.addEventListener("close", () => {
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Chromium closed its CDP connection")); }
      pending.clear();
    });
    await Promise.all([command("Runtime.enable"), command("Log.enable"), command("Page.enable")]);
    const version = await command("Browser.getVersion");
    metadata = { ...metadata, version };
    const candidates = process.env.CHROMIUM_LOCAL_FONT ? [process.env.CHROMIUM_LOCAL_FONT]
      : ["Arial", "Liberation Sans", "DejaVu Sans", "Noto Sans", "Open Sans", "Helvetica", "Nimbus Sans"];
    const localFont = await evaluate(`(async()=>{for(const name of ${JSON.stringify(candidates)}){try{const face=new FontFace('StructuralFontProbe','local('+JSON.stringify(name)+')');await face.load();return name;}catch{}}return null;})()`);
    assert.ok(localFont, "No supported local fixture font loaded. Install a known font or set CHROMIUM_LOCAL_FONT to an installed family; a generic fallback cannot test local() source selection. Remove --single-process when using local fonts.");
    metadata = { ...metadata, version, localFont };
    await writeFile(path.join(artifacts, "environment.json"), JSON.stringify(metadata, null, 2) + "\n");
    process.stdout.write(`Browser fixture environment: ${JSON.stringify({ suite: name, version: version.product, localFont, artifacts })}\n`);
    return {
      command, evaluate, diagnose, close, localFont, artifacts, metadata,
      navigate: async (url, ready = "document.readyState === 'complete'") => {
        await command("Page.navigate", { url });
        for (let attempt = 0; attempt < 150; attempt += 1) {
          try { if (await evaluate("location.href === " + JSON.stringify(url) + " && (" + ready + ")", 5000)) return; }
          catch { /* The initial execution context may be replaced during navigation. */ }
          await pause(100);
        }
        throw new Error("Browser fixture did not become ready: " + url);
      },
      result: async (value) => {
        await writeFile(path.join(artifacts, "result.json"), JSON.stringify(value, null, 2) + "\n");
        process.stdout.write(JSON.stringify(value) + "\n");
      },
    };
  } catch (error) {
    await diagnose(error);
    await close();
    throw error;
  }
}
