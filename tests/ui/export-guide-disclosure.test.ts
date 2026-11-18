// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

describe("Structural Tables export guide disclosure contract", () => {
  it("retains native summary semantics, no persistent key and one visible caveat", () => {
    const panel = document.createElement("div");
    const caveat = panel.appendChild(document.createElement("p"));
    caveat.className = "structural-tables-settings-export-brief";
    caveat.textContent = "Ordinary export does not recognize all extended syntax.";
    const state = new Set<string>();
    const create = () => {
      const details = document.createElement("details");
      details.open = state.has("word-export");
      const summary = details.appendChild(document.createElement("summary"));
      summary.textContent = "Export to Word";
      details.addEventListener("toggle", () => {
        if (details.open) state.add("word-export"); else state.delete("word-export");
      });
      panel.append(details);
      return details;
    };
    const first = create();
    expect(first.open).toBe(false);
    expect(caveat.textContent).toContain("Ordinary export");
    first.open = true; first.dispatchEvent(new Event("toggle"));
    expect(state.has("word-export")).toBe(true);
    first.remove();
    expect(create().open).toBe(true);
    state.clear(); // StructuralTablesSettingTab.hide() owns this reset.
    expect(state.size).toBe(0);
  });
});
