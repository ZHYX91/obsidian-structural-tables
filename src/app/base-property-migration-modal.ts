import { App, Modal, Setting } from "obsidian";

import type { PreparedBasePropertyMigration } from "./base-property-migration-service";

export interface BasePropertyMigrationLabels {
  title: string;
  description: string;
  membershipNotes: string;
  promotedBases: string;
  retiredRecordIdCandidates: string;
  retiredRecordIds: string;
  removeRecordIds: string;
  removeRecordIdsDescription: string;
  cancel: string;
  confirm: string;
}

export function basePropertyMigrationPreviewText(
  prepared: PreparedBasePropertyMigration,
  labels: BasePropertyMigrationLabels,
  removeLegacyRecordIds: boolean,
): string {
  const paths = prepared.files.map((candidate) => {
    const actions = [
      ...(candidate.migrateMembership ? [labels.membershipNotes] : []),
      ...(candidate.legacyBaseCount > 0 ? [`${labels.promotedBases}: ${candidate.legacyBaseCount}`] : []),
      ...(candidate.hasLegacyRecordId
        ? [removeLegacyRecordIds ? labels.retiredRecordIds : labels.retiredRecordIdCandidates]
        : []),
    ];
    return `- ${candidate.path} — ${actions.join(", ")}`;
  }).join("\n");
  return [
    `${labels.membershipNotes}: ${prepared.membershipNoteCount}`,
    `${labels.promotedBases}: ${prepared.legacyBaseCount}`,
    `${labels.retiredRecordIdCandidates}: ${prepared.legacyRecordIdCount}`,
    `${labels.retiredRecordIds}: ${removeLegacyRecordIds ? prepared.legacyRecordIdCount : 0}`,
    "",
    paths,
  ].join("\n");
}

export class BasePropertyMigrationModal extends Modal {
  constructor(
    app: App,
    private readonly prepared: PreparedBasePropertyMigration,
    private readonly labels: BasePropertyMigrationLabels,
    private readonly onConfirm: (removeLegacyRecordIds: boolean) => Promise<void>,
    private readonly onFailure: (error: unknown) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    let removeLegacyRecordIds = false;
    this.setTitle(this.labels.title);
    this.contentEl.createEl("p", { text: this.labels.description });
    const preview = this.contentEl.createEl("pre", {
      cls: "structural-tables-conversion-preview",
      text: basePropertyMigrationPreviewText(this.prepared, this.labels, removeLegacyRecordIds),
    });
    new Setting(this.contentEl)
      .setName(this.labels.removeRecordIds)
      .setDesc(this.labels.removeRecordIdsDescription)
      .addToggle((toggle) => toggle
        .setValue(removeLegacyRecordIds)
        .onChange((value) => {
          removeLegacyRecordIds = value;
          preview.textContent = basePropertyMigrationPreviewText(this.prepared, this.labels, removeLegacyRecordIds);
        }));
    new Setting(this.contentEl)
      .addButton((button) => button
        .setButtonText(this.labels.cancel)
        .onClick(() => this.close()))
      .addButton((button) => button
        .setCta()
        .setButtonText(this.labels.confirm)
        .onClick(() => {
          button.setDisabled(true);
          void this.onConfirm(removeLegacyRecordIds)
            .then(() => this.close())
            .catch((error: unknown) => {
              button.setDisabled(false);
              this.onFailure(error);
            });
        }));
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
