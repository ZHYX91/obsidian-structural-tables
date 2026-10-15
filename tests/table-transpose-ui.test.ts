// @vitest-environment happy-dom

import type { App } from "obsidian";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { requestWholeTableTranspose } from "../src/app/table-transpose-modal";
import { createTranslator } from "../src/config/i18n";
import { parseEditableTables } from "../src/core/parser";
import { notices } from "./mocks/obsidian";

const t = createTranslator("en");
const safe = "| Region | Value |\n| --- || --- |\n| North | 1 |";
const gfm = "| Name | Value |\n| --- | --- |\n| North | 1 |";
const mixed = "| Region | Value |\n| :--- || ---: |\n| North | 1 |";
const headerOnly = "| Name | Value |\n| --- | --- |";

function table(source: string) {
  const parsed = parseEditableTables(source).tables[0];
  expect(parsed?.valid).toBe(true);
  return parsed!;
}

function app(): App {
  return { workspace: { containerEl: document.body } } as unknown as App;
}

function clickButton(label: string): void {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  expect(button).toBeDefined();
  button!.click();
}

beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: { text?: string },
  ): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.text !== undefined) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.empty = function empty(): void { this.replaceChildren(); };
});

afterEach(() => {
  document.body.replaceChildren();
  notices.length = 0;
});

describe("whole-table transpose consent and draft safety", () => {
  it("performs a lossless structural transpose without any confirmation modal", () => {
    const apply = vi.fn();
    requestWholeTableTranspose(app(), t, table(safe), apply, document);
    expect(apply).toHaveBeenCalledOnce();
    expect(document.body.querySelector("button")).toBeNull();
  });

  it("warns about a GFM to || dialect transition and cancellation leaves source alone", () => {
    const apply = vi.fn();
    requestWholeTableTranspose(app(), t, table(gfm), apply, document);
    expect(apply).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Structural Tables syntax");
    clickButton("Cancel");
    expect(apply).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Structural Tables syntax");
  });

  it("confirms mixed alignment loss with a specific warning", () => {
    const apply = vi.fn();
    requestWholeTableTranspose(app(), t, table(mixed), apply, document);
    expect(apply).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("different alignments");
    clickButton("Transpose anyway");
    expect(apply).toHaveBeenCalledOnce();
  });

  it("refuses active or newly opened cell drafts, including during confirmation", () => {
    const apply = vi.fn();
    const textarea = document.body.appendChild(document.createElement("textarea"));
    textarea.className = "structural-tables-cell-editor";
    textarea.value = "unfinished";
    requestWholeTableTranspose(app(), t, table(safe), apply, document);
    expect(apply).not.toHaveBeenCalled();
    expect(notices[notices.length - 1]).toContain("active cell draft");
    expect(textarea.value).toBe("unfinished");
    textarea.remove();
    requestWholeTableTranspose(app(), t, table(gfm), apply, document);
    const interrupted = document.body.appendChild(document.createElement("textarea"));
    interrupted.className = "structural-tables-cell-editor";
    clickButton("Transpose anyway");
    expect(apply).not.toHaveBeenCalled();
    expect(interrupted.isConnected).toBe(true);
  });

  it("refuses unrepresentable header-only transposition without a dialog or write", () => {
    const apply = vi.fn();
    requestWholeTableTranspose(app(), t, table(headerOnly), apply, document);
    expect(apply).not.toHaveBeenCalled();
    expect(document.body.querySelector("button")).toBeNull();
    expect(notices[notices.length - 1]).toContain("cannot be represented safely");
  });
});
