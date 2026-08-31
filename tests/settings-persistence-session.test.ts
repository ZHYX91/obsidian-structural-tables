import { describe, expect, it, vi } from "vitest";

import { SettingsPersistenceSession } from "../src/app/settings-persistence-session";
import {
  DEFAULT_SETTINGS,
  normalizeStoredSettings,
} from "../src/config/settings";

describe("SettingsPersistenceSession", () => {
  it("persists an unversioned startup migration as a detached schema-1 envelope", async () => {
    const legacy = { density: "compact", width: "full" };
    const persist = vi.fn(async () => undefined);
    const session = new SettingsPersistenceSession(normalizeStoredSettings(legacy), persist);
    const initial = session.initialSettings();
    const starting = session.start();
    initial.density = "comfortable";
    await starting;

    expect(persist).toHaveBeenCalledWith({
      schemaVersion: 1,
      settings: expect.objectContaining({ density: "compact", layout: "pane" }),
    });
    expect(session.status()).toEqual({ state: "saved", error: null });
  });

  it("saves current settings only inside schema 1", async () => {
    const persist = vi.fn(async () => undefined);
    const session = new SettingsPersistenceSession(normalizeStoredSettings({
      schemaVersion: 1,
      settings: { density: "comfortable" },
    }), persist);
    const settings = session.initialSettings();
    settings.density = "compact";
    const saving = session.save(settings);
    settings.density = "comfortable";
    await saving;

    expect(persist).toHaveBeenCalledWith({
      schemaVersion: 1,
      settings: expect.objectContaining({ density: "compact" }),
    });
  });

  it("keeps future settings read-only across startup, save, retry, and flush", async () => {
    const stored = {
      schemaVersion: 2,
      settings: {
        density: "compact",
        futureField: { preserve: true },
      },
      futureEnvelopeField: ["keep"],
    };
    const before = structuredClone(stored);
    const persist = vi.fn(async () => undefined);
    const session = new SettingsPersistenceSession(normalizeStoredSettings(stored), persist);
    const listener = vi.fn();

    expect(session.initialSettings()).toEqual(DEFAULT_SETTINGS);
    session.subscribe(listener);
    expect(listener).toHaveBeenCalledWith({
      state: "incompatible",
      error: null,
      schemaVersion: "2",
    });
    await session.start();
    await expect(session.save(session.initialSettings())).rejects.toThrow("schema 2");
    await expect(session.retry()).rejects.toThrow("schema 2");
    await session.flush();

    expect(persist).not.toHaveBeenCalled();
    expect(stored).toEqual(before);
  });
});
