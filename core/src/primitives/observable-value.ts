import type { Unsub } from "./observable.ts";

/**
 * Holds a value and notifies listeners when it changes.
 *
 * - Listeners fire only on the *next* change, never immediately on subscribe.
 * - `set` is a no-op (fires nothing) when the new value is `===` the current one.
 */
export class ObservableValue<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private value: T) {}

  /** Current value. */
  get(): T {
    return this.value;
  }

  /** Update the value; fires listeners unless it is `===` the current value. */
  set(value: T): void {
    if (value === this.value) return;
    this.value = value;
    for (const cb of [...this.listeners]) cb(value);
  }

  /** Register a listener. Returns an unsubscribe function. */
  addListener(cb: (value: T) => void): Unsub {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Number of active listeners. */
  get size(): number {
    return this.listeners.size;
  }
}
