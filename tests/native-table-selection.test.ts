import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

import { nativeTableDomSelection, type NativeTableDomSelection } from "../src/editor/native-table-selection";

function fixture(): {
  cells: HTMLTableCellElement[];
  handle: HTMLElement;
  window: Window;
} {
  const window = new Window();
  const document = window.document as unknown as Document;
  document.body.innerHTML = `
    <div class="cm-table-widget">
      <div class="table-row-drag-handle"></div>
      <table>
        <thead><tr><th>A</th><th>B</th></tr></thead>
        <tbody><tr><td>1</td><td>2</td></tr></tbody>
      </table>
    </div>`;
  return {
    cells: Array.from(document.querySelectorAll<HTMLTableCellElement>("th, td")),
    handle: document.querySelector<HTMLElement>(".table-row-drag-handle")!,
    window,
  };
}

function contextSelection(window: Window, target: HTMLElement): NativeTableDomSelection | null {
  let result: NativeTableDomSelection | null = null;
  target.addEventListener("contextmenu", (event) => {
    result = nativeTableDomSelection(event as MouseEvent);
  }, { once: true });
  target.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true }) as unknown as Event);
  return result;
}

describe("nativeTableDomSelection", () => {
  it("maps the native widget's selected DOM cells to table coordinates", () => {
    const { cells, handle, window } = fixture();
    try {
      cells[0]?.classList.add("is-selected");
      cells[2]?.classList.add("is-selected");
      expect(contextSelection(window, handle)?.coordinates).toEqual([
        { row: 0, column: 0 },
        { row: 1, column: 0 },
      ]);
    } finally {
      window.close();
    }
  });

  it("uses only the right-clicked cell when it is outside the existing selection", () => {
    const { cells, window } = fixture();
    try {
      cells[0]?.classList.add("is-selected");
      expect(contextSelection(window, cells[3]!)?.coordinates).toEqual([{ row: 1, column: 1 }]);
    } finally {
      window.close();
    }
  });
});
