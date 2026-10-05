/** Compare inline structure and destinations, not just link labels or cell text. */
export function contentSignature(root: Node): string {
  const parts: (string | string[])[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s/gu, "");
      if (!text) return;
      const last = parts[parts.length - 1];
      if (typeof last === "string") parts[parts.length - 1] = last + text;
      else parts.push(text);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      parts.push([element.tagName, ...["href", "data-href", "src", "alt", "rowspan", "colspan"]
        .map((attribute) => element.getAttribute(attribute) ?? "")]);
      for (const child of element.childNodes) visit(child);
      parts.push(["/" + element.tagName]);
    }
  };
  for (const child of root.childNodes) visit(child);
  return JSON.stringify(parts);
}
