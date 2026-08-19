# Shape casts, point queries, and character presets

Design for two roadmap items in `@mise/physics`:

1. **Shape casts and point queries** alongside `castRay`.
2. **Character presets**: autostep, snap-to-ground, and max slope as props on
   `CharacterBody2D` (v1 required configuring the raw Rapier `controller`).

## API surface

| API | Kind | Returns | Rapier mapping |
| --- | --- | --- | --- |
| `PhysicsWorld2D.castShape(shape, origin, rotation, direction, maxDistance?, opts?)` | closest-hit sweep | `ShapeCastHit \| null` | `World.castShape` |
| `PhysicsWorld2D.pointIntersections(point, opts?)` | all objects containing a point | `CollisionObject2D[]` | `World.intersectionsWithPoint` |
| `PhysicsWorld2D.intersectShape(shape, position, rotation?, opts?)` | all objects overlapping a shape | `CollisionObject2D[]` | `World.intersectionsWithShape` |
| `CharacterBody2D` `autostep` prop + accessor | preset | `Required<Autostep> \| null` | `enableAutostep` / `disableAutostep` |
| `CharacterBody2D` `snapToGround` prop + accessor | preset | `number \| null` | `enableSnapToGround` / `disableSnapToGround` |
| `CharacterBody2D` `maxSlope` prop + accessor | preset | `number` (radians) | `setMaxSlopeClimbAngle` + `setMinSlopeSlideAngle` |

All three queries take the same options object as `castRay` — `{ mask,
exclude, includeAreas }` — now named `QueryOptions`; `RayCastOptions` stays as
an alias so existing code keeps compiling. Shapes are the package's existing
plain-data `Shape` values (`rect`/`circle`/`capsule`), converted to standalone
Rapier shapes by an internal helper (`rapierShapeFor` in `shape.ts`).

## `castShape`

```ts
castShape(
  shape: Shape,          // rect / circle / capsule, world units
  origin: Vector,        // center of the shape at the start of the sweep
  rotation: number,      // shape rotation in radians, constant over the sweep
  direction: Vector,     // need not be normalized (matches castRay)
  maxDistance = Number.MAX_VALUE,
  opts: QueryOptions = {},
): ShapeCastHit | null
```

Maps to `World.castShape(origin, rotation, dir, shape, /* targetDistance */ 0,
maxDistance, /* stopAtPenetration */ true, flags, groups, undefined,
exclude?.body)`. The result mirrors `RayHit`:

```ts
interface ShapeCastHit {
  unit: CollisionObject2D;
  point: Vector;    // witness point, world space (see below)
  normal: Vector;   // hit collider's surface normal at `point`, world space
  distance: number; // distance traveled by the shape before impact
}
```

### Semantics decisions

- **`point` is the witness point on the hit collider, in world space** — the
  place where the swept shape first touches the obstacle. This was verified
  empirically against Rapier 0.19: `hit.witness1` is world-space and lies on
  the hit collider (`witness2` is in the *cast shape's local space*, so it is
  not exposed). At the time of impact the two shapes touch, so this single
  point fully describes the contact.
- **`normal` is `hit.normal1`**: the hit collider's outward surface normal,
  pointing back toward the cast — the same convention as `castRay` (a cast
  toward a wall's left face reports `normal.x === -1`).
- **`distance` is the sweep distance**, not the distance to `point`. Because
  `direction` is normalized before casting, Rapier's `time_of_impact` *is* the
  world-unit travel distance, exactly like `castRay`. `origin +
  direction.normalize().scale(distance)` is where the shape's center stops.
- **Starting in overlap returns `distance 0`** (`stopAtPenetration: true`),
  which is the useful answer for ground checks; it never reports hits "behind"
  the cast.
- `targetDistance` is fixed at 0 (report contact, not proximity); a future
  option can expose it if a use case appears.

## Point and shape queries

```ts
pointIntersections(point: Vector, opts?: QueryOptions): CollisionObject2D[]
intersectShape(shape: Shape, position: Vector, rotation = 0, opts?: QueryOptions): CollisionObject2D[]
```

Both return **all** matching objects as units, deduplicated (a body with
several colliders appears once), in no guaranteed order. Sensors are skipped
unless `includeAreas: true`, and `mask`/`exclude` filter exactly as in
`castRay`.

### Why these two (and not more)

- `pointIntersections` is the "what is under the cursor / at this tile" query
  — the overwhelmingly common point query. Returning *all* containing objects
  (not Rapier's first-hit `intersectionWithPoint` singular) costs nothing
  extra and avoids a second API for the overlapping-objects case.
- `intersectShape` is the one-shot overlap test: explosion radius, melee arc,
  spawn-clearance check. It covers every case that would otherwise need a
  throwaway `Area2D` mounted for one frame.
- **Not included:** `projectPoint` (closest point on any collider — niche, and
  the raw `world` escape hatch remains), a first-hit-only point query
  (filtering the array is trivial), and callback-style variants (the object
  counts here are small; arrays are simpler and match `Area2D.getOverlapping`).

## Character presets

```ts
interface Autostep {
  maxHeight: number;        // highest ledge treated as a step, world units
  minWidth?: number;        // min clear width on top; default maxHeight / 2
  includeDynamic?: boolean; // dynamic bodies count as steps; default true
}

interface CharacterBody2DProps {
  // ... existing offset
  autostep?: number | Autostep; // number = { maxHeight }; default off
  snapToGround?: number;        // snap distance, world units; default off
  maxSlope?: number;            // radians; default π/4 (Rapier's default)
}
```

Each preset is also a **runtime accessor** on `CharacterBody2D` — the Rapier
controller setters are plain field writes, so live updates are free:

```ts
player.autostep = 1.5;          // or { maxHeight: 1.5, minWidth: 0.5 }
player.autostep = null;         // disable
player.snapToGround = 0.8;      // or null to disable
player.maxSlope = Math.PI / 3;  // radians
```

The stored (normalized) values are the source of truth: they are applied when
the controller is created on tree enter, re-applied by every setter while
live, and survive tree exit/re-enter. Getters return the normalized values
(`autostep` always returns a fully-populated object or `null`).

### Semantics decisions

- **`snapToGround` is off by default**, matching both Rapier's controller
  default and v1 behavior (no silent movement change for existing games).
  Godot enables snapping by default, but its controller also owns gravity;
  here characters integrate their own vertical velocity, so implicit snapping
  would fight code that already presses characters into the floor.
- **Snap has a precondition worth documenting** (verified against Rapier's
  source and empirically): it only fires for a move that *starts grounded and
  ends with actual downward translation*. A character that stops integrating
  gravity while grounded will not snap; one that keeps a gravity-like
  downward component (the normal platformer pattern) hugs descents and keeps
  `isOnFloor` steady. The prop docs and README both say so.
- **`autostep` is off by default** (Rapier default). The `number` shorthand
  fills `minWidth = maxHeight / 2` — permissive enough that stairs "just
  work", strict enough not to climb razor-thin edges — and `includeDynamic =
  true` (moot in v1, correct once `RigidBody2D` lands).
- **`maxSlope` is one "walkable floor" knob**: it sets *both*
  `maxSlopeClimbAngle` and `minSlopeSlideAngle` to the same value, Godot's
  `floor_max_angle` semantic. Rapier defaults both to π/4 (45°) anyway, and
  keeping them equal avoids the odd "can climb it but slides off it while
  standing" states; the raw `controller` escape hatch can still split them
  for hysteresis. Default π/4.
- Empirical note that motivated the above: with the two angles split, raising
  only the climb angle on a 60° ramp still leaves the character sliding
  backwards under downward pressure (slide angle stuck at 45°) — the single
  knob is what users mean by "max slope".

## Alternatives considered

- **A `ShapeCast2D` unit** (Godot-style node that casts every frame): rejected
  for now; a method on the world composes into any unit's `tick` and doesn't
  prescribe when to cast. A convenience unit can be layered on later.
- **Returning witness points in both spaces** (`pointOnShape` +
  `pointOnCollider`): at TOI they coincide in world space, so one `point`
  is enough and keeps the result shape identical to `RayHit`.
- **An options-object signature for `castShape`** (`castShape(shape, opts)`):
  rejected to mirror `castRay`'s positional style exactly.
- **`snapToGround: boolean | number`** with a default distance: rejected —
  a good default distance depends on world scale, which the engine doesn't
  know; requiring an explicit distance is one number, not a burden.
