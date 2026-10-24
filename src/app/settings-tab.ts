import { App, PluginSettingTab, Setting } from "obsidian";

import { applyInterfaceLocale, createTranslator, type Translate } from "../config/i18n";
import { LOCALES, sanitizeInterfaceLanguage } from "../config/locale";
import { moveSettingsTabIndex } from "./settings-tab-navigation";
import type { SettingsSaveStatus } from "./settings-save-coordinator";
import type { StructuralTablesPlugin } from "./plugin";
import type { StructuralTablesSettings } from "../config/settings";
import { TableAppearancePreview } from "./table-appearance-preview";

type TabId = "general" | "views" | "appearance";

// Declarative settings are intentionally absent: non-empty definitions would
// bypass display() and remove the established three-tab settings surface.
export class StructuralTablesSettingTab extends PluginSettingTab {
  private activeTab: TabId = "general";
  private statusCleanup: (() => void) | null = null;
  private appearancePreview: TableAppearancePreview | null = null;

  constructor(app: App, private readonly structuralPlugin: StructuralTablesPlugin) {
    super(app, structuralPlugin);
  }

  override display(): void {
    this.appearancePreview?.destroy();
    this.appearancePreview = null;
    this.statusCleanup?.();
    this.statusCleanup = null;
    const { containerEl } = this;
    const t = createTranslator(this.structuralPlugin.settings.language);
    applyInterfaceLocale(containerEl, t);
    containerEl.empty();
    containerEl.addClass("structural-tables-settings");
    const tabs = containerEl.createDiv({
      cls: "structural-tables-settings-tabs",
      attr: {
        role: "tablist",
        "aria-label": t("settings.title"),
        "aria-orientation": "horizontal",
      },
    });
    const definitions: { id: TabId; label: string }[] = [
      { id: "general", label: t("settings.general") },
      { id: "views", label: t("settings.behavior") },
      { id: "appearance", label: t("settings.appearance") },
    ];
    for (const [index, definition] of definitions.entries()) {
      const button = tabs.createEl("button", { text: definition.label, cls: "structural-tables-settings-tab" });
      button.type = "button";
      button.id = `structural-tables-settings-tab-${definition.id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `structural-tables-settings-panel-${definition.id}`);
      button.setAttribute("aria-selected", String(this.activeTab === definition.id));
      button.tabIndex = this.activeTab === definition.id ? 0 : -1;
      button.toggleClass("is-active", this.activeTab === definition.id);
      button.addEventListener("click", () => {
        this.activeTab = definition.id;
        this.display();
        this.focusAndRevealTab(definition.id);
      });
      button.addEventListener("keydown", (event) => {
        const direction = containerEl.ownerDocument.defaultView
          ?.getComputedStyle(containerEl).direction === "rtl" ? "rtl" : "ltr";
        const targetIndex = moveSettingsTabIndex(index, event.key, definitions.length, direction);
        if (targetIndex === null || targetIndex === index) return;
        const target = definitions[targetIndex];
        if (target === undefined) return;
        event.preventDefault();
        this.activeTab = target.id;
        this.display();
        this.focusAndRevealTab(target.id);
      });
    }
    const panels = containerEl.createDiv({
      cls: "structural-tables-settings-panel",
      attr: {
        id: `structural-tables-settings-panel-${this.activeTab}`,
        role: "tabpanel",
        "aria-labelledby": `structural-tables-settings-tab-${this.activeTab}`,
        tabindex: "0",
      },
    });
    this.statusCleanup = this.renderSaveStatus(panels);
    if (this.activeTab === "general") {
      this.renderHelpLinks(panels, t);
      new Setting(panels)
        .setName(t("settings.language"))
        .setDesc(t("settings.language.desc"))
        .addDropdown((dropdown) => {
          dropdown.addOption("auto", t("settings.language.auto"));
          for (const locale of LOCALES) dropdown.addOption(locale.id, locale.name);
          dropdown.setValue(this.structuralPlugin.settings.language)
            .onChange(async (value) => {
              await this.structuralPlugin.updateSettings({ language: sanitizeInterfaceLanguage(value) });
              this.display();
            });
        });
      new Setting(panels).setName(t("settings.htmlPaste")).setDesc(t("settings.htmlPaste.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.convertHtmlTablePaste)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ convertHtmlTablePaste: value })));
      new Setting(panels).setName(t("settings.warnConflicts")).setDesc(t("settings.warnConflicts.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.warnPluginConflicts)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ warnPluginConflicts: value })));
      this.renderExportGuide(panels, t);
    } else if (this.activeTab === "views") {
      new Setting(panels).setName(t("settings.reading")).setDesc(t("settings.reading.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.enableReadingView)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ enableReadingView: value })));
      new Setting(panels).setName(t("settings.live")).setDesc(t("settings.live.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.enableLivePreview)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ enableLivePreview: value })));
      new Setting(panels).setName(t("settings.takeoverOrdinary")).setDesc(t("settings.takeoverOrdinary.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.takeOverOrdinaryTables)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ takeOverOrdinaryTables: value })));
      new Setting(panels).setName(t("settings.diagnostics")).setDesc(t("settings.diagnostics.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.showDiagnostics)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ showDiagnostics: value })));
    } else {
      new Setting(panels).setName(t("settings.group.style")).setHeading();
      new Setting(panels).setName(t("settings.tableStyle")).setDesc(t("settings.appearance.desc")).addDropdown((dropdown) => dropdown
        .addOption("theme", t("settings.followTheme"))
        .addOption("grid", t("settings.appearance.grid"))
        .addOption("three-line", t("settings.appearance.threeLine"))
        .setValue(this.structuralPlugin.settings.appearance)
        .onChange(async (value) => this.updateAppearance({
          appearance: value === "grid" || value === "three-line" ? value : "theme",
        })));
      new Setting(panels).setName(t("settings.zebra")).setDesc(t("settings.zebra.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.zebraRows)
        .onChange(async (value) => this.updateAppearance({ zebraRows: value })));
      new Setting(panels).setName(t("settings.group.layout")).setHeading();
      new Setting(panels).setName(t("settings.layout")).setDesc(t("settings.layout.desc")).addDropdown((dropdown) => dropdown
        .addOption("theme", t("settings.followTheme"))
        .addOption("content-left", t("settings.layout.contentLeft"))
        .addOption("content-center", t("settings.layout.contentCenter"))
        .addOption("pane", t("settings.layout.pane"))
        .setValue(this.structuralPlugin.settings.layout)
        .onChange(async (value) => this.updateAppearance({
          layout: value === "content-left" || value === "content-center" || value === "pane" ? value : "theme",
        })));
      new Setting(panels).setName(t("settings.density")).setDesc(t("settings.density.desc")).addDropdown((dropdown) => dropdown
        .addOption("theme", t("settings.followTheme"))
        .addOption("comfortable", t("settings.density.comfortable"))
        .addOption("compact", t("settings.density.compact"))
        .setValue(this.structuralPlugin.settings.density)
        .onChange(async (value) => this.updateAppearance({ density: value === "compact" || value === "comfortable" ? value : "theme" })));
      this.appearancePreview = new TableAppearancePreview(this.app, panels, this.structuralPlugin.settings, t);
    }
    this.applyReadOnlyState(panels);
  }

  override hide(): void {
    this.appearancePreview?.destroy();
    this.appearancePreview = null;
    this.statusCleanup?.();
    this.statusCleanup = null;
    super.hide();
  }

  private async updateAppearance(update: Partial<StructuralTablesSettings>): Promise<void> {
    const saved = this.structuralPlugin.updateSettings(update);
    this.appearancePreview?.update(this.structuralPlugin.settings);
    await saved;
  }

  private renderExportGuide(container: HTMLElement, t: Translate): void {
    const guide = container.createDiv({ cls: "structural-tables-settings-export-guide" });
    guide.setAttribute("role", "note");
    guide.setAttribute("aria-labelledby", "structural-tables-settings-export-guide-title");
    const title = guide.createEl("strong", { text: t("settings.exportGuide.title") });
    title.id = "structural-tables-settings-export-guide-title";
    guide.createEl("p", { text: t("settings.exportGuide.body") });
    guide.createEl("p", { text: t("settings.exportGuide.setup") });
    const link = guide.createEl("a", {
      text: t("settings.exportGuide.link"),
      href: "https://obsidian.md/plugins?id=docwen-assistant",
    });
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noopener noreferrer");
  }

  private renderHelpLinks(container: HTMLElement, t: Translate): void {
    const links = container.createDiv({ cls: "structural-tables-settings-help" });
    links.setAttribute("role", "group");
    links.setAttribute("aria-label", t("settings.help"));
    const repository = "https://github.com/ZHYX91/obsidian-structural-tables";
    const locale = t.locale ?? "en";
    const guidePath = locale === "en" ? "README.md" : `docs/i18n/README.${locale}.md`;
    for (const [text, href] of [
      [t("settings.guide"), `${repository}/blob/main/${guidePath}`],
      [t("settings.reportIssue"), `${repository}/issues/new/choose`],
    ] as const) {
      const link = links.createEl("a", { text, href });
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
    }
  }

  private renderSaveStatus(container: HTMLElement): () => void {
    const t = createTranslator(this.structuralPlugin.settings.language);
    const row = container.createDiv({ cls: "structural-tables-settings-save-status" });
    const message = row.createSpan();
    const retry = row.createEl("button", { text: t("settings.save.retry") });
    retry.type = "button";
    retry.addEventListener("click", () => {
      retry.disabled = true;
      void this.structuralPlugin.retrySettingsSave()
        .then(() => {
          // A failed language save updates in-memory UI state before persistence.
          // Once retry succeeds, rebuild the still-open tab from that current
          // language instead of leaving labels captured before the failure.
          if (retry.isConnected) this.display();
        })
        .catch(() => undefined);
    });
    const update = (status: SettingsSaveStatus): void => {
      row.hidden = status.state === "saved";
      const alert = status.state === "pending" || status.state === "incompatible";
      row.setAttribute("role", alert ? "alert" : "status");
      row.setAttribute("aria-live", alert ? "assertive" : "polite");
      if (status.state === "incompatible") {
        message.textContent = t("settings.save.incompatible")
          .replace("{version}", status.schemaVersion);
      } else if (status.state === "saving") {
        message.textContent = t("settings.save.saving");
      } else if (status.state === "pending") {
        const detail = settingsErrorMessage(status.error);
        message.textContent = detail.length === 0
          ? t("settings.save.pending")
          : `${t("settings.save.pending")} ${detail}`;
      } else {
        message.textContent = "";
      }
      retry.hidden = status.state !== "pending";
      retry.disabled = status.state !== "pending";
    };
    const unsubscribe = this.structuralPlugin.subscribeSettingsSaveStatus(update);
    return () => {
      unsubscribe();
      retry.replaceWith(retry.cloneNode(true));
      row.remove();
    };
  }

  private applyReadOnlyState(container: HTMLElement): void {
    if (this.structuralPlugin.settingsSaveStatus().state !== "incompatible") return;
    container.addClass("structural-tables-settings-read-only");
    for (const control of container.querySelectorAll<
      HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >("button, input, select, textarea")) {
      if (control.closest(".structural-tables-settings-save-status") == null) {
        control.disabled = true;
      }
    }
  }

  private focusAndRevealTab(id: TabId): void {
    const button = this.containerEl.querySelector<HTMLElement>(`#structural-tables-settings-tab-${id}`);
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
    button?.focus();
  }
}

function settingsErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 240);
  return typeof error === "string" ? error.slice(0, 240) : "";
}
