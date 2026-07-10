import type { Unsub } from "./observable-event.ts";

export interface ObservableValueOptions<T> {
  /**
   * Custom equality deciding whether a `set` is a no-op: when it returns true
   * the value is kept and nothing fires. `===`-equal sets are always a no-op,
   * with or without this. Use `structuralEquals` for immutable value objects
   * like `Vector` that expose an `equals` method.
   */
  equals?: (a: T, b: T) => boolean;
}

/**
 * Holds a value and notifies listeners when it changes.
 *
 * - Listeners fire only on the *next* change, never immediately on subscribe.
 * - `set` is a no-op (fires nothing) when the new value is `===` the current
 *   one, or equal under the `equals` option.
 */
export class ObservableValue<T> {
  private readonly listeners = new Set<(value: T) => void>();
  private readonly equals: ((a: T, b: T) => boolean) | undefined;

  constructor(
    private value: T,
    options?: ObservableValueOptions<T>,
  ) {
    this.equals = options?.equals;
  }

  /** Current value. */
  get(): T {
    return this.value;
  }

  /** Update the value; fires listeners unless it equals the current value. */
  set(value: T): void {
    if (value === this.value) return;
    if (this.equals?.(value, this.value)) return;
    this.value = value;
    if (this.listeners.size === 0) return; // skip the snapshot allocation
    // Iterate a snapshot so listeners may add/remove during dispatch.
    for (const cb of Array.from(this.listeners)) cb(value);
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

/**
 * Equality for immutable value objects: `===`, or the values are instances of
 * the same class exposing an `equals` method (like `Vector`) that returns
 * true. Pass as `{ equals: structuralEquals }` to make an `ObservableValue`
 * skip sets of structurally equal fresh instances.
 */
export function structuralEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null &&
    Object.getPrototypeOf(a) === Object.getPrototypeOf(b)
  ) {
    const eq = (a as { equals?: unknown }).equals;
    if (typeof eq === "function") {
      return (eq as (v: unknown) => boolean).call(a, b) === true;
    }
  }
  return false;
}
