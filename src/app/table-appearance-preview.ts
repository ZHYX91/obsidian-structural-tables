import { Component, type App } from "obsidian";
import type { Translate } from "../config/i18n";
import type { StructuralTablesSettings } from "../config/settings";
import { parseEditableTables } from "../core/parser";
import { renderStructuralTable } from "../rendering/table-renderer";

// Fixed local text: no links, embeds, note reads, or editor/write handlers.
const SAMPLE = "| A | B | < |\n| --- || --- | --- |\n| 1 | 20 | 30 |\n| ^ | 40 | 50 |\n| 2 | 60 | 70 |";

export class TableAppearancePreview {
  private readonly component = new Component();
  private readonly wrapper: HTMLElement;

  constructor(app: App, container: HTMLElement, settings: StructuralTablesSettings, t: Translate) {
    const host = container.createDiv({ cls: "structural-tables-appearance-preview" });
    host.createEl("h4", { text: t("settings.preview.title") });
    host.createEl("p", { text: t("settings.preview.description"), cls: "setting-item-description" });
    const table = parseEditableTables(SAMPLE).tables[0]!;
    this.component.load();
    const rendered = renderStructuralTable(app, table, host, "", this.component);
    rendered.createCaption().textContent = t("settings.preview.title");
    this.wrapper = rendered.parentElement!;
    this.update(settings);
  }

  update(settings: StructuralTablesSettings): void {
    this.wrapper.dataset.appearance = settings.appearance;
    this.wrapper.dataset.layout = settings.layout;
    this.wrapper.dataset.density = settings.density;
    this.wrapper.dataset.zebra = String(settings.zebraRows);
  }

  destroy(): void { this.component.unload(); }
}
