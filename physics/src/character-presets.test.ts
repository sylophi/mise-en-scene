import { beforeAll, describe, expect, it } from "vitest";
import { Engine, Unit, Vector, mes } from "@mise/core";
import {
  CharacterBody2D,
  CollisionShape2D,
  PhysicsWorld2D,
  StaticBody2D,
  initPhysics,
  rect,
  type CharacterBody2DProps,
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

const walker = (
  velocity: Vector,
  props: Omit<CharacterBody2DProps, "position"> = {},
) => {
  const w = mes(Walker, { position: Vector.zero, ...props }, [
    mes(CollisionShape2D, { shape: rect(2, 2) }),
  ]);
  w.velocity = velocity;
  return w;
};

/** A floor whose top surface is at y=1, spanning x in [-50, 50]. */
const floor = () =>
  mes(StaticBody2D, { position: new Vector(0, 5) }, [
    mes(CollisionShape2D, { shape: rect(100, 8) }),
  ]);

/** A 0.8-tall ledge on the floor, spanning x in [10, 30]; top at y=0.2. */
const ledge = () =>
  mes(StaticBody2D, { position: new Vector(20, 0.6) }, [
    mes(CollisionShape2D, { shape: rect(20, 0.8) }),
  ]);

describe("autostep", () => {
  it("normalizes the number shorthand", () => {
    const w = walker(Vector.zero, { autostep: 1 });
    expect(w.autostep).toEqual({
      maxHeight: 1,
      minWidth: 0.5,
      includeDynamic: true,
    });
    w.autostep = null;
    expect(w.autostep).toBeNull();
  });

  it("climbs a small ledge that un-stepped movement fails", () => {
    // Pressed down and forward, like a platformer character under gravity.
    const w = walker(new Vector(10, 20));
    const e = engineWith(mes(PhysicsWorld2D, {}, [floor(), ledge(), w]));
    steps(e, 60);
    // Blocked at the ledge's left face (x=10), half-width 1, skin 0.05.
    expect(w.position.x).toBeGreaterThan(8);
    expect(w.position.x).toBeLessThan(9.2);

    w.autostep = 1; // runtime update: maxHeight 1 clears the 0.8 ledge
    steps(e, 60);
    expect(w.position.x).toBeGreaterThan(12); // walked on past the step
    expect(w.position.y).toBeCloseTo(-0.85, 1); // standing on the ledge top
  });

  it("applies the constructor prop from the first step", () => {
    const w = walker(new Vector(10, 20), {
      autostep: { maxHeight: 1, minWidth: 0.3 },
    });
    const e = engineWith(mes(PhysicsWorld2D, {}, [floor(), ledge(), w]));
    steps(e, 120);
    expect(w.position.x).toBeGreaterThan(12);
  });
});

describe("maxSlope", () => {
  /**
   * A big slab whose top surface passes through the origin, rising to the
   * right at `angle` radians (y grows downward, so uphill is -y).
   */
  const ramp = (angle: number) =>
    mes(
      StaticBody2D,
      {
        position: new Vector(10 * Math.sin(angle), 10 * Math.cos(angle)),
        rotation: -angle,
      },
      [mes(CollisionShape2D, { shape: rect(200, 20) })],
    );

  /** Settle onto the ramp, walk right for 90 steps, return the progress. */
  const climb = (
    angle: number,
    props: { maxSlope?: number } = {},
  ): { dx: number; dy: number } => {
    const w = walker(Vector.zero, props);
    w.position = new Vector(0, -3);
    const e = engineWith(mes(PhysicsWorld2D, {}, [ramp(angle), w]));
    w.velocity = new Vector(0, 10);
    steps(e, 30); // settle onto the slope
    const settled = w.position;
    w.velocity = new Vector(20, 0); // walk into the incline
    steps(e, 90);
    return { dx: w.position.x - settled.x, dy: w.position.y - settled.y };
  };

  it("climbs slopes under the default 45° limit", () => {
    const { dx, dy } = climb(Math.PI / 6); // 30°
    expect(dx).toBeGreaterThan(5);
    expect(dy).toBeLessThan(-2); // gained height going uphill
  });

  it("refuses slopes steeper than the limit", () => {
    const { dx } = climb(Math.PI / 3); // 60° against the default 45°
    expect(dx).toBeLessThan(1); // stalled at the incline
  });

  it("climbs a steep slope when the limit is raised", () => {
    const { dx, dy } = climb(Math.PI / 3, { maxSlope: (75 * Math.PI) / 180 });
    expect(dx).toBeGreaterThan(5);
    expect(dy).toBeLessThan(-2);
  });
});

describe("snapToGround", () => {
  /**
   * A big slab whose top surface passes through the origin, descending to
   * the right at 20°. Walking right at vx=20 the ground drops ~7.3/s, so a
   * weak downward velocity cannot keep up: only snapping stays grounded.
   * (Rapier snaps a move that starts grounded and ends moving downward, so
   * the walker must press down a little, like gravity would.)
   */
  const downhill = () => {
    const angle = Math.PI / 9; // 20°
    return mes(
      StaticBody2D,
      {
        position: new Vector(-10 * Math.sin(angle), 10 * Math.cos(angle)),
        rotation: angle,
      },
      [mes(CollisionShape2D, { shape: rect(200, 20) })],
    );
  };

  const descend = (w: Walker): { dy: number } => {
    const e = engineWith(mes(PhysicsWorld2D, {}, [downhill(), w]));
    w.position = new Vector(0, -3);
    w.velocity = new Vector(0, 10);
    steps(e, 30); // settle onto the slope
    expect(w.isOnFloor).toBe(true);
    const settled = w.position;
    w.velocity = new Vector(20, 1); // walk downhill, weak downward pressure
    steps(e, 90);
    return { dy: w.position.y - settled.y };
  };

  it("keeps isOnFloor and hugs a descent when enabled", () => {
    const w = walker(Vector.zero, { snapToGround: 1 });
    const { dy } = descend(w);
    expect(w.isOnFloor).toBe(true);
    expect(dy).toBeGreaterThan(5); // followed the slope down (~7.3 over 1.5s)
  });

  it("goes airborne over the same descent when disabled (the default)", () => {
    const w = walker(Vector.zero);
    expect(w.snapToGround).toBeNull();
    const { dy } = descend(w);
    expect(w.isOnFloor).toBe(false);
    expect(dy).toBeLessThan(2); // only drifted down at the input velocity
  });
});
