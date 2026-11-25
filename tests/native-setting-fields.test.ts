// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { connectNativeSettingFields } from "../src/app/native-setting-fields";

const rowMarkup = `<div class="setting-item"><div class="setting-item-info">
  <div class="setting-item-name">状态</div><div class="setting-item-description">设置说明</div></div>
  <div class="setting-item-control"><label class="checkbox-container is-enabled" tabindex="0">
  <input type="checkbox" tabindex="-1"></label></div></div>`;

describe("native setting field accessibility", () => {
  it("names the native control and follows a changed, disabled, or dynamically inserted switch", async () => {
    const root = document.createElement("div");
    root.innerHTML = rowMarkup;
    const stop = connectNativeSettingFields(root);
    const checkbox = root.querySelector("input")!;
    const wrapper = root.querySelector("label")!;
    expect(wrapper.tabIndex).toBe(-1);
    expect(checkbox.tabIndex).toBe(0);
    expect(checkbox.checked).toBe(true);
    expect(root.querySelector("#" + checkbox.getAttribute("aria-labelledby"))?.textContent).toBe("状态");
    expect(root.querySelector("#" + checkbox.getAttribute("aria-describedby"))?.textContent).toBe("设置说明");
    wrapper.classList.remove("is-enabled");
    wrapper.classList.add("is-disabled");
    await vi.waitFor(() => expect(checkbox.disabled).toBe(true));
    expect(checkbox.checked).toBe(false);
    root.insertAdjacentHTML("beforeend", rowMarkup);
    const added = root.querySelectorAll("input")[1]!;
    await vi.waitFor(() => expect(added.checked).toBe(true));
    expect(added.getAttribute("aria-labelledby")).not.toBe(checkbox.getAttribute("aria-labelledby"));
    stop();
    const readOnly = connectNativeSettingFields(root, true);
    expect(added.disabled).toBe(true);
    readOnly();
  });
});
