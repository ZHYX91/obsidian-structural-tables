/**
 * Conservative browser-geometry bridge for textarea vertical arrows.
 * A mirrored text layout is only used when its measured height agrees with
 * the native textarea. Unknown, zero-sized or mixed-bidi layouts stay native.
 */
export interface VisualTextareaExit {
  x: number;
  edge: "first" | "last";
}

interface Probe {
  mirror: HTMLDivElement;
  lineHeight: number;
  measure: (offset: number) => { top: number; x: number } | null;
  close: () => void;
}

const COMPLEX_BIDI = /[\u0590-\u08ff\u200e-\u200f\u202a-\u202e\u2066-\u2069\ufb1d-\ufdff\ufe70-\ufeff]/u;

function visualProbe(editor: HTMLTextAreaElement): Probe | null {
  const owner = editor.ownerDocument;
  const win = owner.defaultView;
  if (win === null || editor.clientWidth <= 0 || editor.scrollHeight <= 0
    || editor.value.length > 1200 || COMPLEX_BIDI.test(editor.value)) return null;
  const style = win.getComputedStyle(editor);
  const lineHeight = Number.parseFloat(style.lineHeight);
  const rect = editor.getBoundingClientRect();
  if (!Number.isFinite(lineHeight) || lineHeight <= 0 || rect.width <= 0) return null;
  const mirror = owner.body.createDiv({ cls: "structural-tables-visual-text-measure" });
  mirror.setAttribute("aria-hidden", "true");
  mirror.dir = editor.dir;
  mirror.setCssProps({
    "--structural-visual-width": rect.width + "px",
    "--structural-visual-word-break": style.wordBreak,
    "--structural-visual-font-family": style.fontFamily,
    "--structural-visual-font-size": style.fontSize,
    "--structural-visual-font-weight": style.fontWeight,
    "--structural-visual-font-style": style.fontStyle,
    "--structural-visual-line-height": style.lineHeight,
    "--structural-visual-letter-spacing": style.letterSpacing,
    "--structural-visual-word-spacing": style.wordSpacing,
    "--structural-visual-text-align": style.textAlign,
    "--structural-visual-tab-size": style.tabSize,
    "--structural-visual-padding": style.padding,
    "--structural-visual-border": style.border,
    "--structural-visual-direction": style.direction,
  });
  const measure = (offset: number): { top: number; x: number } | null => {
    if (offset < 0 || offset > editor.value.length) return null;
    const mark = mirror.createEl("span", { cls: "structural-tables-visual-text-caret" });
    mark.textContent = "\u200b";
    mirror.replaceChildren(
      owner.createTextNode(editor.value.slice(0, offset)),
      mark,
      owner.createTextNode(editor.value.slice(offset)),
    );
    const markRect = mark.getBoundingClientRect();
    const box = mirror.getBoundingClientRect();
    return markRect.height > 0
      ? { top: markRect.top - box.top, x: markRect.left - box.left } : null;
  };
  mirror.textContent = editor.value + "\u200b";
  if (Math.abs(mirror.scrollHeight - editor.scrollHeight) > Math.max(3, lineHeight * 0.35)) {
    mirror.remove();
    return null;
  }
  return { mirror, lineHeight, measure, close: () => mirror.remove() };
}

/** Returns null unless current caret is on the requested outer visual line. */
export function textareaVisualExit(
  editor: HTMLTextAreaElement,
  direction: "up" | "down",
): VisualTextareaExit | null {
  if (editor.selectionStart !== editor.selectionEnd) return null;
  const probe = visualProbe(editor);
  if (probe === null) return null;
  try {
    const beginning = probe.measure(0);
    const ending = probe.measure(editor.value.length);
    const caret = probe.measure(editor.selectionStart);
    if (beginning === null || ending === null || caret === null) return null;
    const outer = direction === "up" ? beginning : ending;
    if (Math.abs(caret.top - outer.top) > probe.lineHeight * 0.4) return null;
    return { x: caret.x, edge: direction === "up" ? "last" : "first" };
  } finally {
    probe.close();
  }
}

/** Keep the preferred horizontal position on the destination's outer line. */
export function textareaCaretAtVisualEdge(
  editor: HTMLTextAreaElement,
  visual: VisualTextareaExit,
): number | null {
  const probe = visualProbe(editor);
  if (probe === null) return null;
  try {
    const outer = probe.measure(visual.edge === "first" ? 0 : editor.value.length);
    if (outer === null) return null;
    let closest: number | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset <= editor.value.length; offset += 1) {
      const code = editor.value.charCodeAt(offset);
      const before = editor.value.charCodeAt(offset - 1);
      if (offset < editor.value.length && code >= 0xdc00 && code <= 0xdfff
        && before >= 0xd800 && before <= 0xdbff) continue;
      const position = probe.measure(offset);
      if (position === null || Math.abs(position.top - outer.top) > probe.lineHeight * 0.4) continue;
      const delta = Math.abs(position.x - visual.x);
      if (delta < distance) { distance = delta; closest = offset; }
    }
    return closest;
  } finally {
    probe.close();
  }
}
