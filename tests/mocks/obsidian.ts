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
  private readonly cleanups: Array<() => void> = [];

  load(): void {}
  unload(): void {
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }

  register(callback: () => void): void {
    this.cleanups.push(callback);
  }

  registerEvent<T>(event: T): T {
    return event;
  }

  registerDomEvent(
    element: HTMLElement,
    type: string,
    callback: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    element.addEventListener(type, callback, options);
    this.cleanups.push(() => element.removeEventListener(type, callback, options));
  }
}

export class MarkdownRenderChild extends Component {
  constructor(public containerEl: HTMLElement) {
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
  private readonly hideCallbacks: Array<() => void> = [];

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

  onHide(callback: () => void): void {
    this.hideCallbacks.push(callback);
  }

  hide(): this {
    for (const callback of this.hideCallbacks.splice(0)) callback();
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

export const notices: string[] = [];

export class Notice {
  constructor(message: string) {
    notices.push(message);
  }
}

export class Plugin extends Component {
  app!: App;
  manifest = { version: "0.0.0" };
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

export const activeScopes: Scope[] = [];

interface MockScopeHandler {
  modifiers: string[] | null;
  key: string | null;
  callback: (event: KeyboardEvent) => boolean | void;
}

export class Scope {
  readonly handlers: MockScopeHandler[] = [];
  constructor(readonly parent?: Scope) {}
  register(modifiers: string[] | null, key: string | null, callback: (event: KeyboardEvent) => boolean | void): void {
    this.handlers.push({ modifiers, key, callback });
  }
}

function scopeKey(value: string | null): string | null {
  return value !== null && value.length === 1 ? value.toLowerCase() : value;
}

function scopeModifiersMatch(modifiers: string[] | null, event: KeyboardEvent): boolean {
  if (modifiers === null) return true;
  const wantsMod = modifiers.includes("Mod");
  const wantsCtrl = modifiers.includes("Ctrl");
  const wantsMeta = modifiers.includes("Meta");
  const wantsShift = modifiers.includes("Shift");
  const wantsAlt = modifiers.includes("Alt");
  if (event.shiftKey !== wantsShift || event.altKey !== wantsAlt) return false;
  if (wantsMod) {
    if (event.ctrlKey === event.metaKey) return false;
    if (wantsCtrl && !event.ctrlKey) return false;
    if (wantsMeta && !event.metaKey) return false;
    return true;
  }
  return event.ctrlKey === wantsCtrl && event.metaKey === wantsMeta;
}

/** Simulate Obsidian's active child Scope resolving before inherited parent hotkeys. */
export function dispatchScopeKey(event: KeyboardEvent): boolean {
  let scope = activeScopes[activeScopes.length - 1];
  while (scope !== undefined) {
    const handler = scope.handlers.find((candidate) =>
      scopeKey(candidate.key) === scopeKey(event.key)
      && scopeModifiersMatch(candidate.modifiers, event));
    if (handler !== undefined) {
      const result = handler.callback(event);
      if (result === false && !event.defaultPrevented) event.preventDefault();
      return true;
    }
    scope = scope.parent;
  }
  return false;
}

export class App {
  readonly scope = new Scope();
  readonly keymap = {
    pushScope: (scope: Scope): void => { activeScopes.push(scope); },
    popScope: (scope: Scope): void => {
      const index = activeScopes.indexOf(scope);
      if (index >= 0) activeScopes.splice(index, 1);
    },
  };
}

export class Modal {
  readonly contentEl: HTMLElement;

  constructor(public app: App) {
    this.contentEl = typeof document === "undefined"
      ? {} as HTMLElement
      : document.createElement("div");
  }

  setTitle(_title: string): this { return this; }
  open(): void { document.body.appendChild(this.contentEl); this.onOpen(); }
  close(): void { this.onClose(); this.contentEl.remove(); }
  onOpen(): void {}
  onClose(): void {}
}

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

export class ButtonComponent {
  readonly buttonEl: HTMLButtonElement;

  constructor() {
    this.buttonEl = typeof document === "undefined"
      ? {} as HTMLButtonElement
      : document.createElement("button");
  }

  setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
  setCta(): this { return this; }
  setDisabled(disabled: boolean): this { this.buttonEl.disabled = disabled; return this; }
  onClick(callback: () => void | Promise<void>): this {
    this.buttonEl.addEventListener("click", () => { void callback(); });
    return this;
  }
}

export class Setting {
  constructor(public settingEl: HTMLElement) {}

  addButton(callback: (button: ButtonComponent) => void): this {
    const button = new ButtonComponent();
    this.settingEl.appendChild(button.buttonEl);
    callback(button);
    return this;
  }
}
