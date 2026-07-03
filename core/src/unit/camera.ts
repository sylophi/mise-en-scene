import { ObservableValue } from "../primitives/observable-value.ts";
import { Vector } from "../primitives/vector.ts";
import { Matrix2D } from "../primitives/matrix2d.ts";
import { clamp, damp } from "../primitives/math.ts";
import { Unit2D, type Unit2DProps } from "./unit2d.ts";
import type { Unit } from "./unit.ts";

/**
 * World-space bounds the view rectangle is kept inside. Each side is optional;
 * omitted sides are unbounded. When a span is narrower than the view, the view
 * centers on it. Measured against `width`/`height` in world units: camera
 * rotation and scale are ignored by limit math (keep limited cameras unrotated
 * and unscaled).
 */
export interface CameraLimits {
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
}

export interface CameraProps extends Unit2DProps {
  /** Logical viewport width in camera units (a design resolution). */
  width: number;
  /** Logical viewport height in camera units. */
  height: number;
  /**
   * Claim `engine.activeCamera` on tree enter even if another camera is
   * active. Regardless of this flag, a camera entering the tree claims the
   * slot when no camera is active, and an exiting active camera releases it.
   */
  active?: boolean;
  /** Initial view offset. See `offset`. */
  offset?: Vector;
  /** Initial smoothing rate. See `smoothing`. */
  smoothing?: number;
  /** Initial view limits. See `limits`. */
  limits?: CameraLimits;
}

/** Smoothed view snaps to its target once within this distance (world units). */
const SNAP_EPSILON = 1e-4;

/**
 * Defines the logical coordinate space the world is viewed through. A `Unit2D`,
 * so it can be parented, moved, and animated like anything else; its position
 * is the *center* of the view.
 *
 * Rendering applies the inverse of the camera's *view* transform to the scene,
 * then normalizes by `width`/`height`. The render surface locks to this aspect
 * ratio. Coordinate space is origin top-left, y-down.
 *
 * The view transform is the world transform with its translation replaced by
 * the resolved view center: the camera's world position, smoothed
 * (`smoothing`), kept inside `limits`, then displaced by `offset`. With none
 * of those set it equals the world transform.
 *
 * Only one camera is active at a time; the active one is held by the engine
 * (claimed/released automatically on tree enter/exit).
 */
export class Camera<P extends CameraProps = CameraProps> extends Unit2D<P> {
  /** Logical viewport width in camera units. Assignment fires `width$`. */
  readonly width$: ObservableValue<number>;
  get width(): number {
    return this.width$.get();
  }
  set width(v: number) {
    this.width$.set(v);
  }

  /** Logical viewport height in camera units. Assignment fires `height$`. */
  readonly height$: ObservableValue<number>;
  get height(): number {
    return this.height$.get();
  }
  set height(v: number) {
    this.height$.set(v);
  }

  /**
   * Additive world-space displacement of the view, applied after smoothing
   * and limits (both ignore it). The seam for screen shake and look-ahead:
   * write jitter here and never touch `position`. Assignment fires `offset$`.
   */
  readonly offset$: ObservableValue<Vector>;
  get offset(): Vector {
    return this.offset$.get();
  }
  set offset(v: Vector) {
    this.offset$.set(v);
  }

  /**
   * Framerate-independent approach rate of the view toward the camera's
   * position, per second (higher is snappier; 0 disables). Advances on the
   * fixed clock while this camera is active. Assignment fires `smoothing$`.
   */
  readonly smoothing$: ObservableValue<number>;
  get smoothing(): number {
    return this.smoothing$.get();
  }
  set smoothing(v: number) {
    this.smoothing$.set(v);
  }

  /** World-space bounds for the view rectangle. Assignment fires `limits$`. */
  readonly limits$: ObservableValue<CameraLimits | null>;
  get limits(): CameraLimits | null {
    return this.limits$.get();
  }
  set limits(v: CameraLimits | null) {
    this.limits$.set(v);
  }

  /**
   * Resolved view center in world coordinates (smoothing, limits, and offset
   * applied). Renderers subscribe to this; it fires as the smoothed view
   * moves even when `position` does not.
   */
  readonly viewCenter$: ObservableValue<Vector>;
  get viewCenter(): Vector {
    return this.viewCenter$.get();
  }

  /** Smoothed view position; null = snap to target on the next advance. */
  private _viewPos: Vector | null = null;

  constructor(props: NoInfer<P>) {
    super(props);
    this.width$ = new ObservableValue(props.width);
    this.height$ = new ObservableValue(props.height);
    this.offset$ = new ObservableValue(props.offset ?? Vector.zero);
    this.smoothing$ = new ObservableValue(props.smoothing ?? 0);
    this.limits$ = new ObservableValue<CameraLimits | null>(
      props.limits ?? null,
    );
    this.viewCenter$ = new ObservableValue(this.resolveViewCenter());
    // Re-resolve when view inputs change outside the fixed-step advance.
    const republish = (): void => this.publishView();
    this.offset$.addListener(republish);
    this.limits$.addListener(republish);
    this.width$.addListener(republish);
    this.height$.addListener(republish);
  }

  /** Aspect ratio (width / height) the render surface should lock to. */
  get aspect(): number {
    return this.width / this.height;
  }

  /**
   * The transform rendering inverts: the world transform with its translation
   * replaced by the resolved view center.
   */
  get viewTransform(): Matrix2D {
    const m = this.worldTransform;
    const c = this.resolveViewCenter(m);
    return new Matrix2D(m.a, m.b, m.c, m.d, c.x, c.y);
  }

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    if (this.props.active || this.engine.activeCamera === null) {
      this.engine.activeCamera = this;
    }
    this._viewPos = null; // snap, never lerp in from a stale position
    this.publishView();
  }

  override onTreeExit(parent: Unit | null): void {
    if (this.engine.activeCamera === this) this.engine.activeCamera = null;
    this._viewPos = null;
    super.onTreeExit(parent);
  }

  /**
   * Advance the smoothed view by `dt` toward the camera's world position.
   * Called by the engine each fixed step for the active camera; not game API.
   */
  advanceView(dt: number): void {
    const m = this.worldTransform;
    // Damp toward the *clamped* target so the view eases into a limit instead
    // of chasing an unreachable point and hitting the bound at full speed.
    const target = this.clampToLimits(new Vector(m.tx, m.ty));
    const rate = this.smoothing;
    let next = target;
    if (rate > 0 && this._viewPos) {
      next = new Vector(
        damp(this._viewPos.x, target.x, rate, dt),
        damp(this._viewPos.y, target.y, rate, dt),
      );
      // Snap once converged so `viewCenter$` stops firing on a still camera.
      if (
        Math.abs(next.x - target.x) < SNAP_EPSILON &&
        Math.abs(next.y - target.y) < SNAP_EPSILON
      ) {
        next = target;
      }
    }
    this._viewPos = next;
    this.publishView();
  }

  private publishView(): void {
    const center = this.resolveViewCenter();
    if (!center.equals(this.viewCenter$.get())) this.viewCenter$.set(center);
  }

  private resolveViewCenter(m: Matrix2D = this.worldTransform): Vector {
    const base =
      this.smoothing > 0 && this._viewPos
        ? this._viewPos
        : new Vector(m.tx, m.ty);
    return this.clampToLimits(base).add(this.offset);
  }

  private clampToLimits(c: Vector): Vector {
    const lim = this.limits;
    if (!lim) return c;
    const hw = this.width / 2;
    const hh = this.height / 2;
    // A side pair narrower than the view centers on its span (both finite then).
    const minX = lim.left !== undefined ? lim.left + hw : -Infinity;
    const maxX = lim.right !== undefined ? lim.right - hw : Infinity;
    const minY = lim.top !== undefined ? lim.top + hh : -Infinity;
    const maxY = lim.bottom !== undefined ? lim.bottom - hh : Infinity;
    const x = minX > maxX ? (minX + maxX) / 2 : clamp(c.x, minX, maxX);
    const y = minY > maxY ? (minY + maxY) / 2 : clamp(c.y, minY, maxY);
    return x === c.x && y === c.y ? c : new Vector(x, y);
  }
}
