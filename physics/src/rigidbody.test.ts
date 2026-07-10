import { beforeAll, describe, expect, it } from "vitest";
import { Engine, Unit, Unit2D, Vector, mes } from "@mise/core";
import {
  CollisionShape2D,
  PhysicsWorld2D,
  RigidBody2D,
  StaticBody2D,
  circle,
  initPhysics,
  rect,
  type Contact2D,
  type RigidBody2DProps,
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

/** A unit-radius ball body at `position`. Density 1 → mass π. */
const ball = (props: RigidBody2DProps = {}) =>
  mes(RigidBody2D, { position: Vector.zero, ...props }, [
    mes(CollisionShape2D, { shape: circle(1) }),
  ]);

/** A wide static floor whose top surface sits at y=20. */
const floor = () =>
  mes(StaticBody2D, { position: new Vector(0, 25) }, [
    mes(CollisionShape2D, { shape: rect(200, 10) }),
  ]);

const GRAVITY = new Vector(0, 100); // y grows downward

describe("RigidBody2D", () => {
  it("falls under gravity, and rendering follows via position$", () => {
    const b = ball();
    const moves: Vector[] = [];
    b.position$.addListener((p) => moves.push(p));
    const e = engineWith(mes(PhysicsWorld2D, { gravity: GRAVITY }, [b]));
    steps(e, 60); // one second
    // Semi-implicit Euler lands slightly above ½gt² = 50.
    expect(b.position.y).toBeGreaterThan(45);
    expect(b.position.y).toBeLessThan(56);
    expect(b.position.x).toBeCloseTo(0);
    expect(b.linearVelocity.y).toBeCloseTo(100, 0);
    expect(moves.length).toBe(60); // one write-back per step
  });

  it("scales and disables gravity per body", () => {
    const half = ball({ gravityScale: 0.5 });
    const none = ball({ gravityScale: 0, position: new Vector(10, 0) });
    const e = engineWith(
      mes(PhysicsWorld2D, { gravity: GRAVITY }, [half, none]),
    );
    steps(e, 60);
    expect(half.position.y).toBeGreaterThan(20);
    expect(half.position.y).toBeLessThan(30);
    expect(none.position.y).toBeCloseTo(0);
  });

  it("changes velocity by impulse / mass", () => {
    const b = ball(); // circle(1), density 1 → mass π
    const e = engineWith(mes(PhysicsWorld2D, {}, [b]));
    expect(b.mass).toBeCloseTo(Math.PI);
    b.applyImpulse(new Vector(Math.PI, 0));
    expect(b.linearVelocity.x).toBeCloseTo(1);
    steps(e, 60); // drifts at 1 unit/s, no gravity or damping
    expect(b.position.x).toBeCloseTo(1, 1);
    expect(b.position.y).toBeCloseTo(0);
  });

  it("applies forces for one step only", () => {
    const b = ball();
    const e = engineWith(mes(PhysicsWorld2D, {}, [b]));
    // F = mass * 60 for one step (dt=1/60) → Δv = 1.
    b.applyForce(new Vector(b.mass * 60, 0));
    steps(e, 1);
    expect(b.linearVelocity.x).toBeCloseTo(1);
    steps(e, 30); // not reapplied: velocity stays put
    expect(b.linearVelocity.x).toBeCloseTo(1);
  });

  it("spins from torque impulses and writes rotation back", () => {
    const b = ball();
    const e = engineWith(mes(PhysicsWorld2D, {}, [b]));
    b.applyTorqueImpulse(5);
    expect(b.angularVelocity).toBeGreaterThan(0);
    steps(e, 30);
    expect(b.rotation).toBeGreaterThan(0);
  });

  it("bounces off a floor with restitution", () => {
    const b = ball({ restitution: 0.9 });
    const e = engineWith(
      mes(PhysicsWorld2D, { gravity: GRAVITY }, [floor(), b]),
    );
    // Fall from y=0 to the floor top at y=20 (contact at y=19), then bounce.
    let bounced = false;
    let minAfterBounce = Infinity;
    for (let i = 0; i < 240; i++) {
      steps(e, 1);
      if (b.linearVelocity.y < -1) bounced = true; // moving up again
      if (bounced) minAfterBounce = Math.min(minAfterBounce, b.position.y);
    }
    expect(bounced).toBe(true);
    // Rapier averages the pair's restitution (0.45 vs the floor's 0), so the
    // rebound apex is ~20% of the drop: clearly off the resting pose at 19.
    expect(minAfterBounce).toBeLessThan(17);
  });

  it("comes to rest and sleeps on a floor without restitution", () => {
    const b = ball({ position: new Vector(0, 17) });
    const e = engineWith(
      mes(PhysicsWorld2D, { gravity: GRAVITY }, [floor(), b]),
    );
    steps(e, 300);
    expect(b.position.y).toBeCloseTo(19, 0); // resting: floor top minus radius
    expect(b.sleeping).toBe(true);
  });

  it("teleports on position assignment, keeping velocity", () => {
    const b = ball();
    const e = engineWith(mes(PhysicsWorld2D, { gravity: GRAVITY }, [b]));
    steps(e, 30);
    const fallSpeed = b.linearVelocity.y;
    expect(fallSpeed).toBeGreaterThan(40);

    b.position = new Vector(50, 0);
    steps(e, 1);
    expect(b.position.x).toBeCloseTo(50);
    expect(b.position.y).toBeGreaterThan(0); // one step of fall past the target
    expect(b.position.y).toBeLessThan(2);
    expect(b.linearVelocity.y).toBeGreaterThanOrEqual(fallSpeed); // kept falling
  });

  it("spawns at its world transform but ignores later parent motion", () => {
    const parent = new Unit2D({ position: new Vector(30, 5) });
    const b = ball();
    parent.addChild(b);
    const e = engineWith(mes(PhysicsWorld2D, { gravity: GRAVITY }, [parent]));
    steps(e, 30);
    const wt = b.worldTransform;
    expect(wt.tx).toBeCloseTo(30); // spawned at the parent's offset
    expect(wt.ty).toBeGreaterThan(5); // and fell from there

    // The simulation owns the pose: moving the parent doesn't drag the body.
    const before = b.worldTransform.ty;
    parent.position = new Vector(100, 5);
    steps(e, 1);
    expect(b.worldTransform.tx).toBeCloseTo(30);
    expect(b.worldTransform.ty).toBeGreaterThan(before);
  });
});

describe("contact events", () => {
  it("fires start and end with the peer unit, point, and normal", () => {
    const b = ball({ contactEvents: true, restitution: 1 });
    const ground = floor();
    const started: Contact2D[] = [];
    const ended: Contact2D[] = [];
    b.onContactStarted.addListener((c) => started.push(c));
    b.onContactEnded.addListener((c) => ended.push(c));
    const e = engineWith(
      mes(PhysicsWorld2D, { gravity: GRAVITY }, [ground, b]),
    );
    steps(e, 240); // fall, hit, bounce away

    expect(started.length).toBeGreaterThanOrEqual(1);
    const hit = started[0]!;
    expect(hit.other).toBe(ground);
    expect(hit.normal).not.toBeNull();
    expect(hit.normal!.y).toBeCloseTo(1); // from the ball toward the floor
    expect(hit.point).not.toBeNull();
    expect(hit.point!.y).toBeCloseTo(20, 0); // at the floor's top surface

    expect(ended.length).toBeGreaterThanOrEqual(1);
    expect(ended[0]!.other).toBe(ground);
    expect(ended[0]!.point).toBeNull();
    expect(ended[0]!.normal).toBeNull();
  });

  it("reports to both units when only one side opted in", () => {
    const b = ball({ contactEvents: true, restitution: 1 });
    const ground = floor(); // no contactEvents flag
    const groundHits: Contact2D[] = [];
    ground.onContactStarted.addListener((c) => groundHits.push(c));
    const e = engineWith(
      mes(PhysicsWorld2D, { gravity: GRAVITY }, [ground, b]),
    );
    steps(e, 240);
    expect(groundHits.length).toBeGreaterThanOrEqual(1);
    expect(groundHits[0]!.other).toBe(b);
    expect(groundHits[0]!.normal!.y).toBeCloseTo(-1); // floor → ball is up
  });

  it("stays silent for pairs where neither side opted in", () => {
    const b = ball({ restitution: 1 });
    const ground = floor();
    const events: Contact2D[] = [];
    b.onContactStarted.addListener((c) => events.push(c));
    ground.onContactStarted.addListener((c) => events.push(c));
    const e = engineWith(
      mes(PhysicsWorld2D, { gravity: GRAVITY }, [ground, b]),
    );
    steps(e, 240);
    expect(events).toEqual([]);
  });
});

describe("lifecycle", () => {
  it("tears down on tree exit and keeps the world stepping", () => {
    const b = ball({ contactEvents: true });
    const scene = mes(PhysicsWorld2D, { gravity: GRAVITY }, [floor(), b]);
    const e = engineWith(scene);
    steps(e, 10);
    expect(b.body).not.toBeNull();

    e.changeScene(mes(PhysicsWorld2D, {}, [floor()]));
    expect(scene.destroyed).toBe(true);
    expect(b.body).toBeNull();
    expect(b.physicsWorld).toBeNull();
    expect(b.mass).toBe(0);
    steps(e, 10); // the new world steps happily
  });

  it("latches velocity across detach and applies it on re-enter", () => {
    const world = mes(PhysicsWorld2D, {}, []);
    const b = ball();
    world.addChild(b);
    const e = engineWith(world);
    b.linearVelocity = new Vector(3, 0);
    steps(e, 5);

    world.removeChild(b);
    expect(b.body).toBeNull();
    expect(b.linearVelocity.x).toBeCloseTo(3); // snapshotted

    world.addChild(b);
    steps(e, 1);
    expect(b.linearVelocity.x).toBeCloseTo(3); // reapplied to the new body
  });
});
