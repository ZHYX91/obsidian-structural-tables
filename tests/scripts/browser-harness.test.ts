import { describe, expect, it, vi } from "vitest";

// @ts-expect-error The browser test transport is plain ESM.
import { waitForDevToolsPort } from "../../scripts/browser-harness-runner.mjs";

const endpoint = "/devtools/browser/12345678-abcd-1234-abcd-1234567890ab";

describe("Chromium debugging endpoint readiness", () => {
  it("waits through missing, empty and partially written port/endpoint content", async () => {
    const readPortFile = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("ENOENT"))
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("35")
      .mockResolvedValueOnce("35865\n")
      .mockResolvedValueOnce("35865\n/devtools/browser/12345678-abcd")
      .mockResolvedValueOnce(`35865\r\n${endpoint}`);
    const assertRunning = vi.fn();
    const wait = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    await expect(waitForDevToolsPort({ readPortFile, assertRunning, wait })).resolves.toBe("35865");
    expect(readPortFile).toHaveBeenCalledTimes(6);
    expect(assertRunning).toHaveBeenCalledTimes(6);
    expect(wait.mock.calls).toEqual(Array.from({ length: 5 }, () => [100]));
  });

  it("rejects invalid ports and endpoint paths before accepting a ready file", async () => {
    const readPortFile = vi.fn<() => Promise<string>>()
      .mockResolvedValueOnce(`0\n${endpoint}`)
      .mockResolvedValueOnce(`65536\n${endpoint}`)
      .mockResolvedValueOnce("35865\nhttp://unrelated.example/")
      .mockResolvedValueOnce(`35865\n${endpoint}\n`);
    const wait = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    await expect(waitForDevToolsPort({ readPortFile, assertRunning: vi.fn(), wait })).resolves.toBe("35865");
    expect(readPortFile).toHaveBeenCalledTimes(4);
    expect(wait).toHaveBeenCalledTimes(3);
  });

  it("keeps the original 120 attempts and 100ms wait when no endpoint becomes ready", async () => {
    const readPortFile = vi.fn<() => Promise<string>>().mockResolvedValue("");
    const wait = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    await expect(waitForDevToolsPort({ readPortFile, assertRunning: vi.fn(), wait }))
      .rejects.toThrow("Chromium did not start its isolated debugging endpoint");
    expect(readPortFile).toHaveBeenCalledTimes(120);
    expect(wait.mock.calls).toEqual(Array.from({ length: 120 }, () => [100]));
  });

  it("preserves launch errors without reading or waiting", async () => {
    const error = new Error("spawn Chromium ENOENT");
    const readPortFile = vi.fn();
    const wait = vi.fn();
    await expect(waitForDevToolsPort({ readPortFile, assertRunning: () => { throw error; }, wait }))
      .rejects.toBe(error);
    expect(readPortFile).not.toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
  });

  it("stops polling when the browser exits while its endpoint is incomplete", async () => {
    const readPortFile = vi.fn<() => Promise<string>>().mockResolvedValue("35865\n");
    const assertRunning = vi.fn().mockImplementationOnce(() => undefined)
      .mockImplementation(() => { throw new Error("Chromium exited before opening CDP. launch diagnostics"); });
    const wait = vi.fn<(milliseconds: number) => Promise<void>>().mockResolvedValue(undefined);
    await expect(waitForDevToolsPort({ readPortFile, assertRunning, wait }))
      .rejects.toThrow("Chromium exited before opening CDP. launch diagnostics");
    expect(readPortFile).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
