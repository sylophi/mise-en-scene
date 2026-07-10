import { beforeAll, describe, expect, it } from "vitest";
import { Engine, Unit, Vector, mes } from "@mise/core";
import {
  Area2D,
  CharacterBody2D,
  CollisionShape2D,
  PhysicsWorld2D,
  StaticBody2D,
  circle,
  initPhysics,
  rect,
} from "./index.ts";

beforeAll(() => initPhysics());

const engineWith = (scene: Unit): Engine => {
  const e = new Engine({ autoStart: false });
  e.changeScene(scene);
  return e;
};

const steps = (e: Engine, n: number): void => {
  for (let i = 0; i < n; i++) e.advanceFixed(e.fixedStep);
};

/** A 2-wide, 20-tall wall centered at x=10: solid over x in [9, 11]. */
const wall = (props: { layer?: number } = {}) =>
  mes(StaticBody2D, { position: new Vector(10, 0), ...props }, [
    mes(CollisionShape2D, { shape: rect(2, 20) }),
  ]);

describe("castShape", () => {
  it("returns the closest hit with witness point, normal, and distance", () => {
    const target = wall();
    const world = mes(PhysicsWorld2D, {}, [target]);
    const e = engineWith(world);
    steps(e, 1); // queries see colliders after the first step
    // A radius-1 circle travels 8 before touching the wall face at x=9
    // (a ray from the same origin would travel 9).
    const hit = world.castShape(circle(1), Vector.zero, 0, new Vector(1, 0));
    expect(hit).not.toBeNull();
    expect(hit!.unit).toBe(target);
    expect(hit!.distance).toBeCloseTo(8);
    expect(hit!.point.x).toBeCloseTo(9); // witness point on the wall face
    expect(hit!.point.y).toBeCloseTo(0);
    expect(hit!.normal.x).toBeCloseTo(-1);
  });

  it("accounts for the swept shape's rotation", () => {
    const world = mes(PhysicsWorld2D, {}, [wall()]);
    const e = engineWith(world);
    steps(e, 1);
    // A 4x1 bar: swept flat it reaches 2 ahead of its center, swept upright
    // only 0.5, so the upright cast travels 1.5 further before touching.
    const flat = world.castShape(rect(4, 1), Vector.zero, 0, new Vector(1, 0));
    const upright = world.castShape(
      rect(4, 1),
      Vector.zero,
      Math.PI / 2,
      new Vector(1, 0),
    );
    expect(flat!.distance).toBeCloseTo(7);
    expect(upright!.distance).toBeCloseTo(8.5);
  });

  it("misses out of range and respects mask and exclude", () => {
    const target = wall({ layer: 0b10 });
    const caster = mes(CharacterBody2D, { position: Vector.zero }, [
      mes(CollisionShape2D, { shape: rect(2, 2) }),
    ]);
    const world = mes(PhysicsWorld2D, {}, [target, caster]);
    const e = engineWith(world);
    steps(e, 1);

    const opts = { exclude: caster };
    const hit = world.castShape(
      circle(1),
      Vector.zero,
      0,
      new Vector(1, 0),
      100,
      opts,
    );
    expect(hit!.unit).toBe(target); // passed through the caster
    const short = world.castShape(
      circle(1),
      Vector.zero,
      0,
      new Vector(1, 0),
      5,
      opts,
    );
    expect(short).toBeNull();
    const masked = world.castShape(
      circle(1),
      Vector.zero,
      0,
      new Vector(1, 0),
      100,
      { ...opts, mask: 0b01 },
    );
    expect(masked).toBeNull();
  });

  it("reports a cast starting in overlap at distance 0", () => {
    const target = wall();
    const world = mes(PhysicsWorld2D, {}, [target]);
    const e = engineWith(world);
    steps(e, 1);
    const hit = world.castShape(
      circle(1),
      new Vector(10, 0),
      0,
      new Vector(1, 0),
    );
    expect(hit!.unit).toBe(target);
    expect(hit!.distance).toBe(0);
  });
});

describe("pointIntersections", () => {
  it("returns every object containing the point, deduplicated", () => {
    const target = wall();
    const world = mes(PhysicsWorld2D, {}, [target]);
    const e = engineWith(world);
    steps(e, 1);
    expect(world.pointIntersections(new Vector(10, 0))).toEqual([target]);
    expect(world.pointIntersections(new Vector(0, 0))).toEqual([]);
  });

  it("skips sensors unless includeAreas, and filters by mask and exclude", () => {
    const body = wall({ layer: 0b10 });
    const area = mes(Area2D, { position: new Vector(10, 0) }, [
      mes(CollisionShape2D, { shape: rect(2, 20) }),
    ]);
    const world = mes(PhysicsWorld2D, {}, [body, area]);
    const e = engineWith(world);
    steps(e, 1);

    const p = new Vector(10, 0);
    expect(world.pointIntersections(p)).toEqual([body]);
    const withAreas = world.pointIntersections(p, { includeAreas: true });
    expect(withAreas).toHaveLength(2);
    expect(withAreas).toContain(body);
    expect(withAreas).toContain(area);
    expect(world.pointIntersections(p, { mask: 0b01 })).toEqual([]);
    expect(world.pointIntersections(p, { exclude: body })).toEqual([]);
  });
});

describe("intersectShape", () => {
  it("returns every object overlapping the shape", () => {
    const target = wall();
    const world = mes(PhysicsWorld2D, {}, [target]);
    const e = engineWith(world);
    steps(e, 1);
    // A radius-1 circle at x=8.5 reaches x=9.5, past the wall face at 9.
    const near = world.intersectShape(circle(1), new Vector(8.5, 0));
    expect(near).toEqual([target]);
    const far = world.intersectShape(circle(1), new Vector(5, 0));
    expect(far).toEqual([]);
  });

  it("respects the shape's rotation", () => {
    const target = wall();
    const world = mes(PhysicsWorld2D, {}, [target]);
    const e = engineWith(world);
    steps(e, 1);
    // A 6x0.5 bar at x=6.5: flat it spans x in [3.5, 9.5] and overlaps the
    // wall; upright it spans x in [6.25, 6.75] and misses.
    const bar = rect(6, 0.5);
    const at = new Vector(6.5, 0);
    expect(world.intersectShape(bar, at)).toEqual([target]);
    expect(world.intersectShape(bar, at, Math.PI / 2)).toEqual([]);
  });

  it("filters by mask, exclude, and includeAreas", () => {
    const body = wall({ layer: 0b10 });
    const area = mes(Area2D, { position: new Vector(10, 0) }, [
      mes(CollisionShape2D, { shape: rect(2, 20) }),
    ]);
    const world = mes(PhysicsWorld2D, {}, [body, area]);
    const e = engineWith(world);
    steps(e, 1);

    const probe = circle(1);
    const at = new Vector(10, 0);
    expect(world.intersectShape(probe, at)).toEqual([body]);
    expect(world.intersectShape(probe, at, 0, { mask: 0b01 })).toEqual([]);
    expect(world.intersectShape(probe, at, 0, { exclude: body })).toEqual([]);
    const withAreas = world.intersectShape(probe, at, 0, {
      includeAreas: true,
    });
    expect(withAreas).toHaveLength(2);
  });
});
