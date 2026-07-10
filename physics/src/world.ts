import {
  EventQueue,
  QueryFilterFlags,
  Ray,
  World,
} from "@dimforge/rapier2d-compat";
import { Unit, Vector, type UnitProps } from "@mise/core";
import { assertPhysicsReady } from "./init.ts";
import type { CollisionObject2D } from "./collision-object.ts";

export interface PhysicsWorld2DProps extends UnitProps {
  /**
   * Constant acceleration applied to dynamic bodies, in world units per
   * second squared. y grows downward, so a platformer wants positive y.
   * Default zero (top-down games need no gravity).
   */
  gravity?: Vector;
}

export interface RayHit {
  unit: CollisionObject2D;
  /** The point where the ray entered the collider, in world space. */
  point: Vector;
  /** Surface normal at the hit point. */
  normal: Vector;
  /** Distance from the ray origin to the hit point. */
  distance: number;
}

export interface RayCastOptions {
  /** Only hit objects whose `layer` intersects this bitmask. Default all. */
  mask?: number;
  /** An object the ray should pass through (typically the caster). */
  exclude?: CollisionObject2D;
  /** Whether the ray can hit `Area2D` sensors. Default false. */
  includeAreas?: boolean;
}

/**
 * Owns and steps a Rapier physics world. Bodies, areas, and shapes register
 * with their nearest `PhysicsWorld2D` ancestor when they enter the tree, so a
 * scene rooted in one tears its whole simulation down on `changeScene`.
 *
 * Each tick: unit transforms are pushed into the simulation, the world steps
 * once at the fixed dt, and overlap events are drained to `Area2D` listeners.
 * This runs before descendant ticks (the engine walks parent-first), so game
 * logic always sees this frame's collision state.
 */
export class PhysicsWorld2D<
  P extends PhysicsWorld2DProps = PhysicsWorld2DProps,
> extends Unit<P> {
  /** The underlying Rapier world, for anything this wrapper doesn't expose. */
  readonly world: World;

  private readonly eventQueue: EventQueue;
  private readonly objects = new Set<CollisionObject2D>();
  private readonly byCollider = new Map<number, CollisionObject2D>();

  constructor(props?: NoInfer<P>) {
    super(props);
    assertPhysicsReady();
    this.world = new World(props?.gravity ?? Vector.zero);
    this.eventQueue = new EventQueue(true);
  }

  override tick(dt: number): void {
    for (const obj of this.objects) obj.pushTransform();
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
    // Write simulated poses back (dynamic bodies) before events fire, so
    // listeners see this step's positions.
    for (const obj of this.objects) obj.postStep();
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const a = this.byCollider.get(h1);
      const b = this.byCollider.get(h2);
      if (!a || !b) return; // a side was removed mid-step
      if (a.isSensor || b.isSensor) {
        a.reportOverlap(b, started);
        b.reportOverlap(a, started);
      } else {
        this.reportContact(a, b, h1, h2, started);
      }
    });
  }

  /** Fire contact events on both units of a solid pair. */
  private reportContact(
    a: CollisionObject2D,
    b: CollisionObject2D,
    h1: number,
    h2: number,
    started: boolean,
  ): void {
    const aEvent = started ? a.onContactStarted : a.onContactEnded;
    const bEvent = started ? b.onContactStarted : b.onContactEnded;
    if (aEvent.size === 0 && bEvent.size === 0) return;

    // Contact details exist only while the pair touches; ended events carry
    // nulls. Fetched lazily: only when someone is listening.
    const { point, normal } = started
      ? this.contactInfo(h1, h2)
      : { point: null, normal: null };
    aEvent.fire({ other: b, point, normal });
    bEvent.fire({ other: a, point, normal: normal ? normal.scale(-1) : null });
  }

  /**
   * Read the first contact manifold of a touching pair: a representative
   * world-space point and the normal oriented from `h1`'s object toward
   * `h2`'s.
   */
  private contactInfo(
    h1: number,
    h2: number,
  ): { point: Vector | null; normal: Vector | null } {
    let point: Vector | null = null;
    let normal: Vector | null = null;
    const c1 = this.world.getCollider(h1);
    const c2 = this.world.getCollider(h2);
    if (c1 && c2) {
      this.world.contactPair(c1, c2, (manifold, flipped) => {
        const n = manifold.normal();
        normal = flipped ? new Vector(-n.x, -n.y) : new Vector(n.x, n.y);
        if (manifold.numSolverContacts() > 0) {
          const p = manifold.solverContactPoint(0);
          point = new Vector(p.x, p.y);
        }
      });
    }
    return { point, normal };
  }

  /**
   * Cast a ray and return the closest hit, or `null`. `direction` need not be
   * normalized; `maxDistance` is in world units.
   */
  castRay(
    origin: Vector,
    direction: Vector,
    maxDistance = Number.MAX_VALUE,
    opts: RayCastOptions = {},
  ): RayHit | null {
    const dir = direction.normalize();
    const ray = new Ray(origin, dir);
    const groups =
      opts.mask === undefined
        ? undefined
        : (0xffff << 16) | (opts.mask & 0xffff);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      opts.includeAreas ? undefined : QueryFilterFlags.EXCLUDE_SENSORS,
      groups,
      undefined,
      opts.exclude?.body ?? undefined,
    );
    if (!hit) return null;
    const unit = this.byCollider.get(hit.collider.handle);
    if (!unit) return null;
    return {
      unit,
      point: origin.add(dir.scale(hit.timeOfImpact)),
      normal: new Vector(hit.normal.x, hit.normal.y),
      distance: hit.timeOfImpact,
    };
  }

  override onDestroy(): void {
    this.eventQueue.free();
    this.world.free();
  }

  /** @internal Bodies and areas register here on tree enter. */
  register(obj: CollisionObject2D): void {
    this.objects.add(obj);
  }

  /** @internal */
  unregister(obj: CollisionObject2D): void {
    this.objects.delete(obj);
  }

  /** @internal Maps a Rapier collider handle back to its owning unit. */
  mapCollider(handle: number, obj: CollisionObject2D): void {
    this.byCollider.set(handle, obj);
  }

  /** @internal */
  unmapCollider(handle: number): void {
    this.byCollider.delete(handle);
  }

  /** @internal Resolve a collider handle to its unit, if registered. */
  objectFor(handle: number): CollisionObject2D | undefined {
    return this.byCollider.get(handle);
  }
}
