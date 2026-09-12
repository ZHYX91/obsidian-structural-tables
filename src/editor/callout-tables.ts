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
  signatures?: string[];
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
      render: (table: StructuralTable) => Promise<string[]>;
    },
  ) {
    this.observer = new MutationObserver(() => this.schedule());
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
    if (enclosing !== null && enclosing !== undefined) return enclosing;
    const boundary = node.nodeType === Node.ELEMENT_NODE ? node.childNodes[offset] : undefined;
    if (!(boundary instanceof this.view.dom.ownerDocument.defaultView!.HTMLElement)) return undefined;
    return boundary.matches(".callout") ? boundary : boundary.querySelector<HTMLElement>(".callout") ?? undefined;
  }

  private release(entry: MountedTable): void {
    entry.widget.destroy(entry.host);
    if (entry.host.parentElement !== null) entry.host.replaceWith(...entry.originals);
    this.mounted.delete(entry.host);
  }

  private refresh(): void {
    const state = this.read();
    this.diagnostics.length = 0;
    const roots = new Map(state.ranges.map((range) => [range, this.calloutAt(range)]));
    const rangeFor = (table: StructuralTable): SourceRange | undefined => state.ranges.find((range) =>
      table.range.from >= range.from && table.range.to <= range.to);
    for (const entry of this.mounted.values()) {
      const table = state.tables.find((candidate) => candidate.range.from === entry.range.from
        && candidate.range.to === entry.range.to && candidate.source === entry.table.source);
      const range = table === undefined ? undefined : rangeFor(table);
      const root = range === undefined ? undefined : roots.get(range);
      if (table !== undefined && root?.contains(entry.host) && entry.host.isConnected
        && entry.sourcePath === state.sourcePath && state.owns(table)) {
        const widget = state.widget(table);
        if (widget.updateDOM(entry.host)) { entry.table = table; entry.widget = widget; continue; }
      }
      this.release(entry);
    }
    const activeKeys = new Set<string>();
    for (const [range, root] of roots) {
      // Unowned and invalid neighbours participate in matching but are never replaced.
      const tables = state.tables.filter((table) => rangeFor(table) === range);
      if (!tables.some(state.owns)) continue;
      const originals = new Map([...this.mounted].map(([host, entry]) => [host, entry.originals]));
      const groups = root === undefined ? [] : calloutBlocks(root, originals);
      const plans = tables.map((table) => {
        const key = JSON.stringify([state.sourcePath, table.source]);
        activeKeys.add(key);
        if (root === undefined) return { table, status: "waiting-for-dom" as const, matches: [], signatureKey: "" };
        let entry = this.signatures.get(key);
        if (entry === undefined) {
          entry = {};
          this.signatures.set(key, entry);
          const pending = entry;
          void state.render(table).then((signatures) => { pending.signatures = signatures; this.schedule(); },
            () => { pending.failed = true; this.schedule(); });
        }
        const matches = matchingBlocks(groups, entry.signatures ?? []);
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
            this.mounted.set(host, { originals: target, host, widget, table: plan.table,
              range: plan.table.range, sourcePath: state.sourcePath });
            status = "mounted";
          }
        }
        this.diagnostics.push({ ...plan.table.range, state: status });
      }
    }
    for (const key of this.signatures.keys()) if (!activeKeys.has(key)) this.signatures.delete(key);
  }

  destroy(): void {
    this.disposed = true;
    this.observer.disconnect();
    for (const entry of this.mounted.values()) this.release(entry);
    this.signatures.clear();
    this.diagnostics.length = 0;
  }
}
