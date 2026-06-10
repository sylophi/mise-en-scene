import { Vector } from "../primitives/vector.ts";
import { Matrix2D } from "../primitives/matrix2d.ts";
import { ObservableValue } from "../primitives/observable-value.ts";
import { Unit, type UnitProps } from "./unit.ts";

/** A local 2D transform: position, rotation (radians), and per-axis scale. */
export interface Transform {
  position: Vector;
  rotation: number;
  scale: Vector;
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
  /** Local position, relative to the parent. Assignment fires `position$`. */
  readonly position$: ObservableValue<Vector>;
  get position(): Vector {
    return this.position$.get();
  }
  set position(v: Vector) {
    this.position$.set(v);
  }

  /** Local rotation in radians. Compound assignment works: `rotation += dt`. */
  readonly rotation$: ObservableValue<number>;
  get rotation(): number {
    return this.rotation$.get();
  }
  set rotation(v: number) {
    this.rotation$.set(v);
  }

  /** Local per-axis scale. Assignment fires `scale$`. */
  readonly scale$: ObservableValue<Vector>;
  get scale(): Vector {
    return this.scale$.get();
  }
  set scale(v: Vector) {
    this.scale$.set(v);
  }

  constructor(props: Unit2DProps = {}) {
    super(props);
    this.position$ = new ObservableValue(props.position ?? Vector.zero);
    this.rotation$ = new ObservableValue(props.rotation ?? 0);
    this.scale$ = new ObservableValue(props.scale ?? Vector.one);
  }

  /** This unit's local transform as a plain object. */
  get localTransform(): Transform {
    return {
      position: this.position,
      rotation: this.rotation,
      scale: this.scale,
    };
  }

  /** This unit's local transform as a matrix (translate · rotate · scale). */
  get localMatrix(): Matrix2D {
    return Matrix2D.fromTRS(this.position, this.rotation, this.scale);
  }

  /**
   * Absolute transform as a 2x3 affine matrix, composed by matrix
   * multiplication up *contiguous* `Unit2D` ancestors: exact even where
   * non-uniform ancestor scale meets rotation (shear), which a TRS triple
   * cannot represent. Inheritance breaks at the first non-`Unit2D` ancestor:
   * a plain `Unit` resets the origin, so its `Unit2D` children form a fresh
   * subtree. (v1: no caching, no dirty flags.)
   */
  get worldTransform(): Matrix2D {
    const parent = this.parent;
    if (parent instanceof Unit2D) {
      return parent.worldTransform.multiply(this.localMatrix);
    }
    return this.localMatrix;
  }
}
