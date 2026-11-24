import { type ButtonComponent, Setting } from "obsidian";

interface BaseWriteActions {
  labels: { cancel: string; confirm: string; saving: string };
  canConfirm: () => boolean;
  setOptionsDisabled: (disabled: boolean) => void;
  confirm: () => Promise<void>;
  close: () => void;
  isClosed: () => boolean;
  onError: (error: unknown) => void;
}

/** Once the write starts, its options and the preview must describe the same operation. */
export function renderBaseWriteActions(container: HTMLElement, actions: BaseWriteActions): () => void {
  const row = new Setting(container);
  let cancel!: ButtonComponent;
  let confirm!: ButtonComponent;
  let busy = false;
  const refresh = (): void => { confirm.setDisabled(busy || !actions.canConfirm()); };
  const setBusy = (value: boolean): void => {
    busy = value;
    container.setAttribute("aria-busy", String(value));
    actions.setOptionsDisabled(value);
    cancel.setDisabled(value);
    confirm.setButtonText(value ? actions.labels.saving : actions.labels.confirm);
    refresh();
  };
  row.addButton((button) => {
    cancel = button.setButtonText(actions.labels.cancel).onClick(actions.close);
  });
  row.addButton((button) => {
    confirm = button.setCta().setButtonText(actions.labels.confirm).onClick(async () => {
      if (busy || actions.isClosed() || !actions.canConfirm()) return;
      const hadFocus = container.ownerDocument.activeElement === button.buttonEl;
      setBusy(true);
      try {
        await actions.confirm();
        if (!actions.isClosed()) actions.close();
      } catch (error) {
        if (!actions.isClosed()) {
          setBusy(false);
          if (hadFocus && container.ownerDocument.activeElement === container.ownerDocument.body) {
            button.buttonEl.focus();
          }
        }
        actions.onError(error);
      }
    });
  });
  refresh();
  return refresh;
}
