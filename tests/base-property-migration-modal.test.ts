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
      legacyRecordIdValue: "str_alice",
    }],
  };
}

describe("Base property migration preview", () => {
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
