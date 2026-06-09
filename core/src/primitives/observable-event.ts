/** Unsubscribe handle returned by `addListener`. Call it to stop listening. */
export type Unsub = () => void;

/**
 * A pure event with no stored value. Listeners are called when it `fire`s.
 *
 * `T` is the payload type; defaults to `void` for bare "it happened" events.
 */
export class ObservableEvent<T = void> {
  private readonly listeners = new Set<(payload: T) => void>();

  /** Register a listener. Returns an unsubscribe function. */
  addListener(cb: (payload: T) => void): Unsub {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Notify all listeners with `payload`. */
  fire(payload: T): void {
    if (this.listeners.size === 0) return; // skip the snapshot allocation
    // Iterate a snapshot so listeners may add/remove during dispatch.
    for (const cb of Array.from(this.listeners)) cb(payload);
  }

  /** Number of active listeners. */
  get size(): number {
    return this.listeners.size;
  }

  /** Drop all listeners. */
  clear(): void {
    this.listeners.clear();
  }
}
