// @vitest-environment happy-dom
import { Compartment, EditorState } from "@codemirror/state";
import { App, editorLivePreviewField } from "obsidian";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/config/settings";
import * as sourceLines from "../src/core/source-lines";
import { refreshStructuralTables, StructuralTableEditorController } from "../src/editor/table-live-preview";

afterEach(() => { vi.restoreAllMocks(); });

it.each(["source mode", "disabled setting"])("scans current Callouts only when preview is active in %s", (mode) => {
  const scan = vi.spyOn(sourceLines, "calloutRanges");
  const hostMode = new Compartment();
  const settings = { ...DEFAULT_SETTINGS, enableLivePreview: mode === "source mode" };
  const controller = new StructuralTableEditorController(new App(), () => settings);
  let state = EditorState.create({
    doc: "Prose.",
    extensions: [hostMode.of(mode === "source mode" ? [] : editorLivePreviewField), controller.createExtension()],
  });
  const edit = (text: string): void => {
    state = state.update({ changes: { from: state.doc.length, insert: text } }).state;
  };
  const setPreview = (active: boolean): void => {
    if (mode === "source mode") {
      state = state.update({ effects: hostMode.reconfigure(active ? editorLivePreviewField : []) }).state;
    } else {
      settings.enableLivePreview = active;
      state = state.update({ effects: refreshStructuralTables.of(undefined) }).state;
    }
  };
  edit(" Notes.");
  edit("\n\n> [!note]\n> A");
  expect(scan).not.toHaveBeenCalled();
  setPreview(true);
  expect(scan).toHaveBeenCalledExactlyOnceWith(state.doc.toString());
  expect(scan.mock.results[0]?.value).toHaveLength(1);
  setPreview(false);
  edit("\n\n> [!tip]\n> B");
  expect(scan).toHaveBeenCalledTimes(1);
  setPreview(true);
  expect(scan).toHaveBeenCalledTimes(2);
  expect(scan).toHaveBeenLastCalledWith(state.doc.toString());
  expect(scan.mock.results[1]?.value).toHaveLength(2);
});
