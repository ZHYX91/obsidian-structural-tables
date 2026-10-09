import { describe, expect, it, vi } from "vitest";

type Options = { cls?: string; text?: string; attr?: Record<string, string>; href?: string };

class MockElement {
  readonly children: MockElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (() => void)[]>();
  textContent = "";
  hidden = false;
  disabled = false;
  type = "";
  tabIndex = 0;
  id = "";
  isConnected = true;
  constructor(readonly tag = "div") {}

  empty(): void { this.children.length = 0; }
  addClass(cls: string): void { this.attributes.set("class", cls); }
  toggleClass(cls: string, enabled: boolean): void { if (enabled) this.addClass(cls); }
  createDiv(options?: Options): MockElement { return this.createEl("div", options); }
  createSpan(options?: Options): MockElement { return this.createEl("span", options); }
  createEl(tag: string, options?: Options): MockElement {
    const el = new MockElement(tag);
    el.textContent = options?.text ?? "";
    if (options?.cls) el.addClass(options.cls);
    if (options?.href) el.setAttribute("href", options.href);
    for (const [key, value] of Object.entries(options?.attr ?? {})) el.setAttribute(key, value);
    this.children.push(el);
    return el;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") this.id = value;
  }
  addEventListener(event: string, callback: () => void): void {
    const items = this.listeners.get(event) ?? [];
    items.push(callback);
    this.listeners.set(event, items);
  }
  trigger(event: string): void { for (const callback of this.listeners.get(event) ?? []) callback(); }
  descendants(): MockElement[] { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector: string): MockElement | null {
    return this.descendants().find(element => selector === `#${element.id}`) ?? null;
  }
  scrollIntoView(): void {}
  focus(): void {}
}

class MockInput {
  addOption(): this { return this; }
  setValue(): this { return this; }
  onChange(): this { return this; }
}

vi.mock("obsidian", () => ({
  getLanguage: () => "en",
  App: class {},
  PluginSettingTab: class {
    containerEl = new MockElement();
    hide(): void {}
  },
  Setting: class {
    constructor(_container: MockElement) {}
    setName(): this { return this; }
    setDesc(): this { return this; }
    addDropdown(callback: (input: MockInput) => void): this { callback(new MockInput()); return this; }
    addToggle(callback: (input: MockInput) => void): this { callback(new MockInput()); return this; }
  },
}));

describe("Structural Tables settings export guide", () => {
  it("renders a safe community link in General and does not repeat it on Views", async () => {
    const { StructuralTablesSettingTab } = await import("../src/app/settings-tab");
    const { DEFAULT_SETTINGS } = await import("../src/config/settings");
    const plugin = {
      settings: { ...DEFAULT_SETTINGS, language: "zh-CN" },
      settingsSaveStatus: () => ({ state: "saved", error: null }),
      subscribeSettingsSaveStatus: (listener: (status: unknown) => void) => {
        listener({ state: "saved", error: null });
        return () => undefined;
      },
      updateSettings: async () => undefined,
    };
    const tab = new StructuralTablesSettingTab({} as never, plugin as never);
    tab.display();
    const container = tab.containerEl as unknown as MockElement;
    const elements = container.descendants();
    const link = elements.find(element => element.tag === "a");
    expect(link?.attributes.get("href")).toBe("https://obsidian.md/plugins?id=docwen-assistant");
    expect(link?.attributes.get("target")).toBe("_blank");
    expect(link?.attributes.get("rel")).toBe("noopener noreferrer");
    const note = elements.find(element => element.attributes.get("role") === "note");
    expect(note?.attributes.get("aria-labelledby")).toBe("structural-tables-settings-export-guide-title");
    expect(elements.filter(element => element.tag === "p").map(element => element.textContent).join(" "))
      .toContain("输入扩展");

    const views = elements.find(element => element.attributes.get("role") === "tab"
      && element.textContent === "视图");
    expect(views).toBeDefined();
    views?.trigger("click");
    expect(container.descendants().some(element => element.tag === "a")).toBe(false);
  });
});
