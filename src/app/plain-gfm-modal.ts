import { App, ButtonComponent, Component, MarkdownRenderer, Modal, Notice } from "obsidian";

import { applyInterfaceLocale, operationNotice, type Translate } from "../config/i18n";
import type { StructuralTable } from "../core/model";
import type { OperationResult } from "../core/operations";
import { planPlainGfmConversion, type PlainGfmConversion, type PlainGfmOrientation, type PlainGfmPlan, type PlainGfmWarning } from "../core/plain-gfm-conversion";

export interface PlainGfmTarget {
  sourcePath: string;
  ownerDocument: Document;
  draftRoot: ParentNode;
  /** Note/table direction is independent from the translated dialog's direction. */
  direction: "ltr" | "rtl";
  /** Reading targets also re-read the original file before each action. */
  isCurrent: () => boolean | Promise<boolean>;
  /** Absent in Reading View. Must revalidate and commit the chosen plan once. */
  replace?: (orientation: PlainGfmOrientation) => OperationResult | null;
}

export type PreviewPlainGfm = (table: StructuralTable, target: PlainGfmTarget) => void;

const warningKeys = {
  "merged-cells": "gfm.warning.mergedCells",
  "multiple-headers": "gfm.warning.multipleHeaders",
  "row-headers": "gfm.warning.rowHeaders",
  "empty-header": "gfm.warning.emptyHeader",
  alignment: "transpose.alignmentWarning",
  "hidden-cells": "gfm.warning.hiddenCells",
} as const satisfies Record<PlainGfmWarning, Parameters<Translate>[0]>;

/** The rendered pane, source pane, clipboard and replacement share one immutable plan. */
export class PlainGfmModal extends Modal {
  private orientation: PlainGfmOrientation;
  private sourceVisible = false;
  private closed = false;
  private busy = false;
  private rendering = false;
  private renderEpoch = 0;
  private renderOwner: Component | null = null;
  private orientationEl: HTMLSelectElement | null = null;
  private renderedEl: HTMLElement | null = null;
  private sourceEl: HTMLElement | null = null;
  private warningsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private modeButtons: HTMLButtonElement[] = [];
  private copyButton: ButtonComponent | null = null;
  private replaceButton: ButtonComponent | null = null;

  constructor(app: App, private readonly t: Translate, private readonly conversion: PlainGfmConversion,
    private readonly target: PlainGfmTarget, private readonly onDispose: () => void = () => undefined) {
    super(app);
    this.orientation = conversion.recommended;
  }

  override onOpen(): void {
    applyInterfaceLocale(this.modalEl ?? this.contentEl, this.t);
    this.contentEl.classList.add("structural-tables-gfm-preview");
    this.setTitle(this.t("modal.convertGfm.title"));
    this.contentEl.createEl("p", { text: this.t("gfm.description") });
    if (this.target.replace === undefined) this.contentEl.createEl("p", { text: this.t("gfm.readOnly") });
    const label = this.contentEl.createEl("label", { cls: "structural-tables-gfm-orientation" });
    label.createEl("span", { text: this.t("gfm.orientation") });
    this.orientationEl = label.createEl("select");
    for (const orientation of ["keep", "transpose"] as const) {
      if (this.conversion[orientation] === null) continue;
      const text = this.t(orientation === "keep" ? "gfm.keep" : "gfm.transpose");
      this.orientationEl.createEl("option", {
        value: orientation,
        text: orientation === this.conversion.recommended ? this.t("gfm.recommended").replace("{option}", text) : text,
      });
    }
    this.orientationEl.value = this.orientation;
    this.orientationEl.addEventListener("change", () => {
      this.orientation = this.orientationEl?.value === "transpose" ? "transpose" : "keep";
      void this.updatePreview();
    });
    if (this.conversion.recommended === "transpose") {
      this.contentEl.createEl("p", { text: this.t("gfm.rowHeaderRecommendation"), cls: "setting-item-description" });
    }
    this.warningsEl = this.contentEl.createEl("ul", { cls: "structural-tables-gfm-warnings" });
    const modes = this.contentEl.createEl("div", { cls: "structural-tables-gfm-modes" });
    for (const source of [false, true]) {
      const button = modes.createEl("button", { text: this.t(source ? "gfm.source" : "gfm.preview") });
      button.type = "button";
      button.addEventListener("click", () => { this.sourceVisible = source; this.showMode(); });
      this.modeButtons.push(button);
    }
    // Suppress this plugin's postprocessor: this pane must display the final
    // ordinary Markdown, including its single header row, without re-acquisition.
    this.renderedEl = this.contentEl.createEl("div", { cls: "structural-tables-container structural-tables-gfm-rendered markdown-rendered" });
    this.renderedEl.dir = this.target.direction;
    this.sourceEl = this.contentEl.createEl("pre", { cls: "structural-tables-conversion-preview" });
    this.sourceEl.setAttribute("dir", "ltr");
    this.sourceEl.tabIndex = 0;
    this.statusEl = this.contentEl.createEl("p", { cls: "structural-tables-gfm-status", attr: { role: "status", "aria-live": "polite" } });
    const actions = this.contentEl.createEl("div", { cls: "structural-tables-gfm-actions" });
    new ButtonComponent(actions).setButtonText(this.t("gfm.close")).onClick(() => this.close());
    this.copyButton = new ButtonComponent(actions).setButtonText(this.t("gfm.copy")).onClick(() => this.perform("copy"));
    if (this.target.replace === undefined) this.copyButton.setCta();
    if (this.target.replace !== undefined) this.replaceButton = new ButtonComponent(actions)
      .setButtonText(this.t("modal.convertGfm.replace")).setCta().onClick(() => this.perform("replace"));
    this.showMode();
    void this.updatePreview();
  }

  private plan(): PlainGfmPlan { return this.conversion[this.orientation] ?? this.conversion.keep; }

  private showMode(): void {
    if (this.renderedEl !== null) this.renderedEl.hidden = this.sourceVisible;
    if (this.sourceEl !== null) this.sourceEl.hidden = !this.sourceVisible;
    this.modeButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(this.sourceVisible === (index === 1))));
  }

  private updateButtons(): void {
    const disabled = this.closed || this.busy || this.rendering;
    this.copyButton?.setDisabled(disabled);
    this.replaceButton?.setDisabled(disabled || !this.plan().canReplace);
    if (this.orientationEl !== null) this.orientationEl.disabled = this.busy;
  }

  private async updatePreview(): Promise<void> {
    const epoch = ++this.renderEpoch;
    const plan = this.plan();
    this.renderOwner?.unload();
    this.renderOwner = null;
    if (this.sourceEl !== null) this.sourceEl.textContent = plan.source;
    this.warningsEl?.replaceChildren();
    for (const warning of plan.warnings) this.warningsEl?.createEl("li", { text: this.t(warningKeys[warning]) });
    this.renderedEl?.replaceChildren();
    this.rendering = true;
    this.updateButtons();
    if (this.statusEl !== null) this.statusEl.textContent = this.t("gfm.rendering");
    const owner = new Component();
    const staging = this.contentEl.ownerDocument.createElement("div");
    staging.className = "structural-tables-container markdown-rendered";
    owner.load();
    this.renderOwner = owner;
    try {
      await MarkdownRenderer.render(this.app, plan.source, staging, this.target.sourcePath, owner);
      if (this.closed || epoch !== this.renderEpoch) { owner.unload(); return; }
      this.renderedEl?.append(staging);
      if (this.statusEl !== null) this.statusEl.textContent = "";
    } catch {
      owner.unload();
      if (this.closed || epoch !== this.renderEpoch) return;
      if (this.statusEl !== null) this.statusEl.textContent = this.t("gfm.renderFailed");
      this.sourceVisible = true;
      this.showMode();
    } finally {
      if (!this.closed && epoch === this.renderEpoch) { this.rendering = false; this.updateButtons(); }
    }
  }

  private async perform(action: "copy" | "replace"): Promise<void> {
    if (this.closed || this.busy || this.rendering) return;
    this.busy = true;
    this.updateButtons();
    const plan = this.plan();
    try {
      if (!await this.target.isCurrent() || this.closed) {
        if (!this.closed) new Notice(this.t("notice.staleTable"));
        return;
      }
      if (this.target.draftRoot.querySelector("textarea.structural-tables-cell-editor") !== null) {
        new Notice(this.t("gfm.unsavedDraft"));
        return;
      }
      if (action === "copy") {
        const clipboard = this.target.ownerDocument.defaultView?.navigator.clipboard;
        if (clipboard === undefined) throw new Error("Clipboard unavailable");
        await clipboard.writeText(plan.source);
        if (!this.closed) new Notice(this.t("notice.copied").replace("{format}", "GFM"));
      } else if (plan.canReplace && this.target.replace !== undefined) {
        const replace = this.target.replace;
        // Closing first lets the verified editor regain focus for Undo.
        this.close();
        const result = replace(plan.orientation);
        new Notice(result === null ? this.t("notice.staleTable") : operationNotice(this.t, result.code));
      }
    } catch {
      new Notice(this.t(action === "copy" ? "notice.clipboardFailed" : "gfm.replaceFailed"));
    } finally {
      this.busy = false;
      if (!this.closed) this.updateButtons();
    }
  }

  override onClose(): void {
    this.closed = true;
    this.renderEpoch += 1;
    this.renderOwner?.unload();
    this.renderOwner = null;
    this.contentEl.empty();
    this.onDispose();
  }
}

export class PlainGfmConversionService {
  private active = true;
  private readonly modals = new Set<PlainGfmModal>();
  constructor(private readonly app: App, private readonly translator: () => Translate) {}

  readonly open: PreviewPlainGfm = (table, target) => {
    const t = this.translator();
    void (async () => {
      if (!this.active) return;
      if (!await target.isCurrent()) { if (this.active) new Notice(t("notice.staleTable")); return; }
      if (!this.active) return;
      if (target.draftRoot.querySelector("textarea.structural-tables-cell-editor") !== null) { new Notice(t("gfm.unsavedDraft")); return; }
      const conversion = planPlainGfmConversion(table);
      if (conversion === null) { new Notice(t("operation.tableInvalid")); return; }
      const modal = new PlainGfmModal(this.app, t, conversion, target, () => this.modals.delete(modal));
      this.modals.add(modal);
      modal.open();
    })().catch(() => { if (this.active) new Notice(t("notice.staleTable")); });
  };

  close(): void {
    this.active = false;
    for (const modal of [...this.modals]) modal.close();
  }
}
