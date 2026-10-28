import { Menu, type MenuItem } from "obsidian";

/** New hosts expose native submenus; older hosts retain the same second-level menu. */
export function addTableSubmenu(menu: Menu, title: string, populate: (submenu: Menu) => void): void {
  menu.addItem((item: MenuItem) => {
    item.setSection("structural-tables-cell-table").setTitle(title).setIcon("table");
    const native = item as MenuItem & { setSubmenu?: () => Menu };
    if (typeof native.setSubmenu === "function") populate(native.setSubmenu());
    else item.onClick((event) => {
      const submenu = new Menu();
      populate(submenu);
      const pointer = event as MouseEvent;
      submenu.showAtPosition({ x: pointer.clientX ?? 0, y: pointer.clientY ?? 0 });
    });
  });
}
