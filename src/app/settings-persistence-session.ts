import {
  cloneSettings,
  SETTINGS_SCHEMA_VERSION,
  type NormalizedStructuralTablesData,
  type PersistedStructuralTablesData,
  type StructuralTablesSettings,
} from "../config/settings";
import {
  SettingsSaveCoordinator,
  type SettingsSaveStatus,
} from "./settings-save-coordinator";
import type { SettingsTaskScheduler } from "./settings-store-queue";

export class SettingsPersistenceSession {
  private readonly coordinator: SettingsSaveCoordinator<StructuralTablesSettings> | null;
  private readonly initial: StructuralTablesSettings;
  private readonly incompatibleSchemaVersion: string | null;
  private readonly requiresMigration: boolean;
  private closed = false;

  constructor(
    loaded: NormalizedStructuralTablesData,
    persist: (data: PersistedStructuralTablesData) => Promise<void>,
    schedule?: SettingsTaskScheduler,
  ) {
    if (loaded.state === "incompatible") {
      this.coordinator = null;
      this.initial = cloneSettings(loaded.settings);
      this.incompatibleSchemaVersion = loaded.schemaVersion;
      this.requiresMigration = false;
      return;
    }
    this.coordinator = new SettingsSaveCoordinator(async (settings) => persist({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: cloneSettings(settings),
    }), schedule);
    this.initial = cloneSettings(loaded.data.settings);
    this.incompatibleSchemaVersion = null;
    this.requiresMigration = loaded.requiresMigration;
  }

  initialSettings(): StructuralTablesSettings {
    return cloneSettings(this.initial);
  }

  start(): Promise<void> {
    return this.requiresMigration
      ? this.writableCoordinator().save(this.initial)
      : Promise.resolve();
  }

  assertWritable(): void {
    if (this.closed) throw new Error("Settings session is closed.");
    if (this.incompatibleSchemaVersion == null) return;
    throw new Error(
      `Structural Tables settings schema ${this.incompatibleSchemaVersion} is incompatible and read-only.`,
    );
  }

  async save(settings: StructuralTablesSettings): Promise<void> {
    await this.writableCoordinator().save(cloneSettings(settings));
  }

  async retry(): Promise<void> {
    await this.writableCoordinator().retry();
  }

  flush(): Promise<void> {
    return this.coordinator?.flush() ?? Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return this.coordinator?.close() ?? Promise.resolve();
  }

  status(): SettingsSaveStatus {
    return this.incompatibleSchemaVersion == null
      ? this.coordinator?.snapshot() ?? { state: "saved", error: null }
      : {
        state: "incompatible",
        error: null,
        schemaVersion: this.incompatibleSchemaVersion,
      };
  }

  subscribe(listener: (status: SettingsSaveStatus) => void): () => void {
    if (this.incompatibleSchemaVersion == null) {
      return this.coordinator?.subscribe(listener) ?? (() => undefined);
    }
    listener(this.status());
    return () => undefined;
  }

  private writableCoordinator(): SettingsSaveCoordinator<StructuralTablesSettings> {
    this.assertWritable();
    if (this.coordinator == null) {
      throw new Error("Structural Tables settings persistence is unavailable.");
    }
    return this.coordinator;
  }
}
