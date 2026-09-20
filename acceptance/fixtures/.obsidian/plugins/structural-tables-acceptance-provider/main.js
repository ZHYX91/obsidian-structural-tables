const { Plugin, MarkdownView, Notice } = require("obsidian");
module.exports = class extends Plugin {
  onload() {
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
