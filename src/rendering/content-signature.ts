/** Compare inline structure and destinations, not just link labels or cell text. */
export function contentSignature(root: Node, lineBreaks: "markup" | "text" = "markup"): string {
  const parts: (string | string[])[] = [];
  const appendText = (text: string): void => {
    const last = parts[parts.length - 1];
    if (typeof last === "string") parts[parts.length - 1] = last + text;
    else parts.push(text);
  };
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      // Newlines between table rows are HTML pretty-printing. Text in cells,
      // inline markup and code (including a space between links) is content.
      let text = (node.textContent ?? "").replace(/\r\n|\r/gu, "\n");
      if (node.previousSibling?.nodeName === "BR") text = text.replace(/^\n+/u, "");
      if (node.nextSibling?.nodeName === "BR") text = text.replace(/\n+$/u, "");
      if (!text || (/^\s+$/u.test(text) && node.parentElement?.matches("table, thead, tbody, tfoot, tr"))) return;
      appendText(text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (element.tagName === "BR" && lineBreaks === "text") {
        appendText("\n");
        return;
      }
      parts.push([element.tagName, ...["href", "data-href", "src", "alt", "title", "rowspan", "colspan"]
        .map((attribute) => element.getAttribute(attribute) ?? "")]);
      for (const child of element.childNodes) visit(child);
      parts.push(["/" + element.tagName]);
    }
  };
  for (const child of root.childNodes) visit(child);
  return JSON.stringify(parts);
}
