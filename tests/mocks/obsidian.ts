import { StateField } from "@codemirror/state";

let mockUuid = 0;
export const activeWindow = {
  crypto: {
    randomUUID: () => {
      mockUuid += 1;
      return `00000000-0000-4000-8000-${String(mockUuid).padStart(12, "0")}`;
    },
  },
} as unknown as Window;

export class Component {
  load(): void {}
  unload(): void {}
}

export class MarkdownRenderChild extends Component {
  constructor(_containerEl: HTMLElement) {
    super();
  }
}

export class MarkdownView {
  containerEl!: HTMLElement;
  editor!: object;
  file: TFile | null = null;
}

export let lastMenu: Menu | null = null;
const menusByEvent = new WeakMap<Event, Menu>();

export class Menu {
  readonly items: MenuItem[] = [];

  static forEvent(event: Event): Menu {
    const menu = menusByEvent.get(event) ?? new Menu();
    menusByEvent.set(event, menu);
    lastMenu = menu;
    return menu;
  }

  addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
}

export class MenuItem {
  title = "";
  callback: (() => void) | null = null;

  setTitle(title: string): this { this.title = title; return this; }
  setIcon(_icon: string | null): this { return this; }
  setSection(_section: string): this { return this; }
  setWarning(_warning: boolean): this { return this; }
  onClick(callback: () => void): this { this.callback = callback; return this; }
}

export class Notice {
  constructor(_message: string) {}
}

export class TAbstractFile {
  name: string;
  parent: TFolder | null = null;

  constructor(public path: string) {
    this.name = path.split("/").pop() ?? "";
  }
}

export class TFile extends TAbstractFile {
  extension: string;
  basename: string;

  constructor(path: string) {
    super(path);
    const dot = this.name.lastIndexOf(".");
    this.extension = dot < 0 ? "" : this.name.slice(dot + 1);
    this.basename = dot < 0 ? this.name : this.name.slice(0, dot);
  }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

export function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/{2,}/gu, "/").replace(/^\/+|\/+$/gu, "");
}

function yamlScalar(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "null";
}

export function stringifyYaml(value: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      lines.push(`${key}:`);
      for (const entry of item) lines.push(`  - ${yamlScalar(entry)}`);
    } else {
      lines.push(`${key}: ${yamlScalar(item)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export const MarkdownRenderer = {
  render: async (): Promise<void> => {},
};

export const editorLivePreviewField = StateField.define<boolean>({
  create: () => true,
  update: (value) => value,
});

export const editorInfoField = StateField.define<{ file?: { path: string }; editor?: object }>({
  create: () => ({ file: { path: "Test.md" }, editor: {} }),
  update: (value) => value,
});

export function getLanguage(): string {
  return "en";
}

export class App {}

export class PluginSettingTab {
  containerEl: HTMLElement;

  constructor(public app: App, public plugin: unknown) {
    this.containerEl = typeof document === "undefined"
      ? {} as HTMLElement
      : document.createElement("div");
  }

  display(): void {}

  hide(): void {}
}

export class Setting {
  constructor(public settingEl: HTMLElement) {}
}
