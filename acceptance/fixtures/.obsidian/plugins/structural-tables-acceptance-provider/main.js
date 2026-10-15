const { Plugin, MarkdownView, Notice, TFile, Component, MarkdownRenderer, Modal } = require("obsidian");
module.exports = class extends Plugin {
  onload() {
    this.focusTraceWrites = Promise.resolve();
    this.register(() => { void this.focusTrace?.stop("plugin-unload"); });
    this.addCommand({ id: "start-final-cell-focus-trace", name: "Start passive final-cell focus trace", callback: () => this.startFocusTrace() });
    this.addCommand({ id: "stop-final-cell-focus-trace", name: "Stop passive final-cell focus trace", callback: () => this.focusTrace?.stop("command") });
    this.addCommand({
      id: "preview-standalone-tables",
      name: "Preview standalone table rendering",
      callback: async () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file?.path !== "Interoperability.md") return;
        const source = await this.app.vault.cachedRead(view.file);
        if (!source.includes("<!-- structural-tables-interop-fixture -->")) return;
        const owner = new Component();
        owner.load();
        const staging = createDiv();
        try {
          await MarkdownRenderer.render(this.app, source, staging, view.file.path, owner);
          const modal = new Modal(this.app);
          modal.setTitle("Standalone table preview");
          modal.contentEl.classList.add("markdown-rendered");
          modal.contentEl.append(staging.cloneNode(true));
          modal.onClose = () => owner.unload();
          modal.open();
        } catch (error) {
          owner.unload();
          new Notice(`Standalone preview failed: ${String(error)}`);
        }
      },
    });
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

  startFocusTrace() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path !== "Final cell focus.md"
      || !view.editor.getValue().includes("<!-- structural-tables-final-cell-focus-fixture -->")) return;
    void this.focusTrace?.stop("restarted");
    const file = view.file;
    const fixturePath = file.path;
    const document = view.containerEl.ownerDocument;
    const window = document.defaultView;
    const ids = new WeakMap(); let nextId = 1;
    const id = (node) => { if (!node) return null; if (!ids.has(node)) ids.set(node, nextId++); return ids.get(node); };
    const describe = (node) => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      if (!element || !view.containerEl.contains(element)) return { outside: true };
      const cell = element.closest("[data-structural-row][data-structural-column]");
      return { id: id(element), tag: element.tagName, classes: String(element.className).slice(0, 160),
        row: cell?.getAttribute("data-structural-row") ?? null, column: cell?.getAttribute("data-structural-column") ?? null,
        hostId: id(element.closest(".structural-tables-live-preview")) };
    };
    const entries = []; const criticalEntries = []; let total = 0; let active = true; let timer = null; let task = null; let frame = null;
    const snapshot = () => {
      const selection = document.getSelection();
      return { active: describe(document.activeElement), sourceLength: view.editor.getValue().length,
        draftCount: view.containerEl.querySelectorAll("textarea.structural-tables-cell-editor").length,
        viewportHeight: window.innerHeight, verticalScroll: view.containerEl.querySelector(".cm-scroller")?.scrollTop ?? null,
        selection: { anchor: describe(selection?.anchorNode), anchorOffset: selection?.anchorOffset ?? null,
          focus: describe(selection?.focusNode), focusOffset: selection?.focusOffset ?? null, collapsed: selection?.isCollapsed ?? null },
        tables: [...view.containerEl.querySelectorAll(".structural-tables-live-preview")].slice(0, 12).map((host) => {
          const scroller = host.querySelector(".structural-tables-container");
          return { hostId: id(host), scrollerId: id(scroller), tableIndex: host.getAttribute("data-structural-source-table-index"),
            connected: host.isConnected, scrollLeft: scroller?.scrollLeft ?? null, scrollWidth: scroller?.scrollWidth ?? null,
            clientWidth: scroller?.clientWidth ?? null, direction: scroller ? window.getComputedStyle(scroller).direction : null };
        }) };
    };
    const flush = (reason) => {
      const report = JSON.stringify({ schemaVersion: 1, kind: "structural-tables/passive-focus-trace", fixture: fixturePath,
        reason, totalEntries: total, retainedEntries: entries.length, entries: [...entries], criticalEntries: [...criticalEntries] }, null, 2) + "\n";
      this.focusTraceWrites = this.focusTraceWrites.catch(() => {}).then(() => this.app.vault.adapter.write("_structural-tables-focus-trace.json", report));
      return this.focusTraceWrites.catch((error) => { new Notice(`Focus trace write failed: ${String(error)}`); });
    };
    const record = (type, details = {}) => {
      if (!active) return;
      const current = view.file === file && file.path === fixturePath && view.containerEl.isConnected && view.containerEl.ownerDocument === document;
      if (!current && type !== "stop") { void stop("target-changed"); return; }
      const entry = { sequence: ++total, time: window.performance.now(), type, ...details, ...(current ? snapshot() : { targetUnavailable: true }) };
      entries.push(entry);
      if (entries.length > 512) entries.shift();
      if (["start", "stop", "pointerdown", "pointerup", "pointercancel"].includes(type)) {
        criticalEntries.push(entry); if (criticalEntries.length > 128) criticalEntries.shift();
      }
      if (timer === null) timer = window.setTimeout(() => { timer = null; void flush("capturing"); }, 250);
    };
    const sampleLater = () => {
      if (!active) return;
      if (task === null) task = window.setTimeout(() => { task = null; record("task"); }, 0);
      if (frame === null) frame = window.requestAnimationFrame(() => { frame = null; record("frame"); });
    };
    const listener = (event) => {
      record(event.type, { event: { isTrusted: event.isTrusted, timeStamp: event.timeStamp, pointerId: event.pointerId ?? null,
        pointerType: event.pointerType ?? null, isPrimary: event.isPrimary ?? null, detail: event.detail ?? null,
        clientX: event.clientX ?? null, clientY: event.clientY ?? null }, target: describe(event.target) });
      sampleLater();
    };
    const events = ["pointerdown", "pointermove", "pointercancel", "pointerup", "touchstart", "touchmove", "touchcancel", "touchend", "mousedown", "click", "dblclick", "focusin", "focusout", "selectionchange", "scroll"];
    const observer = new window.MutationObserver((records) => {
      record("mutation", { childListRecords: records.length, addedNodes: records.reduce((sum, item) => sum + item.addedNodes.length, 0),
        removedNodes: records.reduce((sum, item) => sum + item.removedNodes.length, 0) }); sampleLater();
    });
    const stop = (reason) => {
      if (!active) return this.focusTraceWrites;
      record("stop", { stopReason: reason }); active = false;
      for (const event of events) document.removeEventListener(event, listener, true);
      window.removeEventListener("blur", listener, true); window.removeEventListener("focus", listener, true); observer.disconnect();
      if (timer !== null) window.clearTimeout(timer); if (task !== null) window.clearTimeout(task); if (frame !== null) window.cancelAnimationFrame(frame);
      timer = task = frame = null;
      if (this.focusTrace?.stop === stop) this.focusTrace = null;
      return flush(reason);
    };
    this.focusTrace = { stop };
    for (const event of events) document.addEventListener(event, listener, { capture: true, passive: true });
    window.addEventListener("blur", listener, true); window.addEventListener("focus", listener, true);
    observer.observe(view.containerEl, { childList: true, subtree: true });
    record("start"); sampleLater();
    new Notice("Passive focus trace started. Stop it from the command palette after the fixture interaction.");
  }
};
