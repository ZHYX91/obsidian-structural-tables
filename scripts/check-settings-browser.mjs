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
    .structural-tables-settings{box-sizing:border-box;width:260px;padding-inline:32px;overflow:auto;font:20px sans-serif}
    button{font:inherit;white-space:nowrap;padding:6px 16px}
    :root{--input-height:32px;--size-4-2:8px;--size-4-3:12px;--background-modifier-border:#999}
    ${css}</style><main class="structural-tables-settings"><section class="setting-item">
    <div class="setting-item-name">Sprache</div><div class="setting-item-description">Anzeigesprache</div>
    <div class="setting-item-control"><select><option>Deutsch</option></select>
    <select class="dropdown is-measuring" aria-hidden="true" tabindex="-1">
      <option>${"Lokalisiertes Tabellenformat ".repeat(5)}</option></select></div></section>
    <div class="structural-tables-settings-panel">
      <div class="setting-item" style="display:flex;align-items:center"><div class="setting-item-info">
        <div class="setting-item-name" style="overflow:hidden">Abwechselnde Zeilenhintergründe</div></div><input type="checkbox"></div>
      <div class="structural-tables-settings-save-status" role="alert"><span>Ordner/UnbeschreibbarerDateipfad</span>
        <button type="button">Tentar novamente</button></div>
    </div></main>
    <section class="structural-tables-settings" style="width:220px">
      <div class="structural-tables-settings-tab-bar">
        <button class="structural-tables-settings-tab-scroll" data-direction="previous" aria-label="Previous tabs"></button>
        <div class="structural-tables-settings-tabs">
          <button class="structural-tables-settings-tab" aria-selected="true">General</button>
          <button class="structural-tables-settings-tab">Export</button>
        </div>
        <button class="structural-tables-settings-tab-scroll" data-direction="next" aria-label="Next tabs"></button>
      </div>
    </section>
    <script>${outputFiles[0].text}</script><script>fields.connectNativeSettingFields(document.querySelector("main"))</script>`;
  await session.navigate("data:text/html;charset=utf-8," + encodeURIComponent(html));
  for (const direction of ["ltr", "rtl"]) {
    const result = await session.evaluate(`(() => {
      const root = document.querySelector("main"); root.dir = ${JSON.stringify(direction)};
      const visible = root.querySelector("select");
      visible.focus();
      const panel = root.querySelector(".structural-tables-settings-panel");
      const overflowing = [...panel.querySelectorAll(".setting-item, .setting-item-name, [role=alert], [role=alert] > *")]
        .some(el => el.scrollWidth > el.clientWidth + 1);
      const text = panel.querySelector("[role=alert] span").getBoundingClientRect();
      const retry = panel.querySelector("button").getBoundingClientRect();
      return { overflowing, wrapped: retry.top >= text.bottom, width: root.clientWidth, scroll: root.scrollWidth, measured: root.querySelector(".is-measuring").offsetWidth,
        label: document.getElementById(visible.getAttribute("aria-labelledby"))?.textContent, focused: visible === document.activeElement };
    })()`);
    assert.ok(result.measured > result.width);
    assert.ok(result.scroll <= result.width + 1);
    assert.equal(result.overflowing, false);
    assert.equal(result.wrapped, true);
    assert.equal(result.label, "Sprache");
    assert.ok(result.focused);
  }

  // Measure the actual paging controls in Chromium with a coarse primary pointer.
  await session.command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  try {
    for (const direction of ["ltr", "rtl"]) {
      const geometry = await session.evaluate(`(() => {
        const row = document.querySelector(".structural-tables-settings-tab-bar");
        row.dir = ${JSON.stringify(direction)};
        return {
          coarse: matchMedia("(pointer: coarse)").matches,
          arrows: Array.from(row.querySelectorAll(".structural-tables-settings-tab-scroll"), button => {
            const rect = button.getBoundingClientRect();
            return { width: rect.width, height: rect.height };
          }),
        };
      })()`);
      assert.equal(geometry.coarse, true, direction + ": browser fixture must expose a coarse pointer");
      assert.equal(geometry.arrows.length, 2, direction + ": both paging arrows must be rendered");
      for (const [index, rect] of geometry.arrows.entries()) {
        assert.ok(rect.width >= 44, direction + ": arrow " + index + " is narrower than 44px");
        assert.ok(rect.height >= 44, direction + ": arrow " + index + " is shorter than 44px");
      }
    }
  } finally {
    await session.command("Emulation.setTouchEmulationEnabled", { enabled: false });
  }
} finally {
  await session.close();
}
