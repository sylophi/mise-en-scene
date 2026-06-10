import { ObservableValue } from "../primitives/observable-value.ts";
import type { Unit } from "./unit.ts";

/**
 * A pointer to a unit that will be (or has been) instantiated: declare the ref
 * up front, hand it to `mes(Ctor, props, { ref })`, and it points at the live
 * unit once that placement runs. Cleared back to null when the unit is
 * destroyed, so holding a ref never leaves you with a stale unit, and a
 * respawn that re-fills the ref is not clobbered by the old unit's death.
 *
 * Solves the two cases plain hoisting (`const player = mes(Player, ...)`)
 * cannot: forward references (a HUD declared before the player exists) and
 * references across scene-function boundaries. Single-occupancy: the last
 * placement wins.
 */
export class UnitRef<T extends Unit = Unit> {
  /** Channel behind `current`. React HUDs subscribe via `useObservable`. */
  readonly current$ = new ObservableValue<T | null>(null);

  /** The referenced unit, or null before instantiation / after destruction. */
  get current(): T | null {
    return this.current$.get();
  }
  set current(unit: T | null) {
    this.current$.set(unit);
  }
}

/** Create an empty {@link UnitRef}. */
export function unitRef<T extends Unit = Unit>(): UnitRef<T> {
  return new UnitRef<T>();
}
