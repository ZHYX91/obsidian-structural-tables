import { describe, expect, it, vi } from "vitest";
import { SettingsSaveCoordinator } from "../src/app/settings-save-coordinator";
import { settingsStoreScheduler } from "../src/app/settings-store-queue";

describe("settings store ownership handoff", () => {
  it("drains accepted old snapshots before a freshly evaluated module can load", async () => {
    const host = {};
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let disk = "initial";
    const old = new SettingsSaveCoordinator(async (value: string) => {
      if (value === "first") await blocked;
      disk = value;
    }, settingsStoreScheduler(host));
    const first = old.save("first");
    const last = old.save("old-final");
    const closing = old.close();
    vi.resetModules();
    const reloaded = await import("../src/app/settings-store-queue");
    const next = reloaded.settingsStoreScheduler(host);
    const load = next(async () => disk);
    await expect(old.save("late")).rejects.toThrow("closed");
    await expect(old.retry()).rejects.toThrow("closed");
    release();
    await Promise.all([first, last, closing]);
    await expect(load).resolves.toBe("old-final");
    await next(async () => { disk = "new"; });
    await old.close();
    expect(disk).toBe("new");
  });

  it("reserves a final failed-save retry before the next load", async () => {
    const schedule = settingsStoreScheduler({});
    let disk = "initial";
    let calls = 0;
    const old = new SettingsSaveCoordinator(async (value: string) => {
      if (++calls === 1) throw new Error("disk busy");
      disk = value;
    }, schedule);
    const save = old.save("final");
    const closing = old.close();
    const loading = schedule(async () => disk);
    await expect(save).rejects.toThrow("disk busy");
    await closing;
    await expect(loading).resolves.toBe("final");
    expect(calls).toBe(2);
  });

  it("preserves failure truth when final retry fails", async () => {
    const old = new SettingsSaveCoordinator(async () => { throw new Error("disk unavailable"); }, settingsStoreScheduler({}));
    await expect(old.save("final")).rejects.toThrow("disk unavailable");
    await expect(old.close()).rejects.toThrow("disk unavailable");
    expect(old.snapshot().state).toBe("pending");
  });
});
