/** Match browser task scheduling for happy-dom's automatic Selection events. */
export function installSelectionChangeTasks(ownerDocument: Document): () => void {
  const selection = ownerDocument.getSelection();
  const win = ownerDocument.defaultView;
  if (selection === null || win === null) return () => {};

  const methods = [
    "addRange", "removeRange", "removeAllRanges", "empty", "collapse", "setPosition",
    "collapseToEnd", "collapseToStart", "deleteFromDocument", "extend", "selectAllChildren", "setBaseAndExtent",
  ] as const;
  const mutable = selection as unknown as Record<typeof methods[number], (...args: unknown[]) => unknown>;
  const descriptors = methods.map((name) => [name, Object.getOwnPropertyDescriptor(selection, name)] as const);
  const dispatchDescriptor = Object.getOwnPropertyDescriptor(ownerDocument, "dispatchEvent");
  const dispatch = ownerDocument.dispatchEvent;
  let mutationDepth = 0;
  let task: number | null = null;

  // Happy-dom dispatches within Selection's range association. Browsers queue
  // one document task instead; explicit dispatchEvent calls stay synchronous.
  // https://www.w3.org/TR/selection-api/#selectionchange-event
  ownerDocument.dispatchEvent = (event) => {
    if (mutationDepth === 0 || event.type !== "selectionchange") return dispatch.call(ownerDocument, event);
    if (task === null) {
      task = win.setTimeout(() => {
        task = null;
        dispatch.call(ownerDocument, event);
      }, 0);
    }
    return true;
  };
  for (const name of methods) {
    const original = mutable[name];
    mutable[name] = (...args) => {
      mutationDepth++;
      try { return original.apply(selection, args); }
      finally { mutationDepth--; }
    };
  }

  return () => {
    if (task !== null) win.clearTimeout(task);
    task = null;
    if (dispatchDescriptor === undefined) delete (ownerDocument as Partial<Document>).dispatchEvent;
    else Object.defineProperty(ownerDocument, "dispatchEvent", dispatchDescriptor);
    for (const [name, descriptor] of descriptors) {
      if (descriptor === undefined) delete (selection as unknown as Record<string, unknown>)[name];
      else Object.defineProperty(selection, name, descriptor);
    }
  };
}
