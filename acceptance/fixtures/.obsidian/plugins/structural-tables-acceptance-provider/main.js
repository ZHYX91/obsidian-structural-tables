const { Plugin, MarkdownView, Notice, TFile, Component, MarkdownRenderer, Modal } = require("obsidian");
module.exports = class extends Plugin {
  onload() {
    this.addCommand({ id: "operation-safety-setup", name: "Prepare operation safety boundary", callback: () => this.safetySetup() });
    this.register(() => this.safetyRestore?.());
    this.addCommand({ id: "clipboard-fidelity-samples", name: "Prepare clipboard fidelity samples", callback: () => {
      const modal = new Modal(this.app);
      modal.setTitle("Clipboard fidelity input samples");
      for (const [label, value] of [["Edge NBSP", "\u00a0A\u00a0"], ["Only NBSP", "\u00a0\u00a0"],
        ["Figure spaces", "\u2007A\u2007"], ["Narrow NBSP", "\u202fA\u202f"]]) {
        const button = modal.contentEl.createEl("button", { text: label });
        button.addEventListener("click", () => { void navigator.clipboard.writeText(value).then(() => {
          new Notice(`${label} copied as input`); modal.close();
        }); });
      }
      modal.open();
    } });
    this.addCommand({ id: "record-clipboard-fidelity", name: "Record clipboard fidelity observation", callback: async () => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view?.file?.path !== "Clipboard fidelity and migration.md") return;
      const source = await this.app.vault.read(view.file);
      if (!source.includes("<!-- structural-tables-clipboard-fidelity -->")) return;
      const cells = Array.from(view.containerEl.querySelectorAll("th, td"))
        .filter((cell) => cell.getClientRects().length > 0).map((cell) => ({
          text: cell.textContent,
          codePoints: Array.from(cell.textContent ?? "", (character) => character.codePointAt(0)),
        }));
      await this.app.vault.adapter.write(`_clipboard-fidelity-${Date.now()}.json`, JSON.stringify({
        observedAt: new Date().toISOString(), hostVersion: require("obsidian").apiVersion,
        mobile: require("obsidian").Platform.isMobileApp, file: view.file.path,
        view: view.getMode(), source, cells,
      }, null, 2));
      new Notice("Clipboard fidelity observation recorded.");
    } });
    this.addCommand({
      id: "record-html-boundary-observation",
      name: "Record HTML boundary observation",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "O" }],
      callback: async () => {
        if (require("obsidian").Platform.isMobileApp) return;
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view?.file || !["HTML boundaries and code interchange.md", "GFM clipboard result.md"].includes(view.file.path)) return;
        const { createHash } = require("node:crypto");
        const source = await this.app.vault.read(view.file);
        const root = view.containerEl;
        const clipboard = require("electron").clipboard;
        const clipboardText = clipboard.readText();
        const ownsClipboard = clipboardText.includes("KEEP-0") || clipboardText.includes("BROWSER-KEEP");
        const report = {
          observedAt: new Date().toISOString(), file: view.file.path,
          hostVersion: require("obsidian").apiVersion,
          view: view.getMode(), sourceMode: view.getState().source ?? null,
          source, sourceSha256: createHash("sha256").update(source).digest("hex"),
          literalElements: Array.from(root.querySelectorAll("[id^='literal-'], #inline-continuation"))
            .filter((element) => element.getClientRects().length > 0).map((element) => ({
            tag: element.tagName, id: element.id, class: element.className,
            case: element.getAttribute("data-case"), text: element.textContent,
            ownedAncestor: Boolean(element.closest(".structural-tables-live-preview, .structural-tables-container")),
          })),
          tables: Array.from(root.querySelectorAll("table"))
            .filter((table) => table.getClientRects().length > 0).map((table) => ({
            class: table.className,
            owned: Boolean(table.closest(".structural-tables-live-preview, .structural-tables-container")),
            cells: Array.from(table.querySelectorAll("th, td")).map((cell) => ({
              text: cell.textContent, rowSpan: cell.rowSpan, colSpan: cell.colSpan,
              code: Array.from(cell.querySelectorAll("code")).map((code) => code.textContent),
            })),
          })),
          clipboard: { formats: clipboard.availableFormats(), fixtureOwned: ownsClipboard,
            text: ownsClipboard ? clipboardText : null, html: ownsClipboard ? clipboard.readHTML() : null },
        };
        await this.app.vault.adapter.write(`_html-boundary-observation-${Date.now()}.json`, JSON.stringify(report, null, 2));
        new Notice("HTML boundary observation recorded.");
      },
    });
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

  safetySetup() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view?.file?.path !== "Operation safety.md" || !view.editor.getValue().includes("<!-- structural-tables-operation-safety -->")) return;
    const modal = new Modal(this.app);
    modal.setTitle("Operation safety setup (fixture only)");
    modal.contentEl.createEl("p", { text: "Choose setup, then use the actual Structural Tables command and confirmation. These controls record observations, never a verdict." });
    const action = (label, callback) => modal.contentEl.createEl("button", { text: label }).addEventListener("click", () => {
      modal.close(); void Promise.resolve().then(callback).catch(error => new Notice(String(error)));
    });
    action("Prepare migration records", () => this.safetyRecords());
    for (const mode of ["replace-at-process", "dirty-at-process", "rollback-external-edit", "pause-migration", "pause-first-record", "pause-attachment-path"]) {
      action(`Arm ${mode}`, () => this.safetyArm(mode));
    }
    action("Unload Structural Tables in 60 seconds", async () => {
      const armedAt = new Date().toISOString();
      const document = view.containerEl.ownerDocument;
      const previews = () => Array.from(document.querySelectorAll(".structural-tables-conversion-preview, .structural-tables-promotion-modal"))
        .filter(element => element.getClientRects().length > 0)
        .map(element => ({ classes: element.className, title: element.closest(".modal")?.querySelector(".modal-title")?.textContent ?? null }));
      const timer = setTimeout(() => { void (async () => {
        const beforeUnloadAt = new Date().toISOString(); const before = previews();
        await this.app.plugins.disablePlugin("structural-tables");
        await this.safetyRecord("timed-plugin-unload-completed", { armedAt, beforeUnloadAt, before,
          after: previews(), testedPluginLoaded: Boolean(this.app.plugins.plugins["structural-tables"]) });
      })().catch(error => new Notice(`Fixture timed unload failed: ${String(error)}`)); }, 60000);
      this.register(() => clearTimeout(timer));
      await this.safetyRecord("timed-plugin-unload-armed", { armedAt, delayMs: 60000 });
      new Notice("Open the product preview now; fixture unload is scheduled in 60 seconds.");
    });
    action("Reload Structural Tables", () => this.app.plugins.enablePlugin("structural-tables"));
    action("Record current safety state", () => this.safetyRecord("operator-observation"));
    action("Disarm wrappers", () => this.safetyRestore?.());
    modal.open();
  }

  async safetyRecords() {
    this.safetyRestore?.();
    for (const name of ["A", "B"]) {
      const path = `Operation safety ${name}.md`;
      const file = this.app.vault.getFileByPath(path);
      if (!(file instanceof TFile) || !(await this.app.vault.read(file)).includes("<!-- structural-tables-operation-safety-record -->")) throw new Error(`Missing owned fixture: ${path}`);
      await this.app.vault.modify(file, `---\n# keep leading comment\nstructural_table_ids: [stb_operation_safety] # keep membership comment\nstructural_record_id: str_operation_${name}\nlarge: 900719925474099312345\ndate: 2026-10-25\nflow: {one: 1, two: 'two'} # keep flow layout\nuser: 'keep quoted value'\n---\n<!-- structural-tables-operation-safety-record -->\nBody ${name} remains byte-for-byte.\n`);
    }
    this.safetyEvents = [];
    new Notice("Two owned migration records prepared. Wait for the host metadata cache, then open the product migration preview.");
  }

  async safetyRecord(stage, extra = {}) {
    const files = [];
    for (const name of ["A", "B"]) {
      const path = `Operation safety ${name}.md`; const file = this.app.vault.getFileByPath(path);
      if (file instanceof TFile) files.push({ path, source: await this.app.vault.read(file) });
    }
    const editors = this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
      .filter(view => /^Operation safety(?: [AB])?\.md$/.test(view.file?.path ?? ""))
      .map(view => ({ path: view.file.path, buffer: view.editor.getValue() }));
    (this.safetyEvents ??= []).push({ stage, observedAt: new Date().toISOString(), ...extra, files, editors });
    await this.app.vault.adapter.write("_operation-safety-observations.json", JSON.stringify({ diagnosticOnly: true, events: this.safetyEvents }, null, 2));
    new Notice(`Operation safety observation: ${stage}`);
  }

  safetyArm(mode) {
    this.safetyRestore?.();
    const vault = this.app.vault;
    const restores = []; let armed = true; let first = null; let firstPath = null;
    const patch = (owner, key, wrapper) => {
      const original = owner[key]; const replacement = wrapper(original);
      owner[key] = replacement;
      restores.push(() => { if (owner[key] === replacement) owner[key] = original; });
    };
    this.safetyRestore = () => { armed = false; restores.reverse().forEach(restore => restore()); this.safetyRelease?.(); this.safetyRelease = null; };
    const recordFile = file => file instanceof TFile && /^Operation safety [AB]\.md$/.test(file.path);
    const gate = async stage => {
      await this.safetyRecord(stage, { mode });
      await new Promise(resolve => {
        this.safetyRelease = resolve;
        const modal = new Modal(this.app); modal.setTitle(`Paused fixture I/O: ${stage}`);
        modal.contentEl.createEl("p", { text: "The actual product operation is waiting. Unload, optionally reload, then resume. Inspect the product and files separately." });
        for (const [label, callback] of [["Unload tested plugin", () => this.app.plugins.disablePlugin("structural-tables")], ["Reload tested plugin", () => this.app.plugins.enablePlugin("structural-tables")], ["Resume I/O", () => { modal.close(); resolve(); }]]) {
          modal.contentEl.createEl("button", { text: label }).addEventListener("click", () => { void Promise.resolve().then(callback); });
        }
        modal.onClose = () => resolve(); modal.open(); this.register(() => modal.close());
      });
    };
    if (mode === "pause-attachment-path") {
      patch(this.app.fileManager, "getAvailablePathForAttachment", original => async (...args) => {
        const result = await original.apply(this.app.fileManager, args);
        if (armed && args[1] === "Operation safety.md") { armed = false; await gate("attachment-path-resolved"); }
        return result;
      });
    } else if (mode === "pause-first-record") {
      patch(vault, "create", original => async (...args) => {
        const result = await original.apply(vault, args);
        if (armed && /^_structural-table-records\/stb_[a-f0-9]+\/Safety Alpha\.md$/.test(args[0])) { armed = false; await gate("first-record-created"); }
        return result;
      });
    } else {
      patch(vault, "process", original => async (file, callback, ...args) => {
        if (!recordFile(file) || !armed) return original.call(vault, file, callback, ...args);
        const originalPath = file.path;
        if (mode === "rollback-external-edit" && first === null) {
          const result = await original.call(vault, file, callback, ...args);
          first = file; firstPath = file.path; await this.safetyRecord("first-migration-write", { mode, originalPath }); return result;
        }
        armed = false;
        if (mode === "replace-at-process") {
          const source = await vault.read(file);
          const retainedPath = `${originalPath}.retained-original`;
          if (vault.getAbstractFileByPath(retainedPath)) throw new Error("Owned retained-original path already exists; use a fresh disposable Vault.");
          await vault.rename(file, retainedPath); const replacement = await vault.create(originalPath, source);
          await this.safetyRecord("same-path-identical-replacement", { mode, originalPath, retainedPath, sameTFile: replacement === file });
        } else if (mode === "dirty-at-process") {
          const source = await vault.read(file);
          for (const suffix of ["Unsaved pane one", "Unsaved pane two"]) {
            const leaf = this.app.workspace.getLeaf("split"); await leaf.openFile(file);
            leaf.view.editor.setValue(`${source}\n${suffix}\n`);
          }
          await this.safetyRecord("different-dirty-pane-buffers", { mode, originalPath });
        } else if (mode === "rollback-external-edit") {
          await vault.append(first, "\nExternal edit after migration must survive compensation.\n");
          await this.safetyRecord("external-edit-before-second-write-failure", { mode, originalPath, firstPath });
          throw new Error("Fixture injected second migration write failure.");
        } else if (mode === "pause-migration") await gate("before-migration-process");
        return original.call(vault, file, callback, ...args);
      });
    }
    new Notice(`Armed fixture boundary: ${mode}. Use the actual product command and confirmation.`);
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
    const isCurrent = () => view.file === file && file.path === fixturePath && view.containerEl.isConnected && view.containerEl.ownerDocument === document;
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
    const entries = []; const criticalEntries = []; const settledEvents = []; let settledEventsDropped = 0;
    let total = 0; let active = true; let timer = null; let task = null; let frame = null;
    const rect = (element) => { if (!element) return null; const bounds = element.getBoundingClientRect(); return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, width: bounds.width, height: bounds.height }; };
    const snapshot = () => {
      const selection = document.getSelection();
      const sourceSelection = view.editor.cm?.state?.selection?.main;
      return { active: describe(document.activeElement), sourceLength: view.editor.getValue().length,
        sourceSelection: sourceSelection ? { anchor: sourceSelection.anchor, head: sourceSelection.head, from: sourceSelection.from, to: sourceSelection.to } : null,
        draftCount: view.containerEl.querySelectorAll("textarea.structural-tables-cell-editor").length,
        viewportHeight: window.innerHeight, verticalScroll: view.containerEl.querySelector(".cm-scroller")?.scrollTop ?? null,
        selection: { anchor: describe(selection?.anchorNode), anchorOffset: selection?.anchorOffset ?? null,
          focus: describe(selection?.focusNode), focusOffset: selection?.focusOffset ?? null, collapsed: selection?.isCollapsed ?? null },
        tables: [...view.containerEl.querySelectorAll(".structural-tables-live-preview")].slice(0, 12).map((host) => {
          const scroller = host.querySelector(".structural-tables-container");
          const selected = [...host.querySelectorAll('[data-structural-row][data-structural-column][aria-selected="true"]')]
            .filter((cell) => cell.closest(".structural-tables-live-preview") === host);
          const selectedOwners = selected.slice(0, 64).map((cell) => ({ hostId: id(host),
            row: cell.getAttribute("data-structural-row"), column: cell.getAttribute("data-structural-column") }));
          return { selectedOwnerCount: selected.length, selectedOwners, selectedOwnersDropped: Math.max(0, selected.length - 64), hostId: id(host), scrollerId: id(scroller), tableIndex: host.getAttribute("data-structural-source-table-index"),
            hostRect: rect(host), scrollerRect: rect(scroller), tableRect: rect(host.querySelector("table")),
            connected: host.isConnected, scrollLeft: scroller?.scrollLeft ?? null, scrollWidth: scroller?.scrollWidth ?? null,
            clientWidth: scroller?.clientWidth ?? null, direction: scroller ? window.getComputedStyle(scroller).direction : null };
        }) };
    };
    const flush = (reason) => {
      const report = JSON.stringify({ schemaVersion: 1, kind: "structural-tables/passive-focus-trace", fixture: fixturePath,
        reason, totalEntries: total, retainedEntries: entries.length, settledEventsDropped, entries: [...entries], criticalEntries: [...criticalEntries] }, null, 2) + "\n";
      this.focusTraceWrites = this.focusTraceWrites.catch(() => {}).then(() => this.app.vault.adapter.write("_structural-tables-focus-trace.json", report));
      return this.focusTraceWrites.catch((error) => { new Notice(`Focus trace write failed: ${String(error)}`); });
    };
    const record = (type, details = {}) => {
      if (!active) return;
      const current = isCurrent();
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
      if (task === null) task = window.setTimeout(() => {
        task = null;
        for (const pending of settledEvents.splice(0)) {
          if (!active) return;
          if (!isCurrent()) { void stop("target-changed"); return; }
          const details = { ...pending.details }; delete details.clipboardTypes;
          record("event-settled", { originalType: pending.type, phase: "settled-task",
            event: { ...details, defaultPrevented: pending.event.defaultPrevented }, target: pending.target, relatedTarget: pending.relatedTarget });
        }
        record("task");
      }, 0);
      if (frame === null) frame = window.requestAnimationFrame(() => { frame = null; record("frame"); });
    };
    const eventDetails = (event) => {
      let clipboardTypes;
      if (event.type === "copy") {
        try { clipboardTypes = [...(event.clipboardData?.types ?? [])].slice(0, 8); }
        catch { clipboardTypes = []; }
      }
      return { isTrusted: event.isTrusted, timeStamp: event.timeStamp, pointerId: event.pointerId ?? null,
        pointerType: event.pointerType ?? null, isPrimary: event.isPrimary ?? null, detail: event.detail ?? null,
        clientX: event.clientX ?? null, clientY: event.clientY ?? null, buttons: event.buttons ?? null,
        defaultPrevented: event.defaultPrevented, ...(clipboardTypes === undefined ? {} : { clipboardTypes }) };
    };
    const listener = (event) => {
      const target = describe(event.target); const relatedTarget = describe(event.relatedTarget); const details = eventDetails(event);
      record(event.type, { phase: "capture", event: details, target, relatedTarget });
      if (["pointerdown", "pointerover", "pointermove", "pointercancel", "pointerup", "copy"].includes(event.type)) {
        if (settledEvents.length < 32) settledEvents.push({ type: event.type, event, details, target, relatedTarget });
        else settledEventsDropped += 1;
      }
      sampleLater();
    };
    const events = ["pointerdown", "pointerover", "pointermove", "pointercancel", "pointerup", "touchstart", "touchmove", "touchcancel", "touchend", "mousedown", "click", "dblclick", "focusin", "focusout", "selectionchange", "scroll", "copy"];
    const observer = new window.MutationObserver((records) => {
      if (!active) return;
      if (!isCurrent()) { void stop("target-changed"); return; }
      const childList = records.filter((item) => item.type === "childList");
      const attributes = records.filter((item) => item.type === "attributes" && item.attributeName === "aria-selected"
        && item.target.matches("[data-structural-row][data-structural-column]"));
      const ariaSelectedChanges = attributes.slice(0, 32).map((item) => ({
        hostId: id(item.target.closest(".structural-tables-live-preview")), row: item.target.getAttribute("data-structural-row"),
        column: item.target.getAttribute("data-structural-column"), connected: item.target.isConnected,
        oldValue: item.oldValue, currentValue: item.target.getAttribute("aria-selected") }));
      record("mutation", { childListRecords: childList.length, addedNodes: childList.reduce((sum, item) => sum + item.addedNodes.length, 0),
        removedNodes: childList.reduce((sum, item) => sum + item.removedNodes.length, 0),
        ariaSelectedCount: attributes.length, ariaSelectedChanges, ariaSelectedDropped: Math.max(0, attributes.length - 32) }); sampleLater();
    });
    const stop = (reason) => {
      if (!active) return this.focusTraceWrites;
      record("stop", { stopReason: reason }); active = false;
      for (const event of events) document.removeEventListener(event, listener, true);
      window.removeEventListener("blur", listener, true); window.removeEventListener("focus", listener, true); observer.disconnect();
      if (timer !== null) window.clearTimeout(timer); if (task !== null) window.clearTimeout(task); if (frame !== null) window.cancelAnimationFrame(frame);
      timer = task = frame = null; settledEvents.length = 0;
      if (this.focusTrace?.stop === stop) this.focusTrace = null;
      return flush(reason);
    };
    this.focusTrace = { stop };
    for (const event of events) document.addEventListener(event, listener, { capture: true, passive: true });
    window.addEventListener("blur", listener, true); window.addEventListener("focus", listener, true);
    observer.observe(view.containerEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-selected"], attributeOldValue: true });
    record("start"); sampleLater();
    new Notice("Passive focus trace started. Stop it from the command palette after the fixture interaction.");
  }
};
