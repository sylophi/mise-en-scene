import type { Unit } from "../unit/unit.ts";
import type { UnitRef } from "../unit/unit-ref.ts";

/** Any unit constructor that takes a single props argument. */
type UnitCtor = new (props: never) => Unit;

/**
 * Instantiation-time options. Deliberately separate from `props`, which is
 * exactly the constructor's argument: a ref belongs to the caller doing the
 * placing, not to the unit's own contract.
 */
export interface MesOptions<T extends Unit> {
  /** Filled with the instantiated unit; cleared again when it is destroyed. */
  ref?: UnitRef<T>;
}

/**
 * Placement builder. Instantiates `Ctor` immediately with `props` and attaches
 * `children` (already-live, treeless units) under it, returning the live but
 * treeless top unit. Lifecycle does not fire until the engine mounts the subtree
 * under its root.
 *
 * `props` is exactly the constructor's argument: fully typed and checked.
 * `children` is a separate trailing arg so `props` mirrors the constructor input.
 * `options` carries instantiation concerns (e.g. `ref`) and may be omitted
 * entirely: a third argument that is an array is taken as `children`.
 *
 * A "scene" is just a function `(props) => mes(...)`; embedding one = calling it.
 */
export function mes<C extends UnitCtor>(
  Ctor: C,
  props: ConstructorParameters<C>[0],
  children?: Unit[],
): InstanceType<C>;
export function mes<C extends UnitCtor>(
  Ctor: C,
  props: ConstructorParameters<C>[0],
  options?: MesOptions<InstanceType<C>>,
  children?: Unit[],
): InstanceType<C>;
export function mes<C extends UnitCtor>(
  Ctor: C,
  props: ConstructorParameters<C>[0],
  optionsOrChildren?: MesOptions<InstanceType<C>> | Unit[],
  maybeChildren?: Unit[],
): InstanceType<C> {
  const [options, children] = Array.isArray(optionsOrChildren)
    ? [undefined, optionsOrChildren]
    : [optionsOrChildren, maybeChildren];

  const unit = new Ctor(props) as InstanceType<C>;
  if (children) {
    for (const child of children) unit.addChild(child);
  }
  const ref = options?.ref;
  if (ref) {
    ref.current = unit;
    unit.onDestroyed.addListener(() => {
      // Identity check: a respawn may have re-filled the ref already.
      if (ref.current === unit) ref.current = null;
    });
  }
  return unit;
}
