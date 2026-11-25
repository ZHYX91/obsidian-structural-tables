// @vitest-environment happy-dom
import { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import {
  BasePropertyMigrationModal,
  basePropertyMigrationPreviewText,
  type BasePropertyMigrationLabels,
} from "../src/app/base-property-migration-modal";
import type { PreparedBasePropertyMigration } from "../src/app/base-property-migration-service";

const labels: BasePropertyMigrationLabels = {
  title: "Title",
  description: "Description",
  membershipNotes: "Membership notes",
  promotedBases: "Promoted Base blocks",
  retiredRecordIdCandidates: "Retired record ID candidates",
  retiredRecordIds: "Record IDs selected for removal",
  removeRecordIds: "Remove",
  removeRecordIdsDescription: "Remove description",
  cancel: "Cancel",
  confirm: "Confirm",
  saving: "Saving…",
};

function prepared(): PreparedBasePropertyMigration {
  return {
    membershipNoteCount: 1,
    legacyBaseCount: 2,
    legacyRecordIdCount: 1,
    files: [{
      file: {} as never,
      path: "Records/Alice.md",
      originalSource: "",
      migrateMembership: true,
      legacyBaseCount: 2,
      hasLegacyRecordId: true,
      membershipIds: ["stb_people"],
      currentMembershipPresent: false,
      currentMembershipValue: undefined,
      legacyMembershipValue: ["stb_people"],
      legacyRecordIdValue: "str_alice",
    }],
  };
}

describe("Base property migration preview", () => {
  it("keeps the confirmed cleanup choice while saving and restores the options on failure", async () => {
    const fail = new Error("disk full");
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, rejectWrite) => { reject = rejectWrite; });
    const save = vi.fn(() => pending);
    const report = vi.fn();
    const modal = new BasePropertyMigrationModal(new App(), prepared(), labels, save, report);
    modal.contentEl.createEl = (tag, options) => {
      const el = document.createElement(tag);
      if (typeof options === "object" && typeof options.text === "string") el.textContent = options.text;
      modal.contentEl.append(el);
      return el;
    };
    modal.contentEl.empty = () => modal.contentEl.replaceChildren();
    modal.open();
    const cleanup = modal.contentEl.querySelector("input")!;
    const [cancel, confirm] = Array.from(modal.contentEl.querySelectorAll("button"));
    cleanup.click();
    const acceptedPreview = modal.contentEl.querySelector("pre")!.textContent;
    confirm!.click();
    cleanup.click(); cancel!.click(); confirm!.click();
    expect(save.mock.calls).toEqual([[true]]);
    expect(modal.contentEl.isConnected).toBe(true);
    expect(modal.contentEl.querySelector("pre")!.textContent).toBe(acceptedPreview);
    expect(cleanup.checked && cleanup.disabled).toBe(true);
    expect(confirm!.textContent).toBe("Saving…");
    reject(fail);
    await pending.catch(() => {});
    expect(report).toHaveBeenCalledWith(fail);
    expect(cleanup.checked).toBe(true);
    expect(cleanup.disabled || cancel!.disabled || confirm!.disabled).toBe(false);
    expect(confirm!.textContent).toBe("Confirm");
    cancel!.click();
    expect(modal.contentEl.isConnected).toBe(false);
  });

  it.each([false, true])("isolates Arabic path components in the real preview without changing migration data (cleanup=%s)", (cleanup) => {
    const value = prepared(); value.files[0]!.path = "ملاحظات/تقارير/ملخص-2026.md";
    const original = JSON.stringify(value);
    const preview = basePropertyMigrationPreviewText(value, { ...labels, language: "ar" }, cleanup);
    expect(preview).toContain("- \u2066\u2066ملاحظات\u2069/\u2066تقارير\u2069/\u2066ملخص-2026.md\u2069\u2069 — ");
    expect(preview.replace(/\p{Bidi_Control}/gu, "")).toContain(`- ${value.files[0]!.path} — `);
    expect(JSON.stringify(value)).toBe(original); expect(JSON.stringify(value)).not.toMatch(/\p{Bidi_Control}/u);
  });

  it("shows cleanup as an optional candidate while the toggle is off", () => {
    const preview = basePropertyMigrationPreviewText(prepared(), labels, false);

    expect(preview).toContain("Retired record ID candidates: 1");
    expect(preview).toContain("Record IDs selected for removal: 0");
    expect(preview).toContain("Records/Alice.md — Membership notes, Promoted Base blocks: 2, Retired record ID candidates");
  });

  it("updates the selected cleanup count and per-file action when enabled", () => {
    const preview = basePropertyMigrationPreviewText(prepared(), labels, true);

    expect(preview).toContain("Record IDs selected for removal: 1");
    expect(preview).toContain("Records/Alice.md — Membership notes, Promoted Base blocks: 2, Record IDs selected for removal");
  });
});
