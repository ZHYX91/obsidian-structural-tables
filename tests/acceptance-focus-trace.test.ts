// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as host from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile } from "./mocks/obsidian";
import { parseEditableTables } from "../src/core/parser";

const script = readFileSync("acceptance/fixtures/.obsidian/plugins/structural-tables-acceptance-provider/main.js", "utf8");
const fixtureSource = readFileSync("acceptance/fixtures/Final cell focus.md", "utf8");
const cleanups: Array<() => void> = [];
interface Provider { app: host.App; addCommand: (command: { id: string; callback: () => unknown }) => void; onload: () => void; unload: () => void }

function fixture(path = "Final cell focus.md") {
  const module = { exports: {} };
  runInNewContext(script, { require: () => host, module });
  const provider = new (module.exports as new () => Provider)();
  const containerEl = document.body.appendChild(document.createElement("div"));
  containerEl.innerHTML = '<div class="structural-tables-live-preview" data-structural-source-table-index="0"><div class="structural-tables-container"><table><tr><td data-structural-row="24" data-structural-column="4">last-24</td></tr></table></div></div>';
  const source = fixtureSource;
  const replaceRange = vi.fn();
  const view = Object.assign(Object.create(host.MarkdownView.prototype) as host.MarkdownView, { containerEl, file: new TFile(path),
    editor: { getValue: () => source, replaceRange, cm: { state: { selection: { main: { anchor: 4, head: 9, from: 4, to: 9 } } } } } });
  const writes: Array<{ path: string; source: string }> = [];
  const commands = new Map<string, () => unknown>();
  provider.app = { workspace: { getActiveViewOfType: () => view }, vault: { adapter: { write: async (path: string, source: string) => { writes.push({ path, source }); } } } } as unknown as host.App;
  provider.addCommand = ({ id, callback }) => { commands.set(id, callback); };
  provider.onload(); cleanups.push(() => provider.unload());
  return { provider, containerEl, source, view, writes, replaceRange, commands };
}

afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("fixture-only passive focus trace", () => {
  it("keeps a valid long-content merged fixture with the same final-cell and paragraph targets", () => {
    const tables = parseEditableTables(fixtureSource).tables;
    expect(tables).toHaveLength(1); expect(tables[0]!.valid).toBe(true); expect(tables[0]!.rows).toHaveLength(25);
    expect(tables[0]!.rows[1]!.cells[0]!.rowSpan).toBe(2);
    expect(tables[0]!.rows[24]!.cells[2]!.content).toBe("Long seasonal vegetable and grain combination 24");
    expect(tables[0]!.rows[24]!.cells[4]!.content).toBe("last-24"); expect(fixtureSource).toContain("After the table. Tap this paragraph");
  });
  it("records attributed pointer cancellation and bounded snapshots without operating the editor, then stops completely", async () => {
    const f = fixture(); const cell = f.containerEl.querySelector<HTMLElement>("td")!;
    const focus = vi.spyOn(cell, "focus");
    f.commands.get("start-final-cell-focus-trace")!();
    const pointer = (type: string): Event => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: "touch" }, isPrimary: { value: true }, isTrusted: { value: false } }); return event;
    };
    cell.dispatchEvent(pointer("pointerdown")); cell.dispatchEvent(pointer("pointercancel")); cell.dispatchEvent(pointer("pointerdown"));
    for (let index = 0; index < 550; index += 1) cell.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    await f.commands.get("stop-final-cell-focus-trace")!();
    const output = f.writes[f.writes.length - 1]!;
    expect(output.path).toBe("_structural-tables-focus-trace.json");
    const report = JSON.parse(output.source) as { entries: unknown[]; criticalEntries: Array<{ type: string; target: { row: string; column: string; hostId: number }; event: { pointerId: number; pointerType: string; timeStamp: number; isTrusted: boolean; isPrimary: boolean } }> };
    expect(report.entries.length).toBeLessThanOrEqual(512);
    expect(report.entries[0]).toMatchObject({ sourceSelection: { anchor: 4, head: 9, from: 4, to: 9 },
      tables: [{ hostRect: { height: 0, width: 0 }, scrollerRect: { top: 0, bottom: 0 }, tableRect: { height: 0 } }] });
    const events = report.criticalEntries.filter((entry) => entry.type.startsWith("pointer"));
    expect(events.map((entry) => entry.type)).toEqual(["pointerdown", "pointercancel", "pointerdown"]);
    expect(events.map((entry) => entry.event.pointerId)).toEqual([7, 7, 7]);
    expect(events.map((entry) => entry.target.hostId)).toEqual([events[0]!.target.hostId, events[0]!.target.hostId, events[0]!.target.hostId]);
    for (const entry of events) {
      expect(entry.target).toMatchObject({ row: "24", column: "4" }); expect(entry.event).toMatchObject({ pointerType: "touch", isPrimary: true, isTrusted: false });
      expect(entry.event.timeStamp).toBeGreaterThan(0);
    }
    expect(f.replaceRange).not.toHaveBeenCalled(); expect(f.view.editor.getValue()).toBe(f.source); expect(focus).not.toHaveBeenCalled();
    const count = f.writes.length; cell.dispatchEvent(pointer("pointerdown")); cell.append(document.createElement("span"));
    await new Promise((resolve) => setTimeout(resolve, 280)); expect(f.writes).toHaveLength(count);
  });

  it("bounds selected owners and aria-selected mutation details without operating the editor", async () => {
    const f = fixture(); const first = f.containerEl.querySelector<HTMLTableCellElement>("td")!;
    const row = first.parentElement as HTMLTableRowElement;
    const cells = [first];
    for (let index = 1; index < 70; index += 1) {
      const cell = row.insertCell();
      cell.dataset.structuralRow = "24"; cell.dataset.structuralColumn = String(4 + index);
      cells.push(cell);
    }
    for (const cell of cells) cell.setAttribute("aria-selected", "true");
    const focus = vi.spyOn(first, "focus");
    f.commands.get("start-final-cell-focus-trace")!();
    for (const cell of cells) cell.setAttribute("aria-selected", "false");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await f.commands.get("stop-final-cell-focus-trace")!();
    const report = JSON.parse(f.writes[f.writes.length - 1]!.source) as { entries: Array<{
      type: string; tables: Array<{ hostId: number; selectedOwnerCount: number;
        selectedOwners: Array<{ hostId: number; row: string; column: string }>; selectedOwnersDropped: number }>;
      ariaSelectedCount?: number; ariaSelectedDropped?: number;
      ariaSelectedChanges?: Array<{ hostId: number; row: string; column: string; connected: boolean;
        oldValue: string | null; currentValue: string | null }>;
    }> };
    const initial = report.entries.find((entry) => entry.type === "start")!.tables[0]!;
    expect(initial.selectedOwnerCount).toBe(70);
    expect(initial.selectedOwners).toHaveLength(64); expect(initial.selectedOwnersDropped).toBe(6);
    expect(initial.selectedOwners[0]).toEqual({ hostId: initial.hostId, row: "24", column: "4" });
    const mutation = report.entries.find((entry) => entry.type === "mutation" && entry.ariaSelectedCount === 70)!;
    expect(mutation).toBeDefined(); expect(mutation.ariaSelectedChanges).toHaveLength(32);
    expect(mutation.ariaSelectedDropped).toBe(38);
    expect(mutation.ariaSelectedChanges![0]).toEqual({ hostId: initial.hostId, row: "24", column: "4",
      connected: true, oldValue: "true", currentValue: "false" });
    expect(mutation.tables[0]!.selectedOwnerCount).toBe(0);
    expect(f.replaceRange).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled();
    expect(f.view.editor.getValue()).toBe(f.source);
  });

  it("records pointer buttons and copy consumption after dispatch without reading clipboard content", async () => {
    const f = fixture(); const cell = f.containerEl.querySelector<HTMLElement>("td")!;
    const focus = vi.spyOn(cell, "focus");
    const getData = vi.fn(() => { throw new Error("Clipboard content must not be read by passive tracing."); });
    const types = ["text/plain", "text/html", ...Array.from({ length: 8 }, (_unused, index) => `application/x-fixture-${index}`)];
    f.commands.get("start-final-cell-focus-trace")!();
    const pointer = new Event("pointerover", { bubbles: true, cancelable: true });
    Object.defineProperties(pointer, { pointerId: { value: 7 }, pointerType: { value: "mouse" }, buttons: { value: 1 } });
    cell.dispatchEvent(pointer);
    cell.addEventListener("copy", (event) => event.preventDefault(), { once: true });
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    const clipboardData = vi.fn(() => ({ types, getData }));
    Object.defineProperty(copy, "clipboardData", { get: clipboardData });
    const defaultPrevented = Object.getOwnPropertyDescriptor(Event.prototype, "defaultPrevented")!.get!;
    const consumption = vi.fn(() => defaultPrevented.call(copy) as boolean);
    Object.defineProperty(copy, "defaultPrevented", { get: consumption });
    cell.dispatchEvent(copy);
    const readsAfterDispatch = consumption.mock.calls.length;
    await Promise.resolve();
    // No post-task observation runs at the microtask checkpoint.
    expect(consumption).toHaveBeenCalledTimes(readsAfterDispatch);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consumption).toHaveBeenCalledTimes(readsAfterDispatch + 1);
    await f.commands.get("stop-final-cell-focus-trace")!();
    const report = JSON.parse(f.writes[f.writes.length - 1]!.source) as { entries: Array<{
      type: string; originalType?: string; event?: { buttons: number | null; defaultPrevented: boolean; clipboardTypes?: string[] };
    }> };
    expect(report.entries.find((entry) => entry.type === "pointerover")?.event)
      .toMatchObject({ buttons: 1, defaultPrevented: false });
    expect(report.entries.find((entry) => entry.type === "event-settled" && entry.originalType === "pointerover")?.event)
      .toMatchObject({ buttons: 1, defaultPrevented: false });
    const capture = report.entries.find((entry) => entry.type === "copy")!.event!;
    const settled = report.entries.find((entry) => entry.type === "event-settled" && entry.originalType === "copy")!.event!;
    expect(capture.defaultPrevented).toBe(false); expect(settled.defaultPrevented).toBe(true);
    expect(capture.clipboardTypes).toEqual(types.slice(0, 8));
    expect(settled.clipboardTypes).toBeUndefined();
    expect(copy.defaultPrevented).toBe(true); expect(getData).not.toHaveBeenCalled();
    expect(clipboardData).toHaveBeenCalledOnce();
    expect(f.replaceRange).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled();
    expect(f.view.editor.getValue()).toBe(f.source);
  });

  it("requires the named marked fixture and releases capture on plugin unload", async () => {
    const wrong = fixture("Other.md"); wrong.commands.get("start-final-cell-focus-trace")!();
    expect(wrong.writes).toHaveLength(0);
    const f = fixture(); f.commands.get("start-final-cell-focus-trace")!(); f.provider.unload();
    await vi.waitFor(() => expect(f.writes.length).toBeGreaterThan(0));
    expect(JSON.parse(f.writes[f.writes.length - 1]!.source).reason).toBe("plugin-unload");
  });

  it("stops before a mutation or queued sample can read another note", async () => {
    const f = fixture(); f.commands.get("start-final-cell-focus-trace")!();
    const read = vi.spyOn(f.view.editor, "getValue"); read.mockClear();
    f.view.file = new TFile("Other.md") as host.TFile;
    f.containerEl.append(document.createElement("span"));
    await vi.waitFor(() => expect(f.writes.length).toBeGreaterThan(0));
    const report = JSON.parse(f.writes[f.writes.length - 1]!.source);
    expect(report.reason).toBe("target-changed"); expect(report.fixture).toBe("Final cell focus.md");
    expect(report.entries.at(-1)).toMatchObject({ type: "stop", targetUnavailable: true });
    expect(read).not.toHaveBeenCalled();
  });
});
