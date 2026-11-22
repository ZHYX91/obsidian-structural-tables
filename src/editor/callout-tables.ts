import type { ChangeDesc } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { SourceRange, StructuralTable } from "../core/model";
import type { StructuralTableWidget } from "./table-widget";
import { calloutBlocks, matchingBlocks } from "../rendering/native-table-mapping";

interface MountedTable {
  originals: HTMLElement[];
  host: HTMLElement;
  widget: StructuralTableWidget;
  table: StructuralTable;
  range: SourceRange;
  sourcePath: string;
}

interface SignatureEntry {
  signatures?: [withReferences: string[], withoutReferences?: string[]];
  failed?: boolean;
}

export interface CalloutDiagnostic extends SourceRange {
  state: "waiting-for-dom" | "rendering" | "render-failed" | "unmatched" | "ambiguous" | "mounted";
}

/** Source ranges own the lifecycle; native DOM is only a verified mounting target. */
export class CalloutTables {
  readonly diagnostics: CalloutDiagnostic[] = [];
  private readonly mounted = new Map<HTMLElement, MountedTable>();
  private readonly signatures = new Map<string, SignatureEntry>();
  private readonly observer: MutationObserver;
  private scheduled = false;
  private disposed = false;

  constructor(
    private readonly view: EditorView,
    private readonly read: () => {
      tables: readonly StructuralTable[];
      ranges: readonly SourceRange[];
      sourcePath: string;
      owns: (table: StructuralTable) => boolean;
      widget: (table: StructuralTable) => StructuralTableWidget;
      render: (table: StructuralTable, includeNoteReferences?: boolean) => Promise<string[]>;
      fallback?: (ranges: readonly SourceRange[]) => void;
    },
  ) {
    this.observer = new view.dom.ownerDocument.defaultView!.MutationObserver(() => this.schedule());
    this.observer.observe(view.dom, { childList: true, subtree: true, characterData: true });
    this.schedule();
  }

  mapChanges(changes: ChangeDesc): void {
    for (const entry of this.mounted.values()) {
      entry.range = { from: changes.mapPos(entry.range.from, 1), to: changes.mapPos(entry.range.to, -1) };
    }
  }

  schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.disposed) this.refresh();
    });
  }

  private calloutAt(range: SourceRange): HTMLElement | undefined {
    // Replaced callout blocks are excluded from visibleRanges but belong to the viewport.
    // Offscreen positions can resolve to placeholders; never use those.
    if (range.from < this.view.viewport.from || range.from > this.view.viewport.to) return undefined;
    const { node, offset } = this.view.domAtPos(range.from);
    const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
    const enclosing = element?.closest<HTMLElement>(".callout");
    const owned = (root: HTMLElement | null | undefined): root is HTMLElement => root != null
      && this.view.dom.contains(root)
      && root.closest(".cm-editor, .internal-embed, .markdown-embed") === this.view.dom;
    if (owned(enclosing)) return enclosing;
    const boundary = node.nodeType === Node.ELEMENT_NODE ? node.childNodes[offset] : undefined;
    // Native widgets can be adopted into a popout without changing their
    // creation-window prototypes. Ownership below matters, not instanceof.
    if (boundary?.nodeType !== Node.ELEMENT_NODE) return undefined;
    const elementBoundary = boundary as HTMLElement;
    const root = elementBoundary.matches(".callout") ? elementBoundary : elementBoundary.querySelector<HTMLElement>(".callout");
    return owned(root) ? root : undefined;
  }

  private release(entry: MountedTable): void {
    entry.widget.destroy(entry.host);
    if (entry.host.parentElement !== null) entry.host.replaceWith(...entry.originals);
    this.mounted.delete(entry.host);
  }

  private refresh(): void {
    const state = this.read();
    this.diagnostics.length = 0;
    const groups = new Map<SourceRange, { root: HTMLElement | undefined; tables: StructuralTable[] }>();
    const mountedCandidates = new Map<number, { root: HTMLElement | undefined; table: StructuralTable }>();
    // The parser emits tables in source order. calloutRanges emits disjoint outer
    // ranges, so nested tables belong to the same verified native block inventory.
    let rangeIndex = 0;
    for (const table of state.tables) {
      let range = state.ranges[rangeIndex];
      while (range !== undefined && range.to < table.range.from) range = state.ranges[++rangeIndex];
      if (range === undefined) break;
      if (table.range.from < range.from || table.range.to > range.to) continue;
      let group = groups.get(range);
      if (group === undefined) {
        group = { root: this.calloutAt(range), tables: [] };
        groups.set(range, group);
      }
      group.tables.push(table);
      if (this.mounted.size > 0) mountedCandidates.set(table.range.from, { root: group.root, table });
    }
    for (const entry of this.mounted.values()) {
      const candidate = mountedCandidates.get(entry.range.from);
      const table = candidate?.table;
      const root = candidate?.root;
      // Hover editors can build or temporarily detach their entire DOM. A host
      // still inside this editor remains owned: global isConnected would release
      // it and immediately remount it, repeatedly waking our own observer.
      if (table !== undefined && table.range.to === entry.range.to && table.source === entry.table.source
        && root?.contains(entry.host) && this.view.dom.contains(entry.host)
        && entry.sourcePath === state.sourcePath && state.owns(table)) {
        const widget = state.widget(table);
        if (widget.updateDOM(entry.host)) { entry.table = table; entry.widget = widget; continue; }
      }
      this.release(entry);
    }
    const activeKeys = new Set<string>();
    const fallback: SourceRange[] = [];
    const originals = new Map([...this.mounted].map(([host, entry]) => [host, entry.originals]));
    for (const [range, { root, tables }] of groups) {
      // Unowned and invalid neighbours participate in matching but are never replaced.
      if (!tables.some(state.owns)) continue;
      if (root === undefined && range.from >= this.view.viewport.from && range.from < this.view.viewport.to) {
        const { node } = this.view.domAtPos(range.from);
        const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement;
        const line = element?.closest<HTMLElement>(".cm-line");
        // Only an actual visible source line is evidence of absent native DOM.
        // Virtual placeholders, embedded notes and other editors cannot claim it.
        if (line !== undefined && line !== null && line.closest(".cm-editor") === this.view.dom
          && line.textContent === this.view.state.doc.lineAt(range.from).text) fallback.push(range);
      }
      const blocks = root === undefined ? [] : calloutBlocks(root, originals);
      const plans = tables.map((table) => {
        const key = JSON.stringify([state.sourcePath, table.source, table.referenceDefinitions?.markdown]);
        activeKeys.add(key);
        if (root === undefined) return { table, status: "waiting-for-dom" as const, matches: [], signatureKey: "" };
        let entry = this.signatures.get(key);
        if (entry === undefined) {
          entry = {};
          this.signatures.set(key, entry);
          const pending = entry;
          // Native Live Preview sometimes parses the callout as its own
          // excerpt. Its reference labels can still be literal before takeover.
          const full = state.render(table);
          const signatures: Promise<NonNullable<SignatureEntry["signatures"]>> =
            table.referenceDefinitions === undefined ? full.then(value => [value])
            : Promise.all([full, state.render(table, false)]);
          void signatures.then((value) => { pending.signatures = value; this.schedule(); },
            () => { pending.failed = true; this.schedule(); });
        }
        const matches = matchingBlocks(blocks, entry.signatures?.[0] ?? [], entry.signatures?.[1]);
        const status: CalloutDiagnostic["state"] = entry.failed ? "render-failed" : entry.signatures === undefined ? "rendering"
          : matches.length === 0 ? "unmatched" : "ambiguous";
        return { table, status, matches, signatureKey: JSON.stringify(entry.signatures ?? []) };
      });
      for (const plan of plans) {
        if (!state.owns(plan.table)) continue;
        let status: CalloutDiagnostic["state"] = plan.status;
        // Identical tables may use source order only after their complete target inventory agrees.
        const peers = plans.filter((other) => other.signatureKey === plan.signatureKey);
        const target = plan.matches.length === peers.length ? plan.matches[peers.indexOf(plan)] : undefined;
        if (target !== undefined && !plans.some((other) => other !== plan
          && other.signatureKey !== plan.signatureKey
          && other.matches.some((match) => match.some((element) => target.includes(element))))) {
          const existing = target.length === 1 ? this.mounted.get(target[0]!) : undefined;
          if (existing !== undefined && existing.table.range.from === plan.table.range.from) {
            status = "mounted";
          } else if (target.every((element) => !this.mounted.has(element))) {
            const widget = state.widget(plan.table);
            const host = widget.toDOM(this.view);
            target[0]!.before(host);
            for (const element of target) element.remove();
            originals.set(host, target);
            this.mounted.set(host, { originals: target, host, widget, table: plan.table,
              range: plan.table.range, sourcePath: state.sourcePath });
            status = "mounted";
          }
        }
        this.diagnostics.push({ ...plan.table.range, state: status });
      }
    }
    for (const key of this.signatures.keys()) if (!activeKeys.has(key)) this.signatures.delete(key);
    if (fallback.length > 0) state.fallback?.(fallback);
  }

  destroy(): void {
    this.disposed = true;
    this.observer.disconnect();
    for (const entry of this.mounted.values()) this.release(entry);
    this.signatures.clear();
    this.diagnostics.length = 0;
  }
}
