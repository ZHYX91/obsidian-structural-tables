let nextFieldId = 0;

/** Associate imperative Obsidian controls with their visible row, including fields inserted later. */
export function connectNativeSettingFields(container: HTMLElement, readOnly = false): () => void {
  const view = container.ownerDocument.defaultView;
  if (!view) return () => undefined;
  container.setAttribute("data-structural-tables-native-fields", "");

  function connect(row: Element): void {
    const name = row.querySelector<HTMLElement>(".setting-item-name");
    if (!name?.textContent?.trim()) return;
    const description = row.querySelector<HTMLElement>(".setting-item-description");
    for (const field of row.querySelectorAll<HTMLElement>(".setting-item-control :is(input, textarea, select):not([aria-hidden=true])")) {
      if (!field.hasAttribute("aria-label") && !field.hasAttribute("aria-labelledby")) {
        name.id ||= "structural-tables-field-" + ++nextFieldId;
        field.setAttribute("aria-labelledby", name.id);
      }
      if (description?.textContent?.trim() && !field.hasAttribute("aria-describedby")) {
        description.id ||= "structural-tables-description-" + ++nextFieldId;
        field.setAttribute("aria-describedby", description.id);
      }
      if (field.matches('input[type="checkbox"]')) {
        const checkbox = field as HTMLInputElement;
        const wrapper = field.closest<HTMLElement>("label.checkbox-container");
        if (wrapper) {
          wrapper.tabIndex = -1;
          field.tabIndex = 0;
          checkbox.checked = wrapper.classList.contains("is-enabled");
          checkbox.disabled = readOnly || wrapper.classList.contains("is-disabled");
        }
      }
    }
  }

  for (const row of container.querySelectorAll(".setting-item")) connect(row);
  const observer = new view.MutationObserver((changes) => {
    const rows = new Set<Element>();
    for (const change of changes) {
      if (change.type === "attributes") {
        const target = change.target as Element;
        if (target.matches("label.checkbox-container")) {
          const row = target.closest(".setting-item");
          if (row) rows.add(row);
        }
      } else {
        for (const node of change.addedNodes) {
          if (node.nodeType !== 1) continue;
          const element = node as Element;
          const row = element.closest(".setting-item");
          if (row) rows.add(row);
          for (const child of element.querySelectorAll(".setting-item")) rows.add(child);
        }
      }
    }
    for (const row of rows) connect(row);
  });
  observer.observe(container, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
