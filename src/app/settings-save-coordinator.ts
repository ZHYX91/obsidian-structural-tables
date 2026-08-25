export class SettingsSaveCoordinator<T> {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly persist: (snapshot: T) => Promise<void>) {}

  save(value: T): Promise<void> {
    const snapshot = structuredClone(value);
    const pending = this.tail.then(
      () => this.persist(snapshot),
      () => this.persist(snapshot),
    );
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
}
