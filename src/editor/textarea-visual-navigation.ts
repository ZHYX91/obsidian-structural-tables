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
  const mirror = owner.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  mirror.dir = editor.dir;
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.top = "0";
  mirror.style.left = "-10000px";
  mirror.style.width = rect.width + "px";
  mirror.style.height = "auto";
  mirror.style.boxSizing = "border-box";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = style.wordBreak;
  mirror.style.fontFamily = style.fontFamily;
  mirror.style.fontSize = style.fontSize;
  mirror.style.fontWeight = style.fontWeight;
  mirror.style.fontStyle = style.fontStyle;
  mirror.style.lineHeight = style.lineHeight;
  mirror.style.letterSpacing = style.letterSpacing;
  mirror.style.wordSpacing = style.wordSpacing;
  mirror.style.textAlign = style.textAlign;
  mirror.style.tabSize = style.tabSize;
  mirror.style.padding = style.padding;
  mirror.style.border = style.border;
  mirror.style.direction = style.direction;
  owner.body.appendChild(mirror);
  const measure = (offset: number): { top: number; x: number } | null => {
    if (offset < 0 || offset > editor.value.length) return null;
    const mark = owner.createElement("span");
    mark.textContent = "\u200b";
    mark.style.display = "inline-block";
    mark.style.width = "0";
    mark.style.height = "1em";
    mark.style.padding = "0";
    mark.style.border = "0";
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
