import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { startBrowserHarness } from "./browser-harness-runner.mjs";

const css = await readFile("styles.css", "utf8");
const { outputFiles } = await build({
  entryPoints: ["src/app/native-setting-fields.ts"], format: "iife", globalName: "fields", bundle: true, write: false,
});
const session = await startBrowserHarness({ name: "settings" });
try {
  const html = `<!doctype html><meta charset="utf-8"><style>
    .dropdown.is-measuring{position:absolute;visibility:hidden;width:max-content!important;max-width:none!important}
    .structural-tables-settings{width:260px;overflow:auto}
    ${css}</style><main class="structural-tables-settings"><section class="setting-item">
    <div class="setting-item-name">Sprache</div><div class="setting-item-description">Anzeigesprache</div>
    <div class="setting-item-control"><select><option>Deutsch</option></select>
    <select class="dropdown is-measuring" aria-hidden="true" tabindex="-1">
      <option>${"Lokalisiertes Tabellenformat ".repeat(5)}</option></select></div></section></main>
    <script>${outputFiles[0].text}</script><script>fields.connectNativeSettingFields(document.querySelector("main"))</script>`;
  await session.navigate("data:text/html;charset=utf-8," + encodeURIComponent(html));
  for (const direction of ["ltr", "rtl"]) {
    const result = await session.evaluate(`(() => {
      const root = document.querySelector("main"); root.dir = ${JSON.stringify(direction)};
      const visible = root.querySelector("select");
      visible.focus();
      return { width: root.clientWidth, scroll: root.scrollWidth, measured: root.querySelector(".is-measuring").offsetWidth,
        label: document.getElementById(visible.getAttribute("aria-labelledby"))?.textContent, focused: visible === document.activeElement };
    })()`);
    assert.ok(result.measured > result.width);
    assert.ok(result.scroll <= result.width + 1);
    assert.equal(result.label, "Sprache");
    assert.ok(result.focused);
  }
} finally {
  await session.close();
}
