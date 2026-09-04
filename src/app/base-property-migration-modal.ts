import { App, Modal, Setting } from "obsidian";

import type { PreparedBasePropertyMigration } from "./base-property-migration-service";

export interface BasePropertyMigrationLabels {
  title: string;
  description: string;
  membershipNotes: string;
  promotedBases: string;
  retiredRecordIds: string;
  removeRecordIds: string;
  removeRecordIdsDescription: string;
  cancel: string;
  confirm: string;
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
    const paths = this.prepared.files.map((candidate) => {
      const actions = [
        ...(candidate.migrateMembership ? [this.labels.membershipNotes] : []),
        ...(candidate.legacyBaseCount > 0 ? [`${this.labels.promotedBases}: ${candidate.legacyBaseCount}`] : []),
        ...(candidate.hasLegacyRecordId ? [this.labels.retiredRecordIds] : []),
      ];
      return `- ${candidate.path} — ${actions.join(", ")}`;
    }).join("\n");
    this.contentEl.createEl("pre", {
      cls: "structural-tables-conversion-preview",
      text: [
        `${this.labels.membershipNotes}: ${this.prepared.membershipNoteCount}`,
        `${this.labels.promotedBases}: ${this.prepared.legacyBaseCount}`,
        `${this.labels.retiredRecordIds}: ${this.prepared.legacyRecordIdCount}`,
        "",
        paths,
      ].join("\n"),
    });
    new Setting(this.contentEl)
      .setName(this.labels.removeRecordIds)
      .setDesc(this.labels.removeRecordIdsDescription)
      .addToggle((toggle) => toggle
        .setValue(removeLegacyRecordIds)
        .onChange((value) => { removeLegacyRecordIds = value; }));
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
