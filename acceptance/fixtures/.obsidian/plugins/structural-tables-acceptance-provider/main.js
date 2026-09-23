const { Plugin, MarkdownView, Notice, TFile } = require("obsidian");
module.exports = class extends Plugin {
  onload() {
    this.addCommand({
      id: "arm-promotion-failure",
      name: "Arm promotion failure",
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file?.path !== "Promotion recovery.md"
          || !view.editor.getValue().includes("<!-- structural-tables-promotion-recovery-fixture -->")
          || !view.editor.getValue().includes("| Alice | Doing |")) return;
        if (this.promotionEvent) this.app.vault.offref(this.promotionEvent);
        const target = view.file;
        this.promotionEvent = this.app.vault.on("create", (file) => {
          if (!(file instanceof TFile)
            || !/^_structural-table-records\/stb_[a-f0-9]+\/Alice\.md$/.test(file.path)) return;
          this.app.vault.offref(this.promotionEvent);
          this.promotionEvent = null;
          if (view.file !== target) return;
          const source = view.editor.getValue();
          const index = source.indexOf("| Alice | Doing |");
          if (index < 0) return;
          view.editor.replaceRange("| Alice | External source change |",
            view.editor.offsetToPos(index), view.editor.offsetToPos(index + "| Alice | Doing |".length));
          void this.app.vault.append(file, "\nExternal record edit retained.\n").catch((error) => {
            new Notice(`Fixture record edit failed: ${String(error)}`);
          });
          new Notice("Promotion fixture changed the source and appended an external record edit.");
        });
        this.registerEvent(this.promotionEvent);
        new Notice("The next fixture promotion will fail after creating its first record.");
      },
    });
    this.addCommand({
      id: "arm-edit-conflict",
      name: "Arm conflict on next cell input",
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file?.path !== "Reliability checks.md") return;
        const target = view.file;
        const document = view.containerEl.ownerDocument;
        const listener = (event) => {
          if (!event.target?.classList?.contains("structural-tables-cell-editor")) return;
          document.removeEventListener("input", listener, true);
          const timer = setTimeout(() => {
            if (view.file !== target) return;
            const source = view.editor.getValue();
            const index = source.indexOf("External target");
            if (index < 0) return;
            view.editor.replaceRange("External change", view.editor.offsetToPos(index), view.editor.offsetToPos(index + "External target".length));
          }, 2000);
          this.register(() => clearTimeout(timer));
        };
        document.addEventListener("input", listener, true);
        this.register(() => document.removeEventListener("input", listener, true));
        new Notice("The next cell input will trigger a separate source edit.");
      },
    });
  }
};
