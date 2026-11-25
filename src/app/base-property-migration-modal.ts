import { App, Modal, Setting, type ToggleComponent } from "obsidian";
import { renderBaseWriteActions } from "./base-write-actions";
import { connectNativeSettingFields } from "./native-setting-fields";
import { applyInterfaceLocale } from "../config/i18n";
import type { LocaleId } from "../config/locale";
import { displayPathText } from "../config/interface-bidi";

import type { PreparedBasePropertyMigration } from "./base-property-migration-service";

export interface BasePropertyMigrationLabels {
  language?: LocaleId;
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
  saving: string;
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
    return `- ${displayPathText(candidate.path, labels.language)} — ${actions.join(", ")}`;
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
  private disconnectFields: (() => void) | null = null;
  private closed = false;

  constructor(
    app: App,
    private readonly prepared: PreparedBasePropertyMigration,
    private readonly labels: BasePropertyMigrationLabels,
    private readonly onConfirm: (removeLegacyRecordIds: boolean) => Promise<void>,
    private readonly onFailure: (error: unknown) => void,
    private readonly onClosed: () => void = () => {},
  ) {
    super(app);
  }

  override onOpen(): void {
    applyInterfaceLocale(this.modalEl ?? this.contentEl, this.labels.language);
    let removeLegacyRecordIds = false;
    this.setTitle(this.labels.title);
    this.contentEl.createEl("p", { text: this.labels.description });
    const preview = this.contentEl.createEl("pre", {
      cls: "structural-tables-conversion-preview",
      text: basePropertyMigrationPreviewText(this.prepared, this.labels, removeLegacyRecordIds),
    });
    preview.tabIndex = 0;
    let cleanupToggle!: ToggleComponent;
    new Setting(this.contentEl)
      .setName(this.labels.removeRecordIds)
      .setDesc(this.labels.removeRecordIdsDescription)
      .addToggle((toggle) => {
        cleanupToggle = toggle.setValue(removeLegacyRecordIds).onChange((value) => {
          removeLegacyRecordIds = value;
          preview.textContent = basePropertyMigrationPreviewText(this.prepared, this.labels, removeLegacyRecordIds);
        });
      });
    renderBaseWriteActions(this.contentEl, {
      labels: this.labels,
      canConfirm: () => true,
      setOptionsDisabled: (disabled) => { cleanupToggle.setDisabled(disabled); },
      isClosed: () => this.closed,
      close: () => this.close(),
      confirm: () => this.onConfirm(removeLegacyRecordIds),
      onError: this.onFailure,
    });
    this.disconnectFields = connectNativeSettingFields(this.contentEl);
  }

  override onClose(): void {
    this.disconnectFields?.();
    this.disconnectFields = null;
    this.closed = true;
    this.contentEl.empty();
    this.onClosed();
  }
}
