// Obsidian installs its DOM helpers on Node, including detached fragments.
if (typeof DocumentFragment !== "undefined") {
  DocumentFragment.prototype.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const element = this.ownerDocument.createElement(tag);
    this.appendChild(element);
    return element;
  };
}
