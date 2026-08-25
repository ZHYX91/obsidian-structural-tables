import { describe, expect, it, vi } from "vitest";

import { SettingsSaveCoordinator } from "../src/app/settings-save-coordinator";

function deferred() {
  let reject!: (error: unknown) => void;
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

describe("SettingsSaveCoordinator", () => {
  it("serializes immutable snapshots", async () => {
    const first = deferred();
    const snapshots: Array<{ density: string }> = [];
    const persist = vi.fn(async (snapshot: { density: string }) => {
      snapshots.push(snapshot);
      if (snapshot.density === "comfortable") await first.promise;
    });
    const coordinator = new SettingsSaveCoordinator(persist);
    const settings = { density: "comfortable" };

    const firstSave = coordinator.save(settings);
    settings.density = "compact";
    const secondSave = coordinator.save(settings);
    settings.density = "changed again";

    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    first.resolve();
    await Promise.all([firstSave, secondSave]);
    expect(snapshots).toEqual([
      { density: "comfortable" },
      { density: "compact" },
    ]);
  });

  it("continues after an earlier save fails", async () => {
    const first = deferred();
    const persist = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(undefined);
    const coordinator = new SettingsSaveCoordinator<{ density: string }>(persist);

    const failed = coordinator.save({ density: "comfortable" });
    const next = coordinator.save({ density: "compact" });
    first.reject(new Error("disk unavailable"));

    await expect(failed).rejects.toThrow("disk unavailable");
    await expect(next).resolves.toBeUndefined();
    expect(persist).toHaveBeenNthCalledWith(2, { density: "compact" });
  });
});
