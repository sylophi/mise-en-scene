import { Vector } from "../primitives/vector.ts";
import { ObservableValue } from "../primitives/observable-value.ts";
import { Unit, type UnitProps } from "./unit.ts";

/** A resolved 2D transform: position, rotation (radians), and per-axis scale. */
export interface Transform {
  position: Vector;
  rotation: number;
  scale: Vector;
}

/** Compose a parent world transform with a child's local transform. */
export function composeTransform(parent: Transform, local: Transform): Transform {
  return {
    // child local point: scale, then rotate, then translate into the parent frame
    position: parent.position.add(local.position.mul(parent.scale).rotate(parent.rotation)),
    rotation: parent.rotation + local.rotation,
    scale: parent.scale.mul(local.scale),
  };
}

export interface Unit2DProps extends UnitProps {
  position?: Vector;
  rotation?: number;
  scale?: Vector;
}

/**
 * A unit with a place in 2D space. May be invisible (trigger zones, waypoints,
 * spawn points). The stored transform is *local* (relative to the parent);
 * `worldTransform` composes up the chain.
 */
export class Unit2D extends Unit {
  readonly position: ObservableValue<Vector>;
  readonly rotation: ObservableValue<number>;
  readonly scale: ObservableValue<Vector>;

  constructor(props: Unit2DProps = {}) {
    super(props);
    this.position = new ObservableValue(props.position ?? Vector.zero);
    this.rotation = new ObservableValue(props.rotation ?? 0);
    this.scale = new ObservableValue(props.scale ?? Vector.one);
  }

  /** This unit's local transform as a plain object. */
  get localTransform(): Transform {
    return {
      position: this.position.get(),
      rotation: this.rotation.get(),
      scale: this.scale.get(),
    };
  }

  /**
   * Absolute transform, computed on read by walking up *contiguous* `Unit2D`
   * ancestors. Inheritance breaks at the first non-`Unit2D` ancestor — a plain
   * `Unit` resets the origin, so its `Unit2D` children form a fresh subtree.
   * (v1: no caching, no dirty flags.)
   */
  get worldTransform(): Transform {
    const parent = this.parent;
    if (parent instanceof Unit2D) {
      return composeTransform(parent.worldTransform, this.localTransform);
    }
    return this.localTransform;
  }
}
