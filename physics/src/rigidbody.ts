import { RigidBodyDesc, type ColliderDesc } from "@dimforge/rapier2d-compat";
import { Unit2D, Vector, type Unit } from "@mise/core";
import {
  CollisionObject2D,
  type CollisionObject2DProps,
} from "./collision-object.ts";

export interface RigidBody2DProps extends CollisionObject2DProps {
  /**
   * Density of this body's colliders; mass is density times shape area,
   * summed over all shapes. Default 1.
   */
  density?: number;
  /** Coulomb friction coefficient of the colliders. Default 0.5. */
  friction?: number;
  /** Bounciness of the colliders, 0 (dead) to 1 (elastic). Default 0. */
  restitution?: number;
  /** Linear velocity decay rate, per second. Default 0. */
  linearDamping?: number;
  /** Angular velocity decay rate, per second. Default 0. */
  angularDamping?: number;
  /** Multiplier on the world's gravity for this body. Default 1. */
  gravityScale?: number;
  /** Lock rotation entirely (top-down movers, pucks). Default false. */
  fixedRotation?: boolean;
  /** Let the solver put the body to sleep when it comes to rest. Default true. */
  canSleep?: boolean;
  /**
   * Continuous collision detection: prevents fast movers (bullets) from
   * tunneling through thin obstacles. Costs extra sweeps. Default false.
   */
  ccd?: boolean;
  /** Initial linear velocity, world units per second. */
  linearVelocity?: Vector;
  /** Initial angular velocity, radians per second (positive is clockwise). */
  angularVelocity?: number;
}

/**
 * A fully simulated body: gravity, forces, impulses, collision response.
 * Crates, debris, projectiles, ragdoll pieces.
 *
 * The *simulation* owns a dynamic body's transform: after each world step the
 * body's pose is written back to `position`/`rotation` (firing `position$` /
 * `rotation$`, so rendering follows). Don't drive it by setting `position`
 * every tick — use velocities, forces, and impulses. Setting `position` or
 * `rotation` *teleports* the body there before the next step, keeping its
 * velocities (a respawn/reset tool).
 *
 * The pose is effectively world-space: the body spawns at its unit's world
 * transform, but once live, moving an ancestor does not drag it — the local
 * transform is recomputed each step against the current parent chain. Parents
 * must be unscaled and unsheared, per the physics-units rule.
 *
 * `linearVelocity`/`angularVelocity` are plain accessors, not observables:
 * they change every step for every awake body, and rendering already follows
 * the pose write-back. Read them in `tick`.
 */
export class RigidBody2D<
  P extends RigidBody2DProps = RigidBody2DProps,
> extends CollisionObject2D<P> {
  // Latched velocities: applied on tree enter, snapshotted on exit, and the
  // read/write target while off-tree.
  private _linearVelocity: Vector;
  private _angularVelocity: number;
  // The pose the last write-back produced. `pushTransform` treats any other
  // value in the observables as an external assignment, i.e. a teleport.
  private lastWrittenPosition: Vector | null = null;
  private lastWrittenRotation = 0;
  private forcesApplied = false;

  constructor(props?: NoInfer<P>) {
    super(props);
    this._linearVelocity = props?.linearVelocity ?? Vector.zero;
    this._angularVelocity = props?.angularVelocity ?? 0;
  }

  protected createBodyDesc(): RigidBodyDesc {
    const p = this.props;
    const desc = RigidBodyDesc.dynamic()
      .setLinearDamping(p.linearDamping ?? 0)
      .setAngularDamping(p.angularDamping ?? 0)
      .setGravityScale(p.gravityScale ?? 1)
      .setCanSleep(p.canSleep ?? true)
      .setCcdEnabled(p.ccd ?? false)
      .setLinvel(this._linearVelocity.x, this._linearVelocity.y)
      .setAngvel(this._angularVelocity);
    if (p.fixedRotation) desc.lockRotations();
    return desc;
  }

  protected override configureColliderDesc(desc: ColliderDesc): void {
    const p = this.props;
    if (p.density !== undefined) desc.setDensity(p.density);
    if (p.friction !== undefined) desc.setFriction(p.friction);
    if (p.restitution !== undefined) desc.setRestitution(p.restitution);
  }

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    // The spawn pose came from the unit; only later assignments teleport.
    this.lastWrittenPosition = this.position;
    this.lastWrittenRotation = this.rotation;
  }

  override onTreeExit(parent: Unit | null): void {
    const body = this.body;
    if (body) {
      // Keep the last simulated velocities across a detach/reattach.
      const v = body.linvel();
      this._linearVelocity = new Vector(v.x, v.y);
      this._angularVelocity = body.angvel();
    }
    this.lastWrittenPosition = null;
    super.onTreeExit(parent);
  }

  /**
   * @internal The simulation owns this body's pose, so the per-step push is
   * normally a no-op. An external `position`/`rotation` assignment (anything
   * the write-back didn't produce) is pushed into Rapier as a teleport,
   * keeping velocities.
   */
  override pushTransform(): void {
    const body = this.body;
    if (!body) return;
    if (
      this.position === this.lastWrittenPosition &&
      this.rotation === this.lastWrittenRotation
    ) {
      return;
    }
    const wt = this.worldTransform;
    body.setTranslation(new Vector(wt.tx, wt.ty), true);
    body.setRotation(Math.atan2(wt.b, wt.a), true);
    this.lastWrittenPosition = this.position;
    this.lastWrittenRotation = this.rotation;
  }

  /**
   * @internal Write the simulated world pose back to the unit's local
   * transform (converted through the parent chain), and clear one-step
   * forces. Unchanged poses (sleeping bodies) fire nothing.
   */
  override postStep(): void {
    const body = this.body;
    if (!body) return;
    if (this.forcesApplied) {
      body.resetForces(false);
      body.resetTorques(false);
      this.forcesApplied = false;
    }

    const t = body.translation();
    let position = new Vector(t.x, t.y);
    let rotation = body.rotation();
    const parent = this.parent;
    if (parent instanceof Unit2D) {
      const pw = parent.worldTransform;
      position = pw.invert().apply(position);
      rotation -= Math.atan2(pw.b, pw.a);
    }
    // Assign only on change so a resting body doesn't fire observers; keep
    // the identity bookkeeping either way.
    if (!position.equals(this.position)) this.position = position;
    if (rotation !== this.rotation) this.rotation = rotation;
    this.lastWrittenPosition = this.position;
    this.lastWrittenRotation = this.rotation;
  }

  /** Linear velocity in world units per second. Settable; wakes the body. */
  get linearVelocity(): Vector {
    const body = this.body;
    if (!body) return this._linearVelocity;
    const v = body.linvel();
    return new Vector(v.x, v.y);
  }
  set linearVelocity(v: Vector) {
    this._linearVelocity = v;
    this.body?.setLinvel(v, true);
  }

  /** Angular velocity in radians per second. Settable; wakes the body. */
  get angularVelocity(): number {
    return this.body?.angvel() ?? this._angularVelocity;
  }
  set angularVelocity(v: number) {
    this._angularVelocity = v;
    this.body?.setAngvel(v, true);
  }

  /** Mass computed by the simulation from the colliders. 0 while off-tree. */
  get mass(): number {
    return this.body?.mass() ?? 0;
  }

  /** Whether the solver has put this body to sleep. */
  get sleeping(): boolean {
    return this.body?.isSleeping() ?? false;
  }

  /** Wake the body if the solver put it to sleep. */
  wakeUp(): void {
    this.body?.wakeUp();
  }

  /**
   * Apply a world-space force for the next physics step only (cleared after
   * it is integrated). Call every tick to sustain — thruster-style. No-op
   * while off-tree.
   */
  applyForce(force: Vector): void {
    const body = this.body;
    if (!body) return;
    body.addForce(force, true);
    this.forcesApplied = true;
  }

  /** Apply a torque for the next physics step only (positive is clockwise). */
  applyTorque(torque: number): void {
    const body = this.body;
    if (!body) return;
    body.addTorque(torque, true);
    this.forcesApplied = true;
  }

  /** Instantly change velocity by `impulse / mass`. World-space; wakes the body. */
  applyImpulse(impulse: Vector): void {
    this.body?.applyImpulse(impulse, true);
  }

  /** Instantly change angular velocity (positive is clockwise). */
  applyTorqueImpulse(impulse: number): void {
    this.body?.applyTorqueImpulse(impulse, true);
  }

  /**
   * Apply an impulse at a world-space point; off-center points also impart
   * spin (billiards english, edge hits).
   */
  applyImpulseAt(impulse: Vector, worldPoint: Vector): void {
    this.body?.applyImpulseAtPoint(impulse, worldPoint, true);
  }
}
