import { describe, expect, it } from "vitest";

import {
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
