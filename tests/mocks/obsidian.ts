import { StateField } from "@codemirror/state";

export class Component {
  load(): void {}
  unload(): void {}
}

export class MarkdownRenderChild extends Component {
  constructor(_containerEl: HTMLElement) {
    super();
  }
}

export let lastMenu: Menu | null = null;

export class Menu {
  readonly items: MenuItem[] = [];

  static forEvent(): Menu {
    const menu = new Menu();
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

export const MarkdownRenderer = {
  render: async (): Promise<void> => {},
};

export const editorLivePreviewField = StateField.define<boolean>({
  create: () => true,
  update: (value) => value,
});

export const editorInfoField = StateField.define<{ file?: { path: string } }>({
  create: () => ({ file: { path: "Test.md" } }),
  update: (value) => value,
});

export function getLanguage(): string {
  return "en";
}
