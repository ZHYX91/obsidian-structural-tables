/** Exercise real pointerdown/focus/click ordering rather than button.click alone. */
export function clickLikeUser(button: HTMLElement): void {
  const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperties(pointerDown, {
    button: { value: 0 },
    isPrimary: { value: true },
    pointerType: { value: "mouse" },
  });
  button.dispatchEvent(pointerDown);
  button.focus();
  button.click();
}
