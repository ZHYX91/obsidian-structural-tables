// Obsidian's global helper creates a detached node; callers adopt the owner document.
if (typeof document !== "undefined") {
  globalThis.createEl = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => document.createElement(tag);
}
