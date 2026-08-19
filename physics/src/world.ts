import {
  EventQueue,
  QueryFilterFlags,
  Ray,
  World,
} from "@dimforge/rapier2d-compat";
import { Unit, Vector, type UnitProps } from "@sylophi/mise-core";
import { assertPhysicsReady } from "./init.ts";
import { rapierShapeFor, type Shape } from "./shape.ts";
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

export interface ShapeCastHit {
  unit: CollisionObject2D;
  /**
   * The witness point: where the swept shape first touches the hit collider,
   * in world space.
   */
  point: Vector;
  /** The hit collider's surface normal at `point`, pointing back at the cast. */
  normal: Vector;
  /**
   * Distance traveled by the shape before impact (0 if it starts overlapping).
   * `origin + direction.normalize().scale(distance)` is where its center stops.
   */
  distance: number;
}

export interface QueryOptions {
  /** Only hit objects whose `layer` intersects this bitmask. Default all. */
  mask?: number;
  /** An object the query should ignore (typically the caster). */
  exclude?: CollisionObject2D;
  /** Whether the query can hit `Area2D` sensors. Default false. */
  includeAreas?: boolean;
}

/** Alias of {@link QueryOptions}: all world queries share the same options. */
export type RayCastOptions = QueryOptions;

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
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      const a = this.byCollider.get(h1);
      const b = this.byCollider.get(h2);
      if (!a || !b) return; // a side was removed mid-step
      a.reportOverlap(b, started);
      b.reportOverlap(a, started);
    });
  }

  /**
   * Cast a ray and return the closest hit, or `null`. `direction` need not be
   * normalized; `maxDistance` is in world units.
   */
  castRay(
    origin: Vector,
    direction: Vector,
    maxDistance = Number.MAX_VALUE,
    opts: QueryOptions = {},
  ): RayHit | null {
    const dir = direction.normalize();
    const ray = new Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxDistance,
      true,
      this.filterFlags(opts),
      this.filterGroups(opts),
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

  /**
   * Sweep a shape from `origin` along `direction` and return the closest hit,
   * or `null`. The shape keeps `rotation` (radians) for the whole sweep;
   * `direction` need not be normalized; `maxDistance` is in world units. A
   * cast that starts overlapping something reports it at `distance` 0.
   */
  castShape(
    shape: Shape,
    origin: Vector,
    rotation: number,
    direction: Vector,
    maxDistance = Number.MAX_VALUE,
    opts: QueryOptions = {},
  ): ShapeCastHit | null {
    const hit = this.world.castShape(
      origin,
      rotation,
      direction.normalize(),
      rapierShapeFor(shape),
      0, // register contact at touch, not at a proximity threshold
      maxDistance,
      true, // stop at penetration: initial overlaps hit at distance 0
      this.filterFlags(opts),
      this.filterGroups(opts),
      undefined,
      opts.exclude?.body ?? undefined,
    );
    if (!hit) return null;
    const unit = this.byCollider.get(hit.collider.handle);
    if (!unit) return null;
    return {
      unit,
      // witness1 is the world-space contact point on the hit collider, and
      // normal1 its world-space surface normal (witness2/normal2 are in the
      // cast shape's local space).
      point: new Vector(hit.witness1.x, hit.witness1.y),
      normal: new Vector(hit.normal1.x, hit.normal1.y),
      distance: hit.time_of_impact,
    };
  }

  /**
   * All objects containing `point`, deduplicated, in no particular order.
   * Sensors are skipped unless `includeAreas`; `mask`/`exclude` filter as in
   * {@link castRay}.
   */
  pointIntersections(
    point: Vector,
    opts: QueryOptions = {},
  ): CollisionObject2D[] {
    const found = new Set<CollisionObject2D>();
    this.world.intersectionsWithPoint(
      point,
      (collider) => {
        const unit = this.byCollider.get(collider.handle);
        if (unit) found.add(unit);
        return true;
      },
      this.filterFlags(opts),
      this.filterGroups(opts),
      undefined,
      opts.exclude?.body ?? undefined,
    );
    return [...found];
  }

  /**
   * All objects overlapping a shape placed at `position` with `rotation`
   * (radians), deduplicated, in no particular order. The one-shot overlap
   * test: explosion radii, melee arcs, spawn-clearance checks.
   */
  intersectShape(
    shape: Shape,
    position: Vector,
    rotation = 0,
    opts: QueryOptions = {},
  ): CollisionObject2D[] {
    const found = new Set<CollisionObject2D>();
    this.world.intersectionsWithShape(
      position,
      rotation,
      rapierShapeFor(shape),
      (collider) => {
        const unit = this.byCollider.get(collider.handle);
        if (unit) found.add(unit);
        return true;
      },
      this.filterFlags(opts),
      this.filterGroups(opts),
      undefined,
      opts.exclude?.body ?? undefined,
    );
    return [...found];
  }

  /** Query-filter flags shared by every world query. */
  private filterFlags(opts: QueryOptions): QueryFilterFlags | undefined {
    return opts.includeAreas ? undefined : QueryFilterFlags.EXCLUDE_SENSORS;
  }

  /** `opts.mask` packed in Rapier's interaction-group format (query side all). */
  private filterGroups(opts: QueryOptions): number | undefined {
    return opts.mask === undefined
      ? undefined
      : (0xffff << 16) | (opts.mask & 0xffff);
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
