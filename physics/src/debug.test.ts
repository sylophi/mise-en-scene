import { beforeAll, describe, expect, it } from "vitest";
import { Engine, Unit, Vector, mes } from "@mise/core";
import {
  Area2D,
  CharacterBody2D,
  CollisionShape2D,
  PhysicsWorld2D,
  RayLog,
  StaticBody2D,
  capsule,
  circle,
  debugSnapshot,
  initPhysics,
  rect,
  type DebugRay,
  type DebugShape,
} from "./index.ts";

beforeAll(() => initPhysics());

const engineWith = (scene: Unit): Engine => {
  const e = new Engine({ autoStart: false });
  e.changeScene(scene);
  return e;
};

const step = (e: Engine): void => e.advanceFixed(e.fixedStep);

const byRole = (shapes: DebugShape[], role: DebugShape["role"]): DebugShape[] =>
  shapes.filter((s) => s.role === role);

describe("debugSnapshot", () => {
  it("reports every collider with its role, shape kind, and world pose", () => {
    const wall = mes(StaticBody2D, { position: new Vector(10, 5) }, [
      mes(CollisionShape2D, { shape: rect(4, 2) }),
    ]);
    const player = mes(CharacterBody2D, { position: new Vector(-3, 0) }, [
      mes(CollisionShape2D, { shape: capsule(1.5, 1) }),
    ]);
    const zone = mes(Area2D, { position: new Vector(0, 8) }, [
      mes(CollisionShape2D, { shape: circle(3) }),
    ]);
    const world = mes(PhysicsWorld2D, {}, [wall, player, zone]);
    step(engineWith(world));

    const shapes = debugSnapshot(world);
    expect(shapes).toHaveLength(3);

    const [s] = byRole(shapes, "static");
    expect(s!.shape).toEqual(rect(4, 2));
    expect(s!.position.x).toBeCloseTo(10);
    expect(s!.position.y).toBeCloseTo(5);
    expect(s!.rotation).toBeCloseTo(0);
    expect(s!.unit).toBe(wall);

    const [c] = byRole(shapes, "character");
    expect(c!.shape).toEqual(capsule(1.5, 1));
    expect(c!.position.x).toBeCloseTo(-3);
    expect(c!.unit).toBe(player);

    const [a] = byRole(shapes, "area");
    expect(a!.shape).toEqual(circle(3));
    expect(a!.position.y).toBeCloseTo(8);
    expect(a!.unit).toBe(zone);
  });

  it("carries body rotation and a shape's local offset into the pose", () => {
    const slope = mes(
      StaticBody2D,
      { position: new Vector(5, 5), rotation: 0.3 },
      [mes(CollisionShape2D, { shape: rect(10, 1) })],
    );
    const body = mes(StaticBody2D, { position: new Vector(0, 0) }, [
      mes(CollisionShape2D, {
        shape: circle(1),
        position: new Vector(2, 0),
      }),
    ]);
    const world = mes(PhysicsWorld2D, {}, [slope, body]);
    step(engineWith(world));

    const shapes = debugSnapshot(world);
    const tilted = shapes.find((s) => s.shape.kind === "rect")!;
    expect(tilted.rotation).toBeCloseTo(0.3);
    expect(tilted.position.x).toBeCloseTo(5);

    const offset = shapes.find((s) => s.shape.kind === "circle")!;
    expect(offset.position.x).toBeCloseTo(2);
    expect(offset.position.y).toBeCloseTo(0);
  });

  it("tracks a character as it moves", () => {
    class Walker extends CharacterBody2D {
      override tick(dt: number): void {
        this.moveAndSlide(new Vector(10, 0), dt);
      }
    }
    const walker = mes(Walker, { position: Vector.zero }, [
      mes(CollisionShape2D, { shape: rect(1, 1) }),
    ]);
    const world = mes(PhysicsWorld2D, {}, [walker]);
    const e = engineWith(world);
    for (let i = 0; i < 30; i++) step(e); // ~0.5s at 10 u/s
    const [c] = debugSnapshot(world);
    // The snapshot reads simulation state, which trails the unit by the move
    // made in the walker's own tick (transforms are pushed at the world tick).
    const lag = 10 * e.fixedStep;
    expect(c!.position.x).toBeCloseTo(walker.position.x - lag, 3);
    expect(c!.position.x).toBeGreaterThan(3);
  });

  it("is empty for a world with no colliders", () => {
    const world = mes(PhysicsWorld2D, {});
    step(engineWith(world));
    expect(debugSnapshot(world)).toEqual([]);
  });
});

describe("ray recording", () => {
  const worldWithWall = (): PhysicsWorld2D => {
    const world = mes(PhysicsWorld2D, {}, [
      mes(StaticBody2D, { position: new Vector(10, 0) }, [
        mes(CollisionShape2D, { shape: rect(2, 20) }),
      ]),
    ]);
    step(engineWith(world));
    return world;
  };

  it("records nothing unless rayLog.enabled is set", () => {
    const world = worldWithWall();
    world.castRay(Vector.zero, new Vector(1, 0));
    expect(world.rayLog.list()).toEqual([]);
  });

  it("records hits and misses once enabled, with engine time", () => {
    const world = worldWithWall();
    world.rayLog.enabled = true;
    world.castRay(Vector.zero, new Vector(2, 0), 100); // hit (unnormalized dir)
    world.castRay(Vector.zero, new Vector(-1, 0), 5); // miss

    const rays = world.rayLog.list();
    expect(rays).toHaveLength(2);

    const [hit, miss] = rays as [DebugRay, DebugRay];
    expect(hit.direction.x).toBeCloseTo(1); // recorded normalized
    expect(hit.hit!.point.x).toBeCloseTo(9);
    expect(hit.hit!.distance).toBeCloseTo(9);
    expect(hit.hit!.normal.x).toBeCloseTo(-1);
    expect(hit.time).toBeCloseTo(world.engine.time);

    expect(miss.maxDistance).toBe(5);
    expect(miss.hit).toBeNull();
  });

  it("stops recording when disabled again", () => {
    const world = worldWithWall();
    world.rayLog.enabled = true;
    world.castRay(Vector.zero, new Vector(1, 0));
    world.rayLog.enabled = false;
    world.castRay(Vector.zero, new Vector(1, 0));
    expect(world.rayLog.list()).toHaveLength(1);
  });

  it("evicts the oldest rays past capacity", () => {
    const log = new RayLog(3);
    const ray = (n: number): Omit<DebugRay, "seq"> => ({
      origin: new Vector(n, 0),
      direction: new Vector(1, 0),
      maxDistance: 1,
      hit: null,
      time: n,
    });
    for (let n = 0; n < 5; n++) log.record(ray(n));
    expect(log.list().map((r) => r.time)).toEqual([2, 3, 4]);
    log.clear();
    expect(log.list()).toEqual([]);
  });
});
