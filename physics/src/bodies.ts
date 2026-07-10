import {
  QueryFilterFlags,
  RigidBodyDesc,
  type KinematicCharacterController,
} from "@dimforge/rapier2d-compat";
import { Unit2D, Vector, type Unit } from "@mise/core";
import {
  CollisionObject2D,
  type CollisionObject2DProps,
} from "./collision-object.ts";

/**
 * An immovable body: platforms, walls, the floor. Its transform is read once
 * on tree enter; moving a live static body does not move its colliders.
 */
export class StaticBody2D<
  P extends CollisionObject2DProps = CollisionObject2DProps,
> extends CollisionObject2D<P> {
  protected createBodyDesc(): RigidBodyDesc {
    return RigidBodyDesc.fixed();
  }

  override pushTransform(): void {}
}

export interface Autostep {
  /** Highest obstacle treated as a climbable step, in world units. */
  maxHeight: number;
  /**
   * Minimum clear width on top of the step for the character to stand on.
   * Default half of `maxHeight`.
   */
  minWidth?: number;
  /** Whether dynamic bodies can be stepped onto. Default true. */
  includeDynamic?: boolean;
}

/** Rapier's default; `maxSlope` just makes it visible and tunable. */
const DEFAULT_MAX_SLOPE = Math.PI / 4;

const normalizeAutostep = (
  v: number | Autostep | null | undefined,
): Required<Autostep> | null => {
  if (v === null || v === undefined) return null;
  const config = typeof v === "number" ? { maxHeight: v } : v;
  return {
    maxHeight: config.maxHeight,
    minWidth: config.minWidth ?? config.maxHeight / 2,
    includeDynamic: config.includeDynamic ?? true,
  };
};

export interface CharacterBody2DProps extends CollisionObject2DProps {
  /**
   * Skin gap kept between the character and obstacles, in world units. Keep
   * it small relative to the character's shape. Default 0.05.
   */
  offset?: number;
  /**
   * Climb small ledges (stairs) during {@link CharacterBody2D.moveAndSlide}
   * instead of stopping at them. A number is shorthand for
   * `{ maxHeight: number }`. Off by default.
   */
  autostep?: number | Autostep;
  /**
   * Stick to the ground across small drops (downhill slopes, stair edges),
   * up to this distance in world units. Keeps `isOnFloor` from flickering on
   * descents. Rapier only snaps a move that starts grounded and ends moving
   * downward, so keep integrating gravity while on the floor. Off by default.
   */
  snapToGround?: number;
  /**
   * Steepest slope that counts as walkable floor, in radians: shallower
   * slopes can be climbed, steeper ones block (and slide under downward
   * movement). Default π/4 (45°).
   */
  maxSlope?: number;
}

/**
 * A player- or AI-driven body that collides but is not pushed by the
 * simulation: move it with {@link moveAndSlide} from `tick`. Backed by
 * Rapier's kinematic character controller, which handles sliding along
 * obstacles, slopes, and ground detection ("up" is -y, matching gravity
 * down the screen). `autostep`, `snapToGround`, and `maxSlope` are live
 * accessors as well as props; the raw `controller` remains the escape hatch
 * for anything else.
 */
export class CharacterBody2D<
  P extends CharacterBody2DProps = CharacterBody2DProps,
> extends CollisionObject2D<P> {
  private readonly offset: number;
  private _controller: KinematicCharacterController | null = null;
  private _autostep: Required<Autostep> | null;
  private _snapToGround: number | null;
  private _maxSlope: number;

  constructor(props?: NoInfer<P>) {
    super(props);
    this.offset = props?.offset ?? 0.05;
    this._autostep = normalizeAutostep(props?.autostep);
    this._snapToGround = props?.snapToGround ?? null;
    this._maxSlope = props?.maxSlope ?? DEFAULT_MAX_SLOPE;
  }

  /** The Rapier character controller, while live in a physics world. */
  get controller(): KinematicCharacterController | null {
    return this._controller;
  }

  /**
   * Autostep configuration (normalized), or `null` when disabled. Assign a
   * number (shorthand for `{ maxHeight }`), a config, or `null`; updates
   * apply immediately.
   */
  get autostep(): Required<Autostep> | null {
    return this._autostep;
  }
  set autostep(v: number | Autostep | null) {
    this._autostep = normalizeAutostep(v);
    this.applyPresets();
  }

  /** Snap-to-ground distance in world units, or `null` when disabled. */
  get snapToGround(): number | null {
    return this._snapToGround;
  }
  set snapToGround(v: number | null) {
    this._snapToGround = v;
    this.applyPresets();
  }

  /** Steepest walkable slope in radians. */
  get maxSlope(): number {
    return this._maxSlope;
  }
  set maxSlope(v: number) {
    this._maxSlope = v;
    this.applyPresets();
  }

  /**
   * Whether the last {@link moveAndSlide} ended touching the ground (any
   * surface in the -y, "up", direction of travel).
   */
  get isOnFloor(): boolean {
    return this._controller?.computedGrounded() ?? false;
  }

  protected createBodyDesc(): RigidBodyDesc {
    return RigidBodyDesc.kinematicPositionBased();
  }

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    const controller = this.physicsWorld!.world.createCharacterController(
      this.offset,
    );
    controller.setUp(new Vector(0, -1)); // y grows downward; up is -y
    this._controller = controller;
    this.applyPresets();
  }

  /** Push the stored preset values onto the live controller. */
  private applyPresets(): void {
    const c = this._controller;
    if (!c) return;
    const step = this._autostep;
    if (step) {
      c.enableAutostep(step.maxHeight, step.minWidth, step.includeDynamic);
    } else {
      c.disableAutostep();
    }
    if (this._snapToGround !== null) {
      c.enableSnapToGround(this._snapToGround);
    } else {
      c.disableSnapToGround();
    }
    // One "walkable floor" knob: climbable below the angle, sliding above it.
    // Split them via the raw controller if you ever need hysteresis.
    c.setMaxSlopeClimbAngle(this._maxSlope);
    c.setMinSlopeSlideAngle(this._maxSlope);
  }

  override onTreeExit(parent: Unit | null): void {
    if (this._controller) {
      this.physicsWorld?.world.removeCharacterController(this._controller);
      this._controller = null;
    }
    super.onTreeExit(parent);
  }

  /**
   * Move by `velocity * dt`, sliding along anything solid in the way, and
   * apply the result to `position`. Returns the world-space movement that
   * actually happened. Sensors are passed through; layer/mask filtering
   * applies. Call once per `tick`.
   */
  moveAndSlide(velocity: Vector, dt: number): Vector {
    const desired = velocity.scale(dt);
    const collider = this.colliders[0];
    if (!this._controller || !collider) {
      this.position = this.position.add(desired);
      return desired;
    }
    this._controller.computeColliderMovement(
      collider,
      desired,
      QueryFilterFlags.EXCLUDE_SENSORS,
      this.interactionGroups,
    );
    const m = this._controller.computedMovement();
    const move = new Vector(m.x, m.y);

    // The corrected movement is world-space; write it back as local position.
    const wt = this.worldTransform;
    const target = new Vector(wt.tx + move.x, wt.ty + move.y);
    const parent = this.parent;
    this.position =
      parent instanceof Unit2D
        ? parent.worldTransform.invert().apply(target)
        : target;
    return move;
  }
}
