// @vitest-environment happy-dom

import { App } from "obsidian";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { BasePromotionModal, type BasePromotionLabels } from "../src/app/base-promotion-modal";
import type { BasePromotionContentAcceptance, PreparedBasePromotion } from "../src/app/base-promotion-service";
import { createTranslator } from "../src/config/i18n";

interface ObsidianElementOptions {
  cls?: string;
  text?: string;
}

beforeAll(() => {
  HTMLElement.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: ObsidianElementOptions,
  ): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    if (options?.cls !== undefined) element.className = options.cls;
    if (options?.text !== undefined) element.textContent = options.text;
    this.appendChild(element);
    return element;
  };
  HTMLElement.prototype.createDiv = function createDiv(options?: ObsidianElementOptions): HTMLDivElement {
    return this.createEl("div", options);
  };
  HTMLElement.prototype.createSpan = function createSpan(options?: ObsidianElementOptions): HTMLSpanElement {
    return this.createEl("span", options);
  };
  HTMLElement.prototype.empty = function empty(): void {
    this.replaceChildren();
  };
});

const labels: BasePromotionLabels = {
  title: "Upgrade",
  description: "Description",
  target: "Target {path}",
  records: "Records {count}",
  columns: "Columns",
  warning: (warning) => warning,
  blockingIssues: "Blockers",
  blocker: (blocker) => blocker.code,
  contentDifferences: "Content differences",
  contentSummary: "{sources} sources / {targets} targets",
  contentSource: "row {row} column {column} line {line}",
  contentKind: (kind) => kind,
  contentHeaderTarget: "header {column} {key} {displayName}",
  contentRecordTarget: "record {record} {path} {key}",
  recordPreviews: "Generated records",
  acceptContentDifferences: "Accept differences",
  cancel: "Cancel",
  confirm: "Confirm",
};

function prepared(blockers = false): PreparedBasePromotion {
  const dangerous = '<img src=x onerror="window.__unsafe=1"><br>Second';
  return {
    plan: {
      tableId: "stb_preview",
      columns: [{ sourceColumn: 0, key: "Title<br>Line", displayName: "Title<br>Line" }],
      records: [{ fileStem: "Record", values: { "Title<br>Line": dangerous } }],
      warnings: [],
      blockers: blockers ? [{ code: "merged-data-cell", row: 2, column: 1, rowSpan: 1, columnSpan: 2 }] : [],
      contentReport: {
        sourceCellCount: 1,
        targetCount: 2,
        requiresAcceptance: true,
        notices: [{
          row: 1,
          column: 1,
          sourceLine: 4,
          source: dangerous,
          occurrences: [{ kind: "visual-break", source: "<br>", from: 36, to: 40 }],
          targets: [
            { type: "header", sourceColumn: 0, key: "Title<br>Line", displayName: "Title<br>Line" },
            { type: "record", recordIndex: 0, key: "Title<br>Line", value: dangerous },
          ],
        }],
      },
    },
    sourceFilePath: "Source.md",
    directoryPath: "_structural-table-records/stb_preview",
    manifestPath: "_structural-table-records/stb_preview/_promotion.json",
    replacementSource: "```base\nviews: []\n```",
    records: [{
      path: "_structural-table-records/stb_preview/Record.md",
      record: { fileStem: "Record", values: { "Title<br>Line": dangerous } },
      content: `---\nTitle<br>Line: "${dangerous.replace(/"/gu, '\\"')}"\n---\n`,
    }],
    manifestContent: "{}\n",
  };
}

function button(modal: BasePromotionModal, text: string): HTMLButtonElement {
  const match = [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent === text);
  if (match === undefined) throw new Error(`Missing button: ${text}`);
  return match;
}

describe("BasePromotionModal content acceptance", () => {
  it.each([["عنوان عربي", "latinKey"], ["Latin title", "مفتاح"], ["عنوان", "مفتاح"]])("keeps the %s to %s mapping and Arabic paths isolated without modifying prepared bytes", (displayName, key) => {
    const value = prepared(); value.plan.columns[0] = { sourceColumn: 0, displayName: displayName!, key: key! };
    value.directoryPath = "ملاحظات/تقارير/ملخص-2026"; value.records[0]!.path = `${value.directoryPath}/سجل-ABC.md`;
    const original = JSON.stringify(value); const t = createTranslator("ar");
    const modal = new BasePromotionModal(new App(), value, { ...labels, language: "ar", target: t("modal.promoteBase.target"),
      contentHeaderTarget: t("modal.promoteBase.contentHeaderTarget"), contentRecordTarget: t("modal.promoteBase.contentRecordTarget") }, vi.fn(async () => {}), vi.fn());
    modal.open();
    const mapping = modal.contentEl.querySelector<HTMLElement>(".structural-tables-promotion-mapping li")!;
    expect(mapping.dir).toBe("ltr"); expect(mapping.classList.contains("structural-tables-bidi-isolate")).toBe(true);
    expect([...mapping.querySelectorAll("bdi")].map((node) => [node.dir, node.textContent])).toEqual([["auto", displayName], ["auto", key]]);
    const path = modal.contentEl.querySelector<HTMLElement>(".structural-tables-promotion-record-previews summary > bdi")!;
    expect(path.dir).toBe("ltr"); expect(path.textContent).toBe(value.records[0]!.path);
    expect([...path.querySelectorAll("bdi")].map((node) => node.textContent)).toEqual(["ملاحظات", "تقارير", "ملخص-2026", "سجل-ABC.md"]);
    expect(modal.contentEl.querySelector(".structural-tables-conversion-preview")!.textContent).toBe(value.replacementSource);
    expect(JSON.stringify(value)).toBe(original); expect(JSON.stringify(value)).not.toMatch(/\p{Bidi_Control}/u); modal.close();
  });
  it("renders source and generated files as text, requires explicit acceptance, and cancels without confirmation", () => {
    const onConfirm = vi.fn(async () => undefined);
    const modal = new BasePromotionModal(new App(), prepared(), labels, onConfirm, vi.fn());
    modal.open();

    expect(modal.contentEl.textContent).toContain('<img src=x onerror="window.__unsafe=1"><br>Second');
    expect(modal.contentEl.querySelector("img")).toBeNull();
    expect(modal.contentEl.querySelector(".structural-tables-promotion-record-previews pre")?.textContent)
      .toContain("Title<br>Line");
    const confirm = button(modal, "Confirm");
    expect(confirm.disabled).toBe(true);

    button(modal, "Cancel").click();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(modal.contentEl.isConnected).toBe(false);
  });

  it("resets acceptance for each modal and submits only once while confirmation is pending", async () => {
    let finish: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    let received: BasePromotionContentAcceptance | undefined;
    const onConfirm = vi.fn((acceptance?: BasePromotionContentAcceptance) => {
      received = acceptance;
      return pending;
    });
    const modal = new BasePromotionModal(new App(), prepared(), labels, onConfirm, vi.fn());
    modal.open();

    const checkbox = modal.contentEl.querySelector<HTMLInputElement>(".structural-tables-promotion-acceptance input")!;
    const confirm = button(modal, "Confirm");
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(confirm.disabled).toBe(false);

    confirm.click();
    confirm.click();
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(received?.prepared).toBeDefined();
    expect(confirm.disabled).toBe(true);
    finish?.();
    await pending;
    await Promise.resolve();
    expect(modal.contentEl.isConnected).toBe(false);

    const reopened = new BasePromotionModal(new App(), prepared(), labels, vi.fn(async () => undefined), vi.fn());
    reopened.open();
    expect(reopened.contentEl.querySelector<HTMLInputElement>(".structural-tables-promotion-acceptance input")?.checked)
      .toBe(false);
    expect(button(reopened, "Confirm").disabled).toBe(true);
    reopened.close();
  });

  it("re-enables a failed accepted confirmation but never bypasses blockers", async () => {
    const failed = new BasePromotionModal(
      new App(),
      prepared(),
      labels,
      vi.fn(async () => { throw new Error("disk full"); }),
      vi.fn(),
    );
    failed.open();
    const checkbox = failed.contentEl.querySelector<HTMLInputElement>(".structural-tables-promotion-acceptance input")!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    const failedConfirm = button(failed, "Confirm");
    failedConfirm.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(failedConfirm.disabled).toBe(false);
    failed.close();

    const blocked = new BasePromotionModal(new App(), prepared(true), labels, vi.fn(async () => undefined), vi.fn());
    blocked.open();
    const blockedCheckbox = blocked.contentEl.querySelector<HTMLInputElement>(".structural-tables-promotion-acceptance input")!;
    blockedCheckbox.checked = true;
    blockedCheckbox.dispatchEvent(new Event("change"));
    expect(button(blocked, "Confirm").disabled).toBe(true);
    blocked.close();
  });
});
