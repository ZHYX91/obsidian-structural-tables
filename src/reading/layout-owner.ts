import type { Component } from "obsidian";

const owners = new WeakMap<HTMLElement, Set<HTMLElement>>();

/** Mark only native section wrappers containing an owned table, until teardown. */
export function ownReadingLayout(wrapper: HTMLElement, component: Component): void {
  const parent = wrapper.parentElement;
  // Native sections can still be detached while postprocessors run.
  if (parent === null || !parent.matches(".markdown-preview-sizer > div, div.el-p, div.el-table")) return;
  let tables = owners.get(parent);
  if (tables === undefined) {
    tables = new Set();
    owners.set(parent, tables);
  }
  tables.add(wrapper);
  parent.classList.add("structural-tables-reading-section");
  const owned = tables;
  component.register(() => {
    owned.delete(wrapper);
    if (owned.size === 0) {
      parent.classList.remove("structural-tables-reading-section");
      owners.delete(parent);
    }
  });
}
