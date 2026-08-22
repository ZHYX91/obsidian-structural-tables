import { App, PluginSettingTab, Setting } from "obsidian";

import { createTranslator } from "../config/i18n";
import type { StructuralTablesPlugin } from "./plugin";

type TabId = "views" | "appearance";

export class StructuralTablesSettingTab extends PluginSettingTab {
  private activeTab: TabId = "views";

  constructor(app: App, private readonly structuralPlugin: StructuralTablesPlugin) {
    super(app, structuralPlugin);
  }

  override display(): void {
    const { containerEl } = this;
    const t = createTranslator(this.structuralPlugin.settings.language);
    containerEl.empty();
    containerEl.addClass("structural-tables-settings");
    new Setting(containerEl).setName(t("settings.title")).setHeading();
    new Setting(containerEl)
      .setName(t("settings.language"))
      .addDropdown((dropdown) => dropdown
        .addOption("auto", t("settings.language.auto"))
        .addOption("en", t("settings.language.en"))
        .addOption("zh-CN", t("settings.language.zh"))
        .setValue(this.structuralPlugin.settings.language)
        .onChange(async (value) => {
          await this.structuralPlugin.updateSettings({ language: value === "zh-CN" ? "zh-CN" : value === "en" ? "en" : "auto" });
          this.display();
        }));
    const tabs = containerEl.createDiv({ cls: "structural-tables-settings-tabs", attr: { role: "tablist" } });
    const panels = containerEl.createDiv({ cls: "structural-tables-settings-panel" });
    const definitions: { id: TabId; label: string }[] = [
      { id: "views", label: t("settings.behavior") },
      { id: "appearance", label: t("settings.appearance") },
    ];
    for (const definition of definitions) {
      const button = tabs.createEl("button", { text: definition.label, cls: "structural-tables-settings-tab" });
      button.type = "button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(this.activeTab === definition.id));
      button.toggleClass("is-active", this.activeTab === definition.id);
      button.addEventListener("click", () => {
        this.activeTab = definition.id;
        this.display();
      });
    }
    if (this.activeTab === "views") {
      new Setting(panels).setName(t("settings.reading")).setDesc(t("settings.reading.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.enableReadingView)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ enableReadingView: value })));
      new Setting(panels).setName(t("settings.live")).setDesc(t("settings.live.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.enableLivePreview)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ enableLivePreview: value })));
      new Setting(panels).setName(t("settings.diagnostics")).setDesc(t("settings.diagnostics.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.showDiagnostics)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ showDiagnostics: value })));
    } else {
      new Setting(panels).setName(t("settings.width")).addDropdown((dropdown) => dropdown
        .addOption("content", t("settings.width.content"))
        .addOption("full", t("settings.width.full"))
        .setValue(this.structuralPlugin.settings.width)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ width: value === "full" ? "full" : "content" })));
      new Setting(panels).setName(t("settings.density")).setDesc(t("settings.density.desc")).addDropdown((dropdown) => dropdown
        .addOption("comfortable", t("settings.density.comfortable"))
        .addOption("compact", t("settings.density.compact"))
        .setValue(this.structuralPlugin.settings.density)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ density: value === "compact" ? "compact" : "comfortable" })));
      new Setting(panels).setName(t("settings.zebra")).setDesc(t("settings.zebra.desc")).addToggle((toggle) => toggle
        .setValue(this.structuralPlugin.settings.zebraRows)
        .onChange(async (value) => this.structuralPlugin.updateSettings({ zebraRows: value })));
    }
  }
}
