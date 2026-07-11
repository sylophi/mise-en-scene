import { beforeAll, describe, expect, it } from "vitest";
import { Engine, Unit, Unit2D, Vector, mes } from "@sylophi/mise-core";
import {
  Area2D,
  CharacterBody2D,
  CollisionShape2D,
  PhysicsWorld2D,
  StaticBody2D,
  initPhysics,
  rect,
} from "./index.ts";

beforeAll(() => initPhysics());

/** A character that walks at a constant velocity every tick. */
class Walker extends CharacterBody2D {
  velocity = Vector.zero;
  override tick(dt: number): void {
    this.moveAndSlide(this.velocity, dt);
  }
}

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

const walker = (velocity: Vector, props: { mask?: number } = {}) => {
  const w = mes(Walker, { position: Vector.zero, ...props }, [
    mes(CollisionShape2D, { shape: rect(2, 2) }),
  ]);
  w.velocity = velocity;
  return w;
};

describe("CharacterBody2D", () => {
  it("slides into a wall and stops at its face", () => {
    const w = walker(new Vector(20, 0));
    const e = engineWith(mes(PhysicsWorld2D, {}, [wall(), w]));
    steps(e, 60); // unobstructed this would reach x=20
    // Wall face at 9, half-width 1, controller skin 0.05.
    expect(w.position.x).toBeGreaterThan(7.5);
    expect(w.position.x).toBeLessThan(8);
    expect(w.position.y).toBeCloseTo(0);
  });

  it("ignores walls whose layer is outside its mask", () => {
    const w = walker(new Vector(20, 0), { mask: 0b01 });
    const e = engineWith(mes(PhysicsWorld2D, {}, [wall({ layer: 0b10 }), w]));
    steps(e, 60);
    expect(w.position.x).toBeCloseTo(20, 1);
  });

  it("reports grounded against the surface it is pushed into", () => {
    // Floor below (y grows downward), walker walking along it.
    const floor = mes(StaticBody2D, { position: new Vector(0, 5) }, [
      mes(CollisionShape2D, { shape: rect(100, 8) }),
    ]);
    const w = walker(new Vector(10, 30)); // pressed down and forward
    const e = engineWith(mes(PhysicsWorld2D, {}, [floor, w]));
    steps(e, 30);
    expect(w.isOnFloor).toBe(true);
    expect(w.position.y).toBeCloseTo(-0.05, 1); // resting on the floor top
  });
});

describe("Area2D", () => {
  it("fires enter and exit as a body passes through", () => {
    const area = mes(Area2D, { position: new Vector(10, 0) }, [
      mes(CollisionShape2D, { shape: rect(4, 4) }),
    ]);
    const w = walker(new Vector(20, 0));
    const entered: unknown[] = [];
    const exited: unknown[] = [];
    area.onBodyEntered.addListener((u) => entered.push(u));
    area.onBodyExited.addListener((u) => exited.push(u));

    const e = engineWith(mes(PhysicsWorld2D, {}, [area, w]));
    steps(e, 60); // walker ends at x=20, well past the area
    expect(entered).toEqual([w]);
    expect(exited).toEqual([w]);
  });

  it("polls current overlaps with getOverlapping", () => {
    const area = mes(Area2D, { position: Vector.zero }, [
      mes(CollisionShape2D, { shape: rect(4, 4) }),
    ]);
    const inside = walker(Vector.zero);
    const outside = wall();
    const e = engineWith(mes(PhysicsWorld2D, {}, [area, inside, outside]));
    steps(e, 2);
    expect(area.getOverlapping()).toEqual([inside]);
  });
});

describe("castRay", () => {
  it("returns the closest hit with point, normal, and distance", () => {
    const target = wall();
    const world = mes(PhysicsWorld2D, {}, [target]);
    const e = engineWith(world);
    steps(e, 1); // queries see colliders after the first step
    const hit = world.castRay(Vector.zero, new Vector(1, 0));
    expect(hit).not.toBeNull();
    expect(hit!.unit).toBe(target);
    expect(hit!.distance).toBeCloseTo(9);
    expect(hit!.point.x).toBeCloseTo(9);
    expect(hit!.normal.x).toBeCloseTo(-1);
  });

  it("skips sensors and excluded units, and misses out of range", () => {
    const target = wall();
    const area = mes(Area2D, { position: new Vector(5, 0) }, [
      mes(CollisionShape2D, { shape: rect(2, 20) }),
    ]);
    const caster = walker(Vector.zero);
    const world = mes(PhysicsWorld2D, {}, [target, area, caster]);
    const e = engineWith(world);
    steps(e, 1);

    const through = world.castRay(Vector.zero, new Vector(1, 0), 100, {
      exclude: caster,
    });
    expect(through!.unit).toBe(target); // passed the sensor and the caster
    const short = world.castRay(Vector.zero, new Vector(1, 0), 5, {
      exclude: caster,
    });
    expect(short).toBeNull();
  });
});

describe("reparenting", () => {
  it("moves a live body into another world and simulates it there", () => {
    const w = walker(new Vector(20, 0));
    const worldA = mes(PhysicsWorld2D, {}, [w]);
    const worldB = mes(PhysicsWorld2D, {}, [wall()]);
    const e = engineWith(mes(Unit, {}, [worldA, worldB]));
    steps(e, 5); // worldA is empty: the walker strolls freely

    worldB.addChild(w);
    expect(w.physicsWorld).toBe(worldB);
    worldA.destroy(); // frees worldA's Rapier world; w must not live there
    steps(e, 60);
    expect(() => w.body!.translation()).not.toThrow(); // no use-after-free
    expect(w.position.x).toBeGreaterThan(7.5); // stopped at worldB's wall
    expect(w.position.x).toBeLessThan(8);
  });

  it("moves a plain subtree containing a body between worlds", () => {
    const w = walker(new Vector(20, 0));
    const group = mes(Unit2D, {}, [w]);
    const worldA = mes(PhysicsWorld2D, {}, [group]);
    const worldB = mes(PhysicsWorld2D, {}, [wall()]);
    const e = engineWith(mes(Unit, {}, [worldA, worldB]));
    steps(e, 5);

    worldB.addChild(group); // the moved unit is not the physics unit itself
    expect(w.physicsWorld).toBe(worldB);
    worldA.destroy();
    steps(e, 60);
    expect(() => w.body!.translation()).not.toThrow();
    expect(w.position.x).toBeGreaterThan(7.5);
    expect(w.position.x).toBeLessThan(8);
  });

  it("keeps the same rigid body on a move within one world", () => {
    const w = walker(Vector.zero);
    const group = mes(Unit2D, {}, []);
    const world = mes(PhysicsWorld2D, {}, [group, w]);
    const e = engineWith(world);
    steps(e, 1);

    const body = w.body;
    group.addChild(w);
    expect(w.body).toBe(body); // same world: no rebuild
    expect(w.physicsWorld).toBe(world);
  });

  it("throws on a move out from under every world, after tearing down", () => {
    const w = walker(Vector.zero);
    const worldA = mes(PhysicsWorld2D, {}, [w]);
    const worldB = mes(PhysicsWorld2D, {}, []);
    const scene = mes(Unit, {}, [worldA, worldB]);
    const e = engineWith(scene);
    steps(e, 1);

    expect(() => scene.addChild(w)).toThrow(/descendant of a PhysicsWorld2D/);
    expect(w.physicsWorld).toBeNull(); // torn down, not left in worldA
    expect(w.body).toBeNull();
    worldA.destroy();
    steps(e, 1);

    worldB.addChild(w); // recoverable: colliders come back with the body
    expect(w.physicsWorld).toBe(worldB);
    expect(w.colliders).toHaveLength(1);
    steps(e, 1);
  });

  it("moves a shape between bodies", () => {
    const shape = mes(CollisionShape2D, { shape: rect(2, 2) });
    const bodyA = mes(StaticBody2D, { position: new Vector(10, 0) }, [shape]);
    const bodyB = mes(StaticBody2D, { position: new Vector(0, 10) });
    const world = mes(PhysicsWorld2D, {}, [bodyA, bodyB]);
    const e = engineWith(world);
    steps(e, 1);
    expect(world.castRay(Vector.zero, new Vector(1, 0))!.unit).toBe(bodyA);

    bodyB.addChild(shape);
    expect(bodyA.colliders).toHaveLength(0);
    expect(bodyB.colliders).toHaveLength(1);
    steps(e, 1);
    expect(world.castRay(Vector.zero, new Vector(1, 0))).toBeNull();
    const hit = world.castRay(Vector.zero, new Vector(0, 1));
    expect(hit!.unit).toBe(bodyB);
    expect(hit!.distance).toBeCloseTo(9);
  });
});

describe("lifecycle", () => {
  it("tears the simulation down with the scene and keeps ticking", () => {
    const w = walker(new Vector(20, 0));
    const scene = mes(PhysicsWorld2D, {}, [wall(), w]);
    const e = engineWith(scene);
    steps(e, 10);

    e.changeScene(mes(PhysicsWorld2D, {}, [wall()]));
    expect(scene.destroyed).toBe(true);
    expect(w.physicsWorld).toBeNull();
    expect(w.body).toBeNull();
    steps(e, 10); // the new world steps happily
  });
});
