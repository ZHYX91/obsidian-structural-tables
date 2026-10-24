/** A real connected child realm without enabling iframe network/script loading.
 * Happy DOM 21 disables iframe page loading; static srcdoc creates its document
 * synchronously through the public iframe API instead.
 */
export function createPopoutFrame(owner: Document = document): HTMLIFrameElement {
  const frame = owner.createElement("iframe");
  frame.srcdoc = "<!doctype html><html><head></head><body></body></html>";
  owner.body.appendChild(frame);
  const child = frame.contentDocument;
  if (child === null || child.body === null || child === owner
    || frame.contentWindow === null || frame.contentWindow === owner.defaultView) {
    frame.remove();
    throw new Error("Popout fixture requires a ready, independent document and window.");
  }
  return frame;
}
