import type { Unit } from "../unit/unit.ts";

/** Any unit constructor that takes a single props argument. */
type UnitCtor = new (props: never) => Unit;

/**
 * Placement builder. Instantiates `Ctor` immediately with `props` and attaches
 * `children` (already-live, treeless units) under it, returning the live but
 * treeless top unit. Lifecycle does not fire until the engine mounts the subtree
 * under its root.
 *
 * `props` is exactly the constructor's argument: fully typed and checked.
 * `children` is a separate trailing arg so `props` mirrors the constructor input.
 *
 * A "scene" is just a function `(props) => mes(...)`; embedding one = calling it.
 */
export function mes<C extends UnitCtor>(
  Ctor: C,
  props: ConstructorParameters<C>[0],
  children?: Unit[],
): InstanceType<C> {
  const unit = new Ctor(props) as InstanceType<C>;
  if (children) {
    for (const child of children) unit.addChild(child);
  }
  return unit;
}
