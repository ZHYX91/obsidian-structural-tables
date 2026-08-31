export type WritableSettingsSaveState = "saved" | "saving" | "pending";

export interface WritableSettingsSaveStatus {
  readonly state: WritableSettingsSaveState;
  readonly error: unknown;
}

export interface IncompatibleSettingsSaveStatus {
  readonly state: "incompatible";
  readonly error: null;
  readonly schemaVersion: string;
}

export type SettingsSaveStatus = WritableSettingsSaveStatus | IncompatibleSettingsSaveStatus;

export class SettingsSaveCoordinator<T> {
  private readonly listeners = new Set<(status: SettingsSaveStatus) => void>();
  private failedSnapshot: T | null = null;
  private latestRevision = 0;
  private status: WritableSettingsSaveStatus = { state: "saved", error: null };
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly persist: (snapshot: T) => Promise<void>) {}

  save(value: T): Promise<void> {
    const snapshot = structuredClone(value);
    const revision = ++this.latestRevision;
    this.setStatus({ state: "saving", error: null });
    const operation = this.tail.then(() => this.persist(snapshot));
    this.tail = operation.then(
      () => this.finishSave(revision),
      (error: unknown) => this.failSave(revision, snapshot, error),
    );
    return operation;
  }

  retry(): Promise<void> {
    return this.failedSnapshot == null
      ? Promise.resolve()
      : this.save(this.failedSnapshot);
  }

  async flush(): Promise<void> {
    while (true) {
      const pending = this.tail;
      await pending;
      if (pending !== this.tail) continue;
      if (this.failedSnapshot != null) await this.save(this.failedSnapshot);
      return;
    }
  }

  snapshot(): SettingsSaveStatus {
    return this.status;
  }

  subscribe(listener: (status: SettingsSaveStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private finishSave(revision: number): void {
    if (revision !== this.latestRevision) return;
    this.failedSnapshot = null;
    this.setStatus({ state: "saved", error: null });
  }

  private failSave(revision: number, snapshot: T, error: unknown): void {
    if (revision !== this.latestRevision) return;
    this.failedSnapshot = structuredClone(snapshot);
    this.setStatus({ state: "pending", error });
  }

  private setStatus(status: WritableSettingsSaveStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}
