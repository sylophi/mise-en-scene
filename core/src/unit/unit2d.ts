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
export class Unit2D<P extends Unit2DProps = Unit2DProps> extends Unit<P> {
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

  // Lazily filled matrix caches; null = dirty. Invariant: a dirty world cache
  // implies every dependent descendant's world cache is dirty too (reads only
  // ever fill a contiguous ancestor path; invalidation descends), so
  // `_invalidateWorld` can prune at the first already-dirty unit.
  private _localMatrix: Matrix2D | null = null;
  private _worldMatrix: Matrix2D | null = null;

  constructor(props?: NoInfer<P>) {
    super(props);
    this.position$ = new ObservableValue(props?.position ?? Vector.zero);
    this.rotation$ = new ObservableValue(props?.rotation ?? 0);
    this.scale$ = new ObservableValue(props?.scale ?? Vector.one);
    // Registered before any game listener can be, so by the time user code
    // observes a local change, `worldTransform` already reflects it.
    const invalidate = (): void => this._invalidateTransform();
    this.position$.addListener(invalidate);
    this.rotation$.addListener(invalidate);
    this.scale$.addListener(invalidate);
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
    return (this._localMatrix ??= Matrix2D.fromTRS(
      this.position,
      this.rotation,
      this.scale,
    ));
  }

  /**
   * Absolute transform as a 2x3 affine matrix, composed by matrix
   * multiplication up *contiguous* `Unit2D` ancestors: exact even where
   * non-uniform ancestor scale meets rotation (shear), which a TRS triple
   * cannot represent. Inheritance breaks at the first non-`Unit2D` ancestor:
   * a plain `Unit` resets the origin, so its `Unit2D` children form a fresh
   * subtree.
   *
   * Lazy-cached: composed on first read, then returned by reference (matrices
   * are immutable) until a local change or reparent anywhere in the chain
   * invalidates this unit and its dependent descendants.
   */
  get worldTransform(): Matrix2D {
    if (this._worldMatrix) return this._worldMatrix;
    const parent = this.parent;
    return (this._worldMatrix =
      parent instanceof Unit2D
        ? parent.worldTransform.multiply(this.localMatrix)
        : this.localMatrix);
  }

  /** A local transform change: both matrices are stale, here and below. */
  private _invalidateTransform(): void {
    this._localMatrix = null;
    this._invalidateWorld();
  }

  /**
   * Drop this unit's cached world matrix and every dependent descendant's.
   * Descends only through contiguous `Unit2D` children: a non-`Unit2D` child
   * breaks the chain, so its `Unit2D` descendants do not depend on this unit.
   */
  private _invalidateWorld(): void {
    if (this._worldMatrix === null) return; // subtree already dirty (invariant)
    this._worldMatrix = null;
    for (const c of this.children) {
      if (c instanceof Unit2D) c._invalidateWorld();
    }
  }

  protected override parentChanged(parent: Unit | null): void {
    super.parentChanged(parent);
    // A new (or no) parent is a new ancestor chain: the local matrix holds,
    // but the world matrix is stale here and in every dependent descendant.
    this._invalidateWorld();
  }
}
