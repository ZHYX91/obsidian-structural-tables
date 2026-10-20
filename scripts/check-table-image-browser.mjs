import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { build } from "esbuild";
import { startBrowserHarness } from "./browser-harness-runner.mjs";

const browser = process.argv[2] || process.env.CHROMIUM_PATH;
let localFont = "sans-serif";
const bundle = await build({ entryPoints: ["tests/browser/table-image-harness.ts"], bundle: true,
  alias: { obsidian: path.resolve("tests/mocks/obsidian.ts") }, write: false, format: "iife", platform: "browser" });
const [source, styles, attachment] = await Promise.all([
  readFile("acceptance/fixtures/Table image export.md", "utf8"), readFile("styles.css", "utf8"), readFile("acceptance/fixtures/table-image-local.svg"),
]);
const contentStyles = String.raw`
.css-content-string::before,.css-content-string-control::before,.css-content-escaped::before,.css-content-escaped-control::before{display:block;width:460px;height:40px;color:#222;font:16px sans-serif}
.css-content-string::before{content:"url()"}
.css-content-string-control::before{content:"u" "rl()"}
.css-content-escaped::before{content:"quote \" url() \\ url('/string-not-resource.svg')"}
.css-content-escaped-control::before{content:"quote \" u" "rl() \\ u" "rl('/string-not-resource.svg')"}
.css-content-image::before,.css-content-escaped-image::before,.css-content-mixed::before,.css-content-missing::before{display:block;width:40px;height:40px}
.css-content-image::before{content:url('/red.svg')}
.css-content-escaped-image::before{content:url('/r\65 d.svg')}
.css-content-mixed::before{content:url('/red.svg') "url()"}
.css-content-missing::before{content:url('/missing.svg') "url()"}
`;
const html = `<html><head><style>body{--background-primary:#fff;--text-normal:#222;--font-text:sans-serif;--font-text-size:16px}table{border-collapse:collapse}td,th{border:1px solid #777;padding:8px}svg{display:inline-block}${styles}
${contentStyles}
.theme-note th{background:red!important}.callout[data-callout=warning] .callout-content td{border:6px solid blue!important}
.decoration::before,.decoration::after,.regular-decoration,.missing-decoration::before{content:"";display:block;width:40px;height:40px}
.decoration::before,.regular-decoration{background-image:url('/red.svg')}.decoration::after{background-image:url('/blue.svg')}
.missing-decoration::before{background-image:url('/missing.svg')}
@font-face{font-family:OnlyLocal;src:local(__FIXTURE_FONT__),url('/missing.woff2') format('woff2')}
@font-face{font-family:OnlyLocalControl;src:local(__FIXTURE_FONT__)}
@font-face{font-family:BrokenFace;src:url('data:font/woff2;base64,AA==') format('woff2')}
@font-face{font-family:SubsetFace;src:local(__FIXTURE_FONT__);unicode-range:U+0000-00FF}
@font-face{font-family:SubsetFace;src:url('/missing-subset.woff2');unicode-range:U+4E00-9FFF}
@font-face{font-family:StretchFace;src:local(__FIXTURE_FONT__);font-stretch:normal}
@font-face{font-family:StretchFace;src:url('/missing-stretch.woff2');font-stretch:condensed}
@font-face{font-family:DuplicateFace;src:url('/missing-duplicate.woff2')}
@font-face{font-family:DuplicateFace;src:local(__FIXTURE_FONT__)}
@media (max-width:1px){@font-face{font-family:ConditionalFace;src:url('/missing-media.woff2')}}
@supports (display:structural-table-impossible){@font-face{font-family:ConditionalFace;src:url('/missing-supports.woff2')}}
@font-face{font-family:ConditionalFace;src:local(__FIXTURE_FONT__)}
.local-font :is(td,th){font-family:OnlyLocal,serif!important}.broken-font :is(td,th){font-family:BrokenFace,serif!important}
.local-control :is(td,th){font-family:OnlyLocalControl,serif!important}.fallback-control :is(td,th){font-family:serif!important}
.subset-font :is(td,th){font-family:SubsetFace,serif!important}.stretch-font :is(td,th){font-family:StretchFace,serif!important;font-stretch:normal}
.duplicate-font :is(td,th){font-family:DuplicateFace,serif!important}.conditional-font :is(td,th){font-family:ConditionalFace,serif!important}
</style></head><body><svg width="0" height="0"><defs><path id="math-glyph" d="M0 20L15 0L30 20Z" fill="#00a000"/></defs></svg><script id="input" type="application/json">${JSON.stringify(source).replaceAll("<", "\\u003c")}</script><pre id="result">pending</pre><script src="/bundle.js"></script></body></html>`;
let missingFont = 0;
const fontRequests = {};
const server = createServer((request, response) => {
  if (request.url === "/attachment.svg") { response.setHeader("Content-Type", "image/svg+xml"); response.end(attachment); }
  else if (request.url === "/red.svg" || request.url === "/blue.svg") {
    response.setHeader("Content-Type", "image/svg+xml");
    response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${request.url === "/red.svg" ? "red" : "blue"}"/></svg>`);
  }
  else if (request.url === "/requests.json") { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ missingFont, fontRequests })); }
  else if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
  else if (request.url === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html.replaceAll("__FIXTURE_FONT__", JSON.stringify(localFont))); }
  else {
    if (request.url === "/missing.woff2") missingFont += 1;
    if (request.url?.endsWith(".woff2")) fontRequests[request.url] = (fontRequests[request.url] ?? 0) + 1;
    response.statusCode = 404; response.end("missing");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let session;
try {
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  session = await startBrowserHarness({ name: "image", browser, width: 800, height: 600 });
  localFont = session.localFont;
  await session.navigate(`http://127.0.0.1:${address.port}/`);
  const value = await session.evaluate(`new Promise((resolve,reject)=>{let attempts=0;const timer=setInterval(()=>{const value=document.getElementById('result')?.textContent;if(value&&value!=='pending'){clearInterval(timer);resolve(value);}else if(++attempts>500){clearInterval(timer);reject(new Error('PNG smoke timed out'));}},50);})`);
  const result = JSON.parse(value);
  await session.result(result);
  assert.equal(result.passed, true, JSON.stringify(result));
} catch (error) {
  await session?.diagnose(error, "({result:document.getElementById('result')?.textContent,fonts:[...document.fonts].map(face=>({family:face.family,status:face.status})),resources:performance.getEntriesByType('resource').map(entry=>entry.name)})");
  throw error;
} finally {
  await session?.close();
  await new Promise((resolve) => server.close(resolve));
}
