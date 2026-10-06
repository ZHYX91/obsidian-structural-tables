// @vitest-environment happy-dom

import { expect, it } from "vitest";

import { installSelectionChangeTasks } from "./mocks/selection-events";

it("queues and coalesces automatic selection changes while explicit events remain synchronous", async () => {
  const text = document.body.appendChild(document.createTextNode("abc"));
  const events: Event[] = [];
  const listen = (event: Event) => events.push(event);
  const cancel = (event: Event) => event.preventDefault();
  document.addEventListener("selectionchange", listen);
  document.addEventListener("other-event", cancel);
  const uninstall = installSelectionChangeTasks(document);
  try {
    const selection = document.getSelection()!;
    selection.collapse(text, 0);
    selection.extend(text, 2);
    expect(selection.toString()).toBe("ab");
    expect(events).toHaveLength(0);

    const explicit = new Event("selectionchange");
    expect(document.dispatchEvent(explicit)).toBe(true);
    expect(events).toEqual([explicit]);
    expect(document.dispatchEvent(new Event("other-event", { cancelable: true }))).toBe(false);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe("selectionchange");
  } finally {
    uninstall();
    document.removeEventListener("selectionchange", listen);
    document.removeEventListener("other-event", cancel);
    text.remove();
  }
});

it("uninstalls pending automatic events and restores the original selection methods", async () => {
  const text = document.body.appendChild(document.createTextNode("abc"));
  const selection = document.getSelection()!;
  const originalCollapse = selection.collapse;
  const originalDispatch = document.dispatchEvent;
  let events = 0;
  const listen = () => { events++; };
  document.addEventListener("selectionchange", listen);
  const uninstall = installSelectionChangeTasks(document);
  try {
    selection.collapse(text, 1);
    uninstall();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(events).toBe(0);
    expect(selection.collapse).toBe(originalCollapse);
    expect(document.dispatchEvent).toBe(originalDispatch);
  } finally {
    uninstall();
    document.removeEventListener("selectionchange", listen);
    text.remove();
  }
});
