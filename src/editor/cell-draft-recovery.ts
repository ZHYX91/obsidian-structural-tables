import { App, Modal, Notice } from "obsidian";

import { applyInterfaceLocale, createTranslator, type Translate } from "../config/i18n";
import { appendDisplayPath } from "../config/interface-bidi";

export interface RecoveredCellDraft {
  sourcePath: string;
  row: number;
  column: number;
  text: string;
}

interface RecoveryState {
  drafts: RecoveredCellDraft[];
  modal: DraftRecoveryModal | null;
}

// Recovery belongs to the application session, not a widget or editor DOM node.
const states = new WeakMap<App, RecoveryState>();
function stateFor(app: App): RecoveryState {
  let state = states.get(app);
  if (state === undefined) {
    state = { drafts: [], modal: null };
    states.set(app, state);
  }
  return state;
}

export function recoveredCellDrafts(app: App): readonly RecoveredCellDraft[] {
  return stateFor(app).drafts;
}

export function retainCellDraft(app: App, draft: RecoveredCellDraft, t: Translate): void {
  stateFor(app).drafts.push({ ...draft });
  queueMicrotask(() => showRecoveredCellDrafts(app, t));
}

export function showRecoveredCellDrafts(app: App, t: Translate = createTranslator("auto")): void {
  const state = stateFor(app);
  if (state.drafts.length === 0) {
    new Notice(t("draft.none"));
    return;
  }
  if (state.modal !== null) { state.modal.render(); return; }
  state.modal = new DraftRecoveryModal(app, state, t);
  state.modal.open();
}

class DraftRecoveryModal extends Modal {
  private readonly visibleDrafts = new Set<RecoveredCellDraft>();

  constructor(app: App, private readonly state: RecoveryState, private readonly t: Translate) { super(app); }

  override onOpen(): void {
    applyInterfaceLocale(this.modalEl ?? this.contentEl, this.t);
    this.setTitle(this.t("draft.title"));
    this.contentEl.createEl("p").textContent = this.t("draft.description");
    this.render();
  }

  render(): void {
    for (const draft of this.state.drafts) {
      if (this.visibleDrafts.has(draft)) continue;
      this.visibleDrafts.add(draft);
      const row = this.contentEl.createDiv();
      const label = row.createEl("label");
      label.textContent = this.t("editor.cell").replace("{row}", String(draft.row + 1))
        .replace("{column}", String(draft.column + 1)) + " — ";
      appendDisplayPath(label, draft.sourcePath);
      const text = label.createEl("textarea");
      text.className = "structural-tables-recovered-draft";
      text.readOnly = true;
      text.dir = "auto";
      text.value = draft.text;
      text.rows = 6;
      const copy = row.createEl("button");
      copy.textContent = this.t("draft.copy");
      copy.addEventListener("click", () => {
        void this.copyDraft(draft, text);
      });
      const discard = row.createEl("button");
      discard.textContent = this.t("draft.discard");
      discard.addEventListener("click", () => {
        this.state.drafts = this.state.drafts.filter((candidate) => candidate !== draft);
        if (this.state.drafts.length === 0) this.close();
        else {
          row.remove();
          this.visibleDrafts.delete(draft);
          this.contentEl.querySelector("textarea")?.focus();
        }
      });
    }
  }

  private async copyDraft(draft: RecoveredCellDraft, text: HTMLTextAreaElement): Promise<void> {
    try {
      await text.ownerDocument.defaultView!.navigator.clipboard.writeText(draft.text);
      if (text.isConnected) new Notice(this.t("draft.copied"));
    } catch {
      if (!text.isConnected) return;
      text.focus();
      text.select();
      new Notice(this.t("draft.copyFailed"));
    }
  }

  override onClose(): void {
    this.visibleDrafts.clear();
    this.state.modal = null;
    this.contentEl.replaceChildren();
  }
}
