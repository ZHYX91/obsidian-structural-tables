import { App, Component, MarkdownRenderChild, MarkdownRenderer, TFile, type MarkdownPostProcessorContext } from "obsidian";
import type { StructuralTablesSettings } from "../config/settings";
import { parseEditableTables } from "../core/parser";
import { withoutSourcePrefixes } from "../core/source-lines";
import { contentSignature } from "../rendering/content-signature";
import { renderStructuralTable, tableRenderingComplete } from "../rendering/table-renderer";

class RenderSession extends MarkdownRenderChild {
  active = true;
  override onunload(): void { this.active = false; }
}

const boundary = ".internal-embed:not(.image-embed), .markdown-embed, .cm-editor, pre, .structural-tables-container";

function signature(element: HTMLElement): string {
  return element.tagName + contentSignature(element);
}

/** Match complete native blocks, never acquire part of an unrelated paragraph. */
function matches(root: HTMLElement, keys: readonly string[]): HTMLElement[][] {
  if (keys.length === 0) return [];
  const result: HTMLElement[][] = [];
  for (const parent of [root, ...root.querySelectorAll<HTMLElement>("div, blockquote, li")]) {
    const enclosingBoundary = parent.closest(boundary);
    if (enclosingBoundary !== null && enclosingBoundary !== root) continue;
    const children = Array.from(parent.children) as HTMLElement[];
    for (let index = 0; index <= children.length - keys.length; index += 1) {
      const targets = children.slice(index, index + keys.length);
      if (targets.some((element) => !element.matches("p, table") || element.querySelector(boundary) !== null)) continue;
      if (targets.every((element, offset) => signature(element) === keys[offset])) result.push(targets);
    }
  }
  return result;
}

async function nativeSnapshot(
  app: App,
  source: string,
  sourcePath: string,
  document: Document,
): Promise<HTMLElement> {
  const owner = new Component();
  const staging = document.createElement("div");
  // Suppress Structural Tables' own postprocessor while still allowing the
  // matcher below to inspect this root as a native-render inventory.
  staging.className = "structural-tables-container";
  owner.load();
  try {
    await MarkdownRenderer.render(app, source, staging, sourcePath, owner);
    // Render children may remove or restore DOM on unload. Capture the native
    // inventory while they still own it; only detached, inert nodes escape.
    return staging.cloneNode(true) as HTMLElement;
  } finally {
    owner.unload();
  }
}

/** Source-verified rendering for export/preview containers without section metadata. */
export class StandaloneTableRenderer {
  private readonly sessions = new WeakMap<HTMLElement, RenderSession>();

  constructor(private readonly app: App, private readonly settings: () => StructuralTablesSettings) {}

  process(container: HTMLElement, context: MarkdownPostProcessorContext): Promise<void> | void {
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(file instanceof TFile) || container.closest(boundary) !== null) return;
    this.sessions.get(container)?.unload();
    const session = new RenderSession(container);
    this.sessions.set(container, session);
    context.addChild(session);
    // Unlike Reading View's deferred section mapper, standalone rendering has
    // an awaited render boundary. Finish before an exporter clones the result.
    return this.render(container, context, file, session).catch(() => {
      // Missing/changed source or failed native comparison leaves host DOM intact.
    });
  }

  private async render(container: HTMLElement, context: MarkdownPostProcessorContext, file: TFile,
    session: RenderSession): Promise<void> {
    const source = await this.app.vault.cachedRead(file);
    const tables = parseEditableTables(source).tables;
    if (!tables.some((table) => table.valid && table.structural)) return;
    const [templates, sourceRender] = await Promise.all([
      Promise.all(tables.map(async (table) => {
        const staging = await nativeSnapshot(
          this.app,
          withoutSourcePrefixes(table.source),
          context.sourcePath,
          container.ownerDocument,
        );
        return Array.from(staging.children, (element) => signature(element as HTMLElement));
      })),
      nativeSnapshot(this.app, source, context.sourcePath, container.ownerDocument),
    ]);
    if (!session.active || this.sessions.get(container) !== session
      || this.app.vault.getAbstractFileByPath(context.sourcePath) !== file) return;
    const confirmedSource = await this.app.vault.cachedRead(file);
    // The final source read is asynchronous. A newer render session can take
    // ownership while it is pending, so repeat every authority check after it.
    if (!session.active || this.sessions.get(container) !== session
      || this.app.vault.getAbstractFileByPath(context.sourcePath) !== file
      || confirmedSource !== source) return;
    const settings = this.settings();
    if (!settings.enableReadingView) return;
    const plans = tables.map((table, index) => ({
      table,
      keys: templates[index]!,
      sourceTargets: matches(sourceRender, templates[index]!),
      targets: matches(container, templates[index]!),
    }));
    const completions: Promise<void>[] = [];
    for (const plan of plans) {
      // A standalone container can be a selection or an export fragment. Only
      // acquire it when the same native block has one unique origin in the full
      // saved note; HTML or other source constructs may render identically.
      if (!plan.table.valid || !plan.table.structural
        || plan.sourceTargets.length !== 1 || plan.targets.length !== 1) continue;
      // A literal escaped marker may render identically to structural syntax.
      // Include ordinary tables in ambiguity checks rather than guessing by DOM.
      if (plans.some((other) => other !== plan && JSON.stringify(other.keys) === JSON.stringify(plan.keys))) continue;
      const targets = plan.targets[0]!;
      if (plans.some((other) => other !== plan && other.targets.some((group) => group.some((element) => targets.includes(element))))) continue;
      if (!targets.every((element, index) => container.contains(element) && signature(element) === plan.keys[index])) continue;
      const staging = container.ownerDocument.createElement("div");
      const rendered = renderStructuralTable(this.app, plan.table, staging, context.sourcePath, session);
      completions.push(tableRenderingComplete(rendered));
      const wrapper = rendered.parentElement!;
      Object.assign(wrapper.dataset, { layout: settings.layout, appearance: settings.appearance,
        density: settings.density, zebra: String(settings.zebraRows), tableKind: "structural",
        structuralTablesProcessed: "true" });
      targets[0]!.before(wrapper);
      for (const target of targets) target.remove();
    }
    await Promise.all(completions);
  }
}
