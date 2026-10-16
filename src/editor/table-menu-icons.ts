import { addIcon, getIcon, removeIcon, type Component } from "obsidian";

const physicalIcons = [
  "arrow-left-to-line", "arrow-right-to-line", "arrow-left", "arrow-right",
  "align-left", "align-right",
] as const;
type PhysicalIcon = typeof physicalIcons[number];
const registered = new Set<PhysicalIcon>();
const ownedId = (icon: PhysicalIcon): string => `structural-tables-physical-${icon}`;

/** Physical left/right must not follow the host's RTL Lucide mirroring rules. */
export function registerTableMenuIcons(component: Component): void {
  for (const name of physicalIcons) {
    const source = getIcon(name);
    if (source === null) continue;
    const svg = source.cloneNode(true) as SVGSVGElement;
    svg.removeAttribute("class");
    // addIcon uses a 100-unit canvas; the nested SVG retains Lucide's viewBox
    // and stroke geometry without its direction-sensitive host CSS classes.
    svg.setAttribute("width", "100");
    svg.setAttribute("height", "100");
    addIcon(ownedId(name), svg.outerHTML);
    registered.add(name);
    component.register(() => {
      removeIcon(ownedId(name));
      registered.delete(name);
    });
  }
}

export function physicalTableMenuIcon(icon: PhysicalIcon): string {
  return registered.has(icon) ? ownedId(icon) : icon;
}
