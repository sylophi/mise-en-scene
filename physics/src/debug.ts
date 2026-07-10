import {
  Ball,
  Capsule,
  Cuboid,
  RigidBodyType,
  type Collider,
} from "@dimforge/rapier2d-compat";
import { Vector } from "@mise/core";
import { capsule, circle, rect, type Shape } from "./shape.ts";
import type { CollisionObject2D } from "./collision-object.ts";
import type { PhysicsWorld2D } from "./world.ts";

/**
 * What a collider *is* to the simulation, for debug color coding. Derived from
 * Rapier state (sensor flag, body type), not unit classes, so colliders made
 * through the escape hatches — and future body types like a dynamic
 * `RigidBody2D` — classify correctly with no changes here.
 */
export type DebugRole = "static" | "character" | "dynamic" | "area";

/** One collider's pose and shape, as the simulation sees it right now. */
export interface DebugShape {
  /** The Rapier collider handle: a stable identity across snapshots. */
  handle: number;
  role: DebugRole;
  /** The collider's shape as plain data, in world units. */
  shape: Shape;
  /** World-space position of the shape's center. */
  position: Vector;
  /** World-space rotation in radians. */
  rotation: number;
  /** The owning unit, when the collider came from a `CollisionShape2D`. */
  unit?: CollisionObject2D;
}

/**
 * Snapshot every collider in `world` as renderer-agnostic draw data: shape,
 * world pose, and role. Poses are read back from Rapier itself — the ground
 * truth of what the simulation is colliding — so a desync between a unit and
 * its body shows up instead of hiding. Shapes Rapier knows but this package
 * does not wrap (trimeshes, polylines, ...) are skipped.
 *
 * This is the data half of debug draw; `@mise/physics-debug` renders it.
 */
export function debugSnapshot(world: PhysicsWorld2D): DebugShape[] {
  const out: DebugShape[] = [];
  world.world.forEachCollider((collider) => {
    const shape = shapeDataFor(collider);
    if (!shape) return;
    const t = collider.translation();
    out.push({
      handle: collider.handle,
      role: roleFor(collider),
      shape,
      position: new Vector(t.x, t.y),
      rotation: collider.rotation(),
      unit: world.objectFor(collider.handle),
    });
  });
  return out;
}

function roleFor(collider: Collider): DebugRole {
  if (collider.isSensor()) return "area";
  switch (collider.parent()?.bodyType()) {
    case RigidBodyType.Dynamic:
      return "dynamic";
    case RigidBodyType.KinematicPositionBased:
    case RigidBodyType.KinematicVelocityBased:
      return "character";
    default:
      return "static";
  }
}

function shapeDataFor(collider: Collider): Shape | null {
  const s = collider.shape;
  if (s instanceof Cuboid)
    return rect(s.halfExtents.x * 2, s.halfExtents.y * 2);
  if (s instanceof Ball) return circle(s.radius);
  if (s instanceof Capsule) return capsule(s.halfHeight, s.radius);
  return null;
}

/** One recorded raycast: what was asked and what came back. */
export interface DebugRay {
  origin: Vector;
  /** Normalized direction. */
  direction: Vector;
  maxDistance: number;
  /** The closest hit, or null for a miss. */
  hit: { point: Vector; normal: Vector; distance: number } | null;
  /** Engine time at the cast, in seconds (0 when cast off-tree). */
  time: number;
  /** Monotonic sequence number, stamped by the log: a stable identity. */
  seq: number;
}

/**
 * A fixed-capacity ring buffer of recent raycasts, owned by `PhysicsWorld2D`
 * as `rayLog`. Recording is opt-in: `castRay` appends only while `enabled` is
 * true (the debug overlay flips it on while mounted), so an untouched log
 * costs one boolean check per cast and nothing else.
 */
export class RayLog {
  /** Whether `castRay` records into this log. Default false. */
  enabled = false;

  private readonly capacity: number;
  private rays: DebugRay[] = [];
  private nextSeq = 0;

  constructor(capacity = 128) {
    this.capacity = capacity;
  }

  /** Append a ray, evicting the oldest past `capacity`. */
  record(ray: Omit<DebugRay, "seq">): void {
    this.rays.push({ ...ray, seq: this.nextSeq++ });
    if (this.rays.length > this.capacity) {
      this.rays.splice(0, this.rays.length - this.capacity);
    }
  }

  /** Recorded rays, oldest first. */
  list(): readonly DebugRay[] {
    return this.rays;
  }

  clear(): void {
    this.rays = [];
  }
}
