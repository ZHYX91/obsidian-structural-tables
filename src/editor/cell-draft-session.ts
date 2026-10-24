export interface DraftSnapshot { value: string; start: number; end: number }
export type DraftHistoryGroup = "typing" | "composition" | "deletion" | "native" | "format" | "paste" | "break";
interface DraftHistoryEntry { before: DraftSnapshot; after: DraftSnapshot; group: DraftHistoryGroup }

function sameSnapshot(left: DraftSnapshot, right: DraftSnapshot): boolean {
  return left.value === right.value && left.start === right.start && left.end === right.end;
}

/** Draft-only history and IME state. This object never dispatches a document write. */
export class CellDraftSession {
  composing = false;
  rejectedValue: string | null = null;
  pendingInput: { before: DraftSnapshot; group: DraftHistoryGroup } | null = null;
  private readonly undo: DraftHistoryEntry[] = [];
  private readonly redo: DraftHistoryEntry[] = [];
  private lastSnapshot: DraftSnapshot;
  private allowNativeMerge = true;

  constructor(private readonly editor: HTMLTextAreaElement) { this.lastSnapshot = this.snapshot(); }

  get hasHistory(): boolean { return this.undo.length > 0 || this.redo.length > 0; }

  snapshot(): DraftSnapshot {
    return { value: this.editor.value, start: this.editor.selectionStart, end: this.editor.selectionEnd };
  }

  mutate(group: DraftHistoryGroup, mutation: () => void): void {
    const before = this.snapshot();
    mutation();
    this.record(before, this.snapshot(), group, false);
    this.rejectedValue = null;
  }

  prepareInput(event: InputEvent): void {
    this.pendingInput = { before: this.snapshot(), group: this.nativeGroup(event) };
  }

  recordInput(event: InputEvent): void {
    const pending = this.pendingInput;
    this.pendingInput = null;
    const group = pending?.group ?? this.nativeGroup(event);
    this.record(pending?.before ?? this.lastSnapshot, this.snapshot(), group,
      this.allowNativeMerge && (group === "typing" || group === "composition"));
    this.allowNativeMerge = true;
    this.rejectedValue = null;
  }

  navigateHistory(redo: boolean): boolean {
    const from = redo ? this.redo : this.undo;
    const to = redo ? this.undo : this.redo;
    const entry = from.pop();
    if (entry === undefined) return false;
    to.push(entry);
    const snapshot = redo ? entry.after : entry.before;
    this.editor.value = snapshot.value;
    this.editor.setSelectionRange(snapshot.start, snapshot.end);
    this.lastSnapshot = snapshot;
    this.pendingInput = null;
    this.rejectedValue = null;
    // A new edit after undo/redo starts a branch, even if adjacent text matches.
    this.allowNativeMerge = false;
    return true;
  }

  private record(before: DraftSnapshot, after: DraftSnapshot, group: DraftHistoryGroup, merge: boolean): void {
    if (sameSnapshot(before, after)) { this.lastSnapshot = after; return; }
    const previous = this.undo[this.undo.length - 1];
    if (merge && previous?.group === group && sameSnapshot(previous.after, before)) previous.after = after;
    else this.undo.push({ before, after, group });
    this.redo.length = 0;
    this.lastSnapshot = after;
  }

  private nativeGroup(event: InputEvent): DraftHistoryGroup {
    const type = event.inputType ?? "";
    if (this.composing || event.isComposing || type.includes("Composition")) return "composition";
    if (type === "insertText") return "typing";
    if (type === "deleteContentBackward" || type === "deleteContentForward") return "deletion";
    return "native";
  }
}
