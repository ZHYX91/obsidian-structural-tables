// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";

import { App } from "obsidian";

import { StructuralTablesSettingTab } from "../src/app/settings-tab";
import type { SettingsSaveStatus } from "../src/app/settings-save-coordinator";
import {
  cloneSettings,
  DEFAULT_SETTINGS,
  type InterfaceLanguage,
} from "../src/config/settings";

function createHost(status: SettingsSaveStatus, language: InterfaceLanguage = "en") {
  const retrySettingsSave = vi.fn(async () => undefined);
  return {
    settings: { ...cloneSettings(DEFAULT_SETTINGS), language },
    settingsSaveStatus: () => status,
    subscribeSettingsSaveStatus: (listener: (next: SettingsSaveStatus) => void) => {
      listener(status);
      return () => undefined;
    },
    retrySettingsSave,
  };
}

describe("settings persistence status UI", () => {
  it.each([
    ["en", "incompatible data schema 2"],
    ["zh-CN", "不兼容的数据架构 2"],
  ] as const)("shows the incompatible-schema warning in %s and disables controls", (language, text) => {
    const host = createHost({
      state: "incompatible",
      error: null,
      schemaVersion: "2",
    }, language);
    const tab = new StructuralTablesSettingTab(new App(), host as never);
    const container = document.createElement("div");
    installDomHelpers(container);
    const surface = tab as unknown as {
      renderSaveStatus: (target: HTMLElement) => () => void;
      applyReadOnlyState: (target: HTMLElement) => void;
    };

    const cleanup = surface.renderSaveStatus(container);
    const editable = container.createEl("input");
    surface.applyReadOnlyState(container);
    const row = container.querySelector<HTMLElement>(".structural-tables-settings-save-status");

    expect(row?.hidden).toBe(false);
    expect(row?.getAttribute("role")).toBe("alert");
    expect(row?.textContent).toContain(text);
    expect(row?.querySelector("button")?.hidden).toBe(true);
    expect(editable.disabled).toBe(true);
    cleanup();
  });

  it("keeps a failed save visible and exposes retry", () => {
    const host = createHost({
      state: "pending",
      error: new Error("disk unavailable"),
    });
    const tab = new StructuralTablesSettingTab(new App(), host as never);
    const container = document.createElement("div");
    installDomHelpers(container);
    const cleanup = (tab as unknown as {
      renderSaveStatus: (target: HTMLElement) => () => void;
    }).renderSaveStatus(container);
    const row = container.querySelector<HTMLElement>(".structural-tables-settings-save-status");
    const retry = row?.querySelector<HTMLButtonElement>("button");

    expect(row?.hidden).toBe(false);
    expect(row?.textContent).toContain("Settings were not saved. disk unavailable");
    expect(retry?.hidden).toBe(false);
    expect(retry?.disabled).toBe(false);
    retry?.click();
    expect(host.retrySettingsSave).toHaveBeenCalledOnce();
    cleanup();
  });
});

function installDomHelpers(element: HTMLElement): void {
  const append = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: string | DomElementInfo,
  ): HTMLElementTagNameMap[K] => {
    const child = document.createElement(tag);
    installDomHelpers(child);
    if (typeof options === "string") child.className = options;
    else if (options != null) {
      if (options.cls != null) {
        child.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
      }
      if (typeof options.text === "string") child.textContent = options.text;
      else if (options.text != null) child.append(options.text);
    }
    element.append(child);
    return child;
  };
  element.createDiv = (options) => append("div", options);
  element.createSpan = (options) => append("span", options);
  element.createEl = ((tag, options) => append(tag, options)) as HTMLElement["createEl"];
  element.addClass = (...classes) => element.classList.add(...classes);
}
