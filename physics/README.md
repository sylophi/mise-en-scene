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
  Returns `{ unit, point, normal, distance }` or `null`.
- `castShape(shape, origin, rotation, direction, maxDistance?, opts?)`:
  closest-hit sweep of a `rect`/`circle`/`capsule`. Same result shape as
  `castRay`, except `point` is the witness point — where the swept shape
  first touches the hit collider, in world space — and `distance` is how far
  the shape traveled (0 if it starts overlapping). The go-to ground check:
  sweep the character's own shape downward.
- `pointIntersections(point, opts?)`: every object containing a point (what
  is under the cursor?). Returns units, deduplicated, unordered.
- `intersectShape(shape, position, rotation?, opts?)`: every object
  overlapping a shape placed there — one-shot overlap tests (explosion
  radius, melee arc) without mounting a throwaway `Area2D`.
- All queries share the same options: `mask` to filter by layer, `exclude`
  to skip a unit (usually the caster), `includeAreas` to let the query hit
  sensors (default false).
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
screen.

Three presets are props *and* live accessors (all off/default until set):

```ts
mes(Player, {
  autostep: 1.5,          // climb ledges up to 1.5 tall (stairs); or
                          // { maxHeight, minWidth?, includeDynamic? }
  snapToGround: 0.8,      // stick to the ground across drops up to 0.8
  maxSlope: Math.PI / 3,  // steepest walkable slope (default 45°)
}, [ ... ]);

player.autostep = null;               // runtime updates are plain setters
player.maxSlope = (50 * Math.PI) / 180;
```

- `autostep` climbs small ledges instead of stopping at them. A number is
  shorthand for `{ maxHeight }`; `minWidth` (clear space needed on top)
  defaults to half of `maxHeight`.
- `snapToGround` keeps the character glued (and `isOnFloor` steady) down
  stairs and slopes it would otherwise fly off. Rapier only snaps a move
  that starts grounded and ends moving downward, so keep integrating
  gravity while on the floor.
- `maxSlope` is the walkable-floor angle in radians: shallower climbs,
  steeper blocks (and slides under downward movement). It sets Rapier's
  climb and slide angles together; split them via the raw `controller` if
  you need hysteresis.

Anything else the wrappers don't cover: configure the exposed `controller`
directly.

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
