// @vitest-environment happy-dom

import type { App, Menu } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { TableMenuOwner } from "../src/editor/table-menu-session";
import { App as MockApp, Menu as MockMenu } from "./mocks/obsidian";

const app = (): App => new MockApp() as unknown as App;
const menu = (): Menu => new MockMenu() as unknown as Menu;

describe("owned table menu sessions", () => {
  it("replaces an earlier table's menu in the same app and document", () => {
    const host = app();
    const firstOwner = new TableMenuOwner(host, document);
    const secondOwner = new TableMenuOwner(host, document);
    const firstMenu = menu();
    const firstHide = vi.spyOn(firstMenu, "hide");
    const first = firstOwner.open(firstMenu)!;
    const second = secondOwner.open(menu())!;

    expect(firstHide).toHaveBeenCalledTimes(1);
    expect(first.isCurrent()).toBe(false);
    expect(first.canActivate()).toBe(false);
    expect(first.isVisible()).toBe(false);
    expect(second.canActivate()).toBe(true);
    expect(second.isVisible()).toBe(true);
    secondOwner.dispose();
    firstOwner.dispose();
  });

  it("does not close another owner's newer menu when the old widget is destroyed", () => {
    const host = app();
    const oldOwner = new TableMenuOwner(host, document);
    const nextOwner = new TableMenuOwner(host, document);
    oldOwner.open(menu());
    const nextMenu = menu();
    const nextHide = vi.spyOn(nextMenu, "hide");
    const next = nextOwner.open(nextMenu)!;

    oldOwner.dispose();
    expect(nextHide).not.toHaveBeenCalled();
    expect(next.canActivate()).toBe(true);
    nextOwner.dispose();
    expect(nextHide).toHaveBeenCalledTimes(1);
    expect(next.isCurrent()).toBe(false);
  });

  it("keeps popout documents and separate app instances independent", () => {
    const host = app();
    const popout = document.implementation.createHTMLDocument("popout");
    const owners = [new TableMenuOwner(host, document), new TableMenuOwner(host, popout), new TableMenuOwner(app(), document)];
    const menus = owners.map(() => menu());
    const hides = menus.map((entry) => vi.spyOn(entry, "hide"));
    const sessions = owners.map((owner, index) => owner.open(menus[index]!)!);

    expect(hides.every((hide) => hide.mock.calls.length === 0)).toBe(true);
    expect(sessions.every((session) => session.canActivate())).toBe(true);
    for (const owner of owners) owner.dispose();
  });

  it("accepts the same event's click when the host hides before onClick", async () => {
    const owner = new TableMenuOwner(app(), document);
    const root = menu();
    const session = owner.open(root)!;
    const activate = vi.fn();
    root.hide();
    if (session.canActivate()) activate();

    expect(activate).toHaveBeenCalledTimes(1);
    expect(session.isVisible()).toBe(false);
    await Promise.resolve();
    expect(session.canActivate()).toBe(false);
    expect(session.isCurrent()).toBe(true);
    owner.dispose();
  });

  it("revokes an accepted async action when another menu replaces its hidden menu", async () => {
    const host = app();
    const firstOwner = new TableMenuOwner(host, document);
    const secondOwner = new TableMenuOwner(host, document);
    const root = menu();
    const first = firstOwner.open(root)!;
    let resolveRead!: (value: string) => void;
    const pending = new Promise<string>((resolve) => { resolveRead = resolve; });
    const write = vi.fn();
    root.hide();
    const accepted = pending.then((value) => { if (first.isCurrent()) write(value); });
    secondOwner.open(menu());
    resolveRead("late clipboard text");
    await accepted;

    expect(write).not.toHaveBeenCalled();
    firstOwner.dispose();
    secondOwner.dispose();
  });

  it("allows an accepted async action after normal dismissal while its owner remains current", async () => {
    const owner = new TableMenuOwner(app(), document);
    const root = menu();
    const session = owner.open(root)!;
    root.hide();
    await Promise.resolve();

    const write = vi.fn();
    if (session.isCurrent()) write("accepted clipboard result");
    expect(write).toHaveBeenCalledWith("accepted clipboard result");
    owner.dispose();
    expect(session.isCurrent()).toBe(false);
  });

  it("keeps a fallback child in the same family when its parent hides before its click", async () => {
    const host = app();
    const owner = new TableMenuOwner(host, document);
    const otherOwner = new TableMenuOwner(host, document);
    const root = menu();
    const child = menu();
    const childHide = vi.spyOn(child, "hide");
    const childShow = vi.spyOn(child, "showAtPosition");
    const session = owner.open(root)!;
    root.hide();
    session.showFallbackMenu(child, new MouseEvent("click", { clientX: 25, clientY: 40 }));
    await Promise.resolve();

    expect(childShow).toHaveBeenCalledWith({ x: 25, y: 40 }, document);
    expect(session.canActivate()).toBe(true);
    expect(session.isVisible()).toBe(true);
    otherOwner.open(menu());
    expect(childHide).toHaveBeenCalledTimes(1);
    expect(session.isCurrent()).toBe(false);
    owner.dispose();
    otherOwner.dispose();
  });

  it("closes a visible fallback parent before showing its child without dismissing the family", () => {
    const owner = new TableMenuOwner(app(), document);
    const root = menu();
    const rootHide = vi.spyOn(root, "hide");
    const child = menu();
    const session = owner.open(root)!;
    const dismissed = vi.fn();
    session.onHide(dismissed);

    session.showFallbackMenu(child, new KeyboardEvent("keydown", { key: "Enter" }));
    expect(rootHide).toHaveBeenCalledTimes(1);
    expect(dismissed).not.toHaveBeenCalled();
    expect(session.canActivate()).toBe(true);
    child.hide();
    expect(dismissed).toHaveBeenCalledTimes(1);
    owner.dispose();
  });

  it("does not show a fallback from a superseded or fully dismissed menu", async () => {
    const host = app();
    const owner = new TableMenuOwner(host, document);
    const root = menu();
    const session = owner.open(root)!;
    const child = menu();
    const show = vi.spyOn(child, "showAtPosition");
    root.hide();
    await Promise.resolve();
    session.showFallbackMenu(child, new MouseEvent("click"));
    expect(show).not.toHaveBeenCalled();

    owner.open(menu());
    session.showFallbackMenu(child, new MouseEvent("click"));
    expect(show).not.toHaveBeenCalled();
    owner.dispose();
  });

  it("disposes once, revokes callbacks, and cannot reopen a disposed widget's menu", () => {
    const owner = new TableMenuOwner(app(), document);
    const root = menu();
    const hide = vi.spyOn(root, "hide");
    const session = owner.open(root)!;
    const dismissed = vi.fn();
    session.onHide(dismissed);
    owner.dispose();
    owner.dispose();

    expect(hide).toHaveBeenCalledTimes(1);
    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(session.isCurrent()).toBe(false);
    expect(session.canActivate()).toBe(false);
    expect(owner.open(menu())).toBeNull();
  });
});
