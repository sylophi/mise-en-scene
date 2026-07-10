# @mise/physics

Rapier-backed 2D physics for Mise en Scène. Bodies, areas, shapes, and the
world itself are ordinary units: they enter the simulation when they enter
the tree and leave it when they leave, so `changeScene` tears physics down
like everything else. Built on
[Rapier](https://rapier.rs) (`@dimforge/rapier2d-compat`).

```ts
import { initPhysics } from "@mise/physics";

await initPhysics(); // loads the WASM module; once, before building scenes
```

## A platformer in one scene

```tsx
import { Engine, Vector, mes } from "@mise/core";
import {
  CharacterBody2D, CollisionShape2D, PhysicsWorld2D, StaticBody2D,
  capsule, initPhysics, rect,
} from "@mise/physics";

class Player extends CharacterBody2D {
  private vy = 0;

  override tick(dt: number): void {
    const input = this.engine.input;
    const x = (input.isDown("d") ? 1 : 0) - (input.isDown("a") ? 1 : 0);
    this.vy += 300 * dt; // gravity: y grows downward
    if (this.isOnFloor) {
      this.vy = input.isDown(" ") ? -120 : 0; // jump
    }
    this.moveAndSlide(new Vector(x * 60, this.vy), dt);
  }
}

await initPhysics();
const engine = new Engine();
engine.changeScene(
  mes(PhysicsWorld2D, {}, [
    mes(StaticBody2D, { position: new Vector(80, 85) }, [
      mes(CollisionShape2D, { shape: rect(160, 10) }), // the floor
    ]),
    mes(Player, { position: new Vector(80, 40) }, [
      mes(CollisionShape2D, { shape: capsule(1.5, 1.5) }),
    ]),
  ]),
);
```

A body's appearance is whatever you make it: subclass `Renderable` from
`@mise/react` *and* a physics class is not possible (single inheritance), so
either give the body a `Renderable` child, or subclass the physics class and
let a sibling render it. The body is just a unit with a transform; anything
that renders units works unchanged.

## Units

### `PhysicsWorld2D extends Unit`

Owns and steps a Rapier world; typically the root of your game scene. All
physics units register with their nearest `PhysicsWorld2D` ancestor. Each
engine tick it pushes unit transforms into the simulation, steps once at the
fixed dt, and drains overlap events. It ticks before its descendants (the
engine walks parent-first), so your `tick` always sees this frame's
collision state.

- `gravity` prop: world units per second squared, y down. It only affects
  dynamic bodies, which v1 does not have yet; characters integrate their own
  gravity (see the example).
- `castRay(origin, direction, maxDistance?, opts?)`: closest-hit raycast.
  Returns `{ unit, point, normal, distance }` or `null`. Options: `mask` to
  filter by layer, `exclude` to skip a unit (usually the caster),
  `includeAreas` to let rays hit sensors (default false).
- `world`: the raw Rapier `World`, for anything not wrapped.

### `CollisionObject2D extends Unit2D`

The abstract base of every body and area. It carries the `layer` and `mask`
props (see below), registers with the nearest `PhysicsWorld2D` ancestor on
tree enter, and tears its Rapier state down on exit. Escape hatches for
anything the wrappers don't cover: `body` (the Rapier `RigidBody`),
`colliders`, and `physicsWorld`.

### `CollisionShape2D extends Unit2D`

Contributes one shape to its parent body or area; a body may carry several.
Its local position and rotation offset the shape within the body. Shapes are
plain data in world units: `rect(width, height)`, `circle(radius)`,
`capsule(halfHeight, radius)` (capsules extend along y).

### `StaticBody2D extends CollisionObject2D`

Immovable: floors, walls, platforms. Its transform is read once on tree
enter.

### `CharacterBody2D extends CollisionObject2D`

The platformer workhorse, backed by Rapier's kinematic character controller.
Drive it from `tick` with `moveAndSlide(velocity, dt)`: it slides along
obstacles and slopes instead of stopping dead, and writes the result back to
`position` (which fires `position$`, so rendering follows). `isOnFloor`
reflects the last `moveAndSlide`. "Up" is -y, matching gravity down the
screen. For autostep, snap-to-ground, or slope limits, configure the exposed
`controller` directly.

### `Area2D extends CollisionObject2D`

A detection zone that overlaps everything and collides with nothing:
hitboxes, hurtboxes, triggers, pickups. Parent it to a moving unit and it
follows. Two ways to consume it:

```ts
// Events: fire during the world's tick, one step after the overlap changes.
area.onBodyEntered.addListener((body) => body.takeDamage());
area.onBodyExited.addListener(...);   // and onAreaEntered / onAreaExited

// Polling: what is inside right now. Right for short-lived attack hitboxes.
for (const target of swordHitbox.getOverlapping()) ...
```

## Layers and masks

Every body and area has a `layer` bitmask (what it *is*, default `1`) and a
`mask` bitmask (what it *sees*, default all). Two objects interact when each
one's `layer` intersects the other's `mask`. The classic setup: enemy
hurtboxes on layer 2, the player's sword `Area2D` with `mask: 2`, so the
sword overlaps enemies but ignores the player's own hurtbox on layer 4.

## Debug draw data

The package exposes renderer-agnostic debug data; the drop-in overlay that
draws it lives in [`@mise/physics-debug`](../physics-debug/README.md), so
physics never depends on React.

- `debugSnapshot(world)`: one entry per collider —
  `{ handle, role, shape, position, rotation, unit? }` — with the pose read
  back from Rapier (what the simulation is actually colliding) and `role`
  derived from simulation state: `"area"` for sensors, `"static"` for fixed
  bodies, `"character"` for kinematic ones, `"dynamic"` reserved for future
  dynamic bodies.
- `world.rayLog`: an opt-in ring buffer of recent `castRay` calls (origin,
  direction, hit or miss, engine time). Off by default — casting pays one
  boolean check and records nothing. Set `rayLog.enabled = true` to record;
  the debug overlay does this automatically while mounted.

## Rules of the road

- **Await `initPhysics()` first.** Constructing any physics unit before the
  WASM module is loaded throws.
- **Transforms have one owner per body type.** You move characters and
  areas (the simulation follows their units); the simulation will move
  dynamic bodies when they exist. Static bodies don't move.
- **No scale or shear on physics units.** Rigid bodies are rigid: colliders
  follow only translation and rotation of the world transform. Keep physics
  subtrees unscaled; squash the renderable child instead.
- **One `moveAndSlide` per tick.** It both queries and moves; calling it
  from `deviceTick` would let render rate change game speed.
