import type { App, Menu } from "obsidian";

interface MenuRealm { current: TableMenuSession | null; generation: number }
const realms = new WeakMap<App, WeakMap<Document, MenuRealm>>();

/** Owns only menus created by an interactive table, never shared host menus. */
export class TableMenuOwner {
  private current: TableMenuSession | null = null;
  private disposed = false;
  private readonly realm: MenuRealm;

  constructor(app: App, private readonly document: Document) {
    let documents = realms.get(app);
    if (documents === undefined) { documents = new WeakMap(); realms.set(app, documents); }
    let realm = documents.get(document);
    if (realm === undefined) { realm = { current: null, generation: 0 }; documents.set(document, realm); }
    this.realm = realm;
  }

  open(menu: Menu): TableMenuSession | null {
    if (this.disposed) return null;
    const previous = this.realm.current;
    const session = new TableMenuSession(menu, this.document, this.realm, ++this.realm.generation);
    this.realm.current = session;
    this.current?.close();
    previous?.close();
    this.current = session;
    return session;
  }

  dismiss(): void { this.current?.close(); this.current = null; }
  dispose(): void { this.disposed = true; this.dismiss(); }
}

export class TableMenuSession {
  private readonly visible = new Set<Menu>();
  private readonly hideCallbacks = new Set<() => void>();
  private revoked = false;
  private activationOpen = true;

  constructor(menu: Menu, private readonly document: Document, private readonly realm: MenuRealm, private readonly generation: number) {
    this.track(menu);
  }

  isCurrent(): boolean { return !this.revoked && this.realm.generation === this.generation; }
  canActivate(): boolean { return this.isCurrent() && this.activationOpen; }
  isVisible(): boolean { return this.visible.size > 0; }
  onHide(callback: () => void): void { this.hideCallbacks.add(callback); }

  private track(menu: Menu): void {
    this.visible.add(menu);
    menu.onHide(() => {
      if (!this.visible.delete(menu) || this.visible.size > 0) return;
      if (this.realm.current === this) this.realm.current = null;
      for (const callback of this.hideCallbacks) callback();
      // Native hosts may hide before invoking the same event's onClick.
      queueMicrotask(() => { if (this.visible.size === 0) this.activationOpen = false; });
    });
  }

  showFallbackMenu(menu: Menu, event: MouseEvent | KeyboardEvent): void {
    if (!this.canActivate()) return;
    const previous = [...this.visible];
    // Native item activation can hide the parent before its callback runs.
    // The child still belongs to this document's same menu family.
    this.realm.current = this;
    this.track(menu);
    for (const parent of previous) parent.hide();
    const pointer = event as MouseEvent;
    menu.showAtPosition({ x: pointer.clientX ?? 0, y: pointer.clientY ?? 0 }, this.document);
  }

  close(): void {
    this.revoked = true;
    this.activationOpen = false;
    if (this.realm.current === this) this.realm.current = null;
    for (const menu of [...this.visible]) menu.hide();
  }
}
