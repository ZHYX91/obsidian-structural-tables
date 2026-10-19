import { EditorView, WidgetType } from "@codemirror/view";
import { App, Component, MarkdownRenderer } from "obsidian";
import { structuralTableSourceFocus } from "./table-source-focus";

/** A source-owned shell only when the host left an eligible Callout as raw lines. */
export class CalloutFallbackWidget extends WidgetType {
  private readonly mounts = new WeakMap<HTMLElement, { active: boolean; component: Component }>();

  constructor(private readonly app: App, readonly from: number, readonly source: string,
    readonly sourcePath: string) { super(); }

  override eq(other: CalloutFallbackWidget): boolean {
    return this.from === other.from && this.source === other.source && this.sourcePath === other.sourcePath;
  }

  override toDOM(view: EditorView): HTMLElement {
    // DOM must belong to the editor's current realm, including popouts.
    const host = view.dom.ownerDocument.createElement("div");
    host.className = "structural-tables-container structural-tables-callout-fallback";
    // Never hide content while native rendering is pending or if it fails.
    const raw = host.ownerDocument.createElement("pre");
    raw.textContent = this.source;
    host.appendChild(raw);
    const component = new Component();
    const mount = { active: true, component };
    this.mounts.set(host, mount);
    component.load();
    const revealSource = (event: MouseEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true,
        effects: structuralTableSourceFocus.of(true) });
      view.focus();
    };
    component.registerDomEvent(raw, "dblclick", revealSource);
    const staging = host.ownerDocument.createElement("div");
    staging.className = "structural-tables-container";
    void MarkdownRenderer.render(this.app, this.source, staging, this.sourcePath, component).then(() => {
      if (!mount.active || staging.querySelector(".callout") === null) return;
      host.replaceChildren(...Array.from(staging.childNodes));
      const title = host.querySelector<HTMLElement>(".callout-title");
      if (title !== null) component.registerDomEvent(title, "dblclick", revealSource);
      // CalloutTables observes this completed shell and mounts editable tables
      // using its existing exact native/source matching and history ownership.
    }).catch(() => { /* Keep the complete original source visible. */ });
    return host;
  }

  override destroy(host: HTMLElement): void {
    const mount = this.mounts.get(host);
    if (mount === undefined) return;
    mount.active = false;
    mount.component.unload();
    this.mounts.delete(host);
  }
}
