// Obsidian's global helper creates in the main document; adoption preserves its prototype.
if (typeof document !== "undefined") {
  globalThis.createEl = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => document.createElement(tag);
}
