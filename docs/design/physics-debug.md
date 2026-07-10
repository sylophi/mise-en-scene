# Physics debug draw

Dev-mode visualization of colliders, areas, and raycasts over the rendered
game. Two halves with a hard boundary between them:

- **Data** (`@mise/physics`): a renderer-agnostic snapshot API,
  `debugSnapshot(world)`, plus an opt-in raycast ring buffer,
  `world.rayLog`.
- **Drawing** (`@mise/physics-debug`, new package): `PhysicsDebug2D`, a
  drop-in `Renderable` that draws the snapshot as an SVG overlay through the
  ordinary React compositor.

## Dependency placement

The rule to keep honest: `@mise/physics` must not depend on `@mise/react`
(they are siblings over `@mise/core`). Three options were considered:

1. **A React component in a physics subpath** (`@mise/physics/debug`). Puts
   `react` in physics' peer dependencies and a `.tsx` file in a package that
   is otherwise renderer-free. The import graph would say physics knows about
   React, subpath or not. Rejected.
2. **Only a data API in physics, overlay code in the example/docs.** Keeps
   the graph clean but makes the overlay copy-paste instead of drop-in; every
   game re-owns ~200 lines of SVG. Rejected as the whole story, kept as the
   foundation.
3. **A small new package `@mise/physics-debug`** depending on
   `@mise/physics`, `@mise/react`, and `react` (peer). Chosen: the
   dependency arrows in `package.json` files match reality exactly, physics
   and react stay ignorant of each other, and the overlay is one import away.
   A debug tool is also the natural thing to exclude from production installs,
   which a separate package makes trivial.

So: **physics exposes the data; a new package draws it.** The split also
leaves the door open for a future canvas/WebGL renderer to consume the same
`debugSnapshot` without touching either existing package.

## The data API

### `debugSnapshot(world): DebugShape[]`

One entry per collider: `{ handle, role, shape, position, rotation, unit? }`,
with `shape` the package's own plain `Shape` data (`rect`/`circle`/`capsule`,
world units) and the pose in world space.

Two deliberate choices:

- **Poses are read back from Rapier** (`collider.translation()`/
  `.rotation()`), not recomputed from unit transforms. Debug draw's job is to
  show what the *simulation* is colliding; if a unit and its body ever
  desync, the overlay should expose that, not paper over it. Reading
  colliders also picks up shape offsets, body rotation, and anything created
  through the `body`/`colliders` escape hatches for free. The visible cost:
  the drawn pose trails a moving unit by the movement made in its own tick
  (transforms are pushed at the next world tick) — under a frame, and it is
  the honest number.
- **Roles come from simulation state, not unit classes**: sensor → `area`,
  fixed → `static`, kinematic → `character`, dynamic → `dynamic`. When
  `RigidBody2D` lands, its colliders classify (and color) correctly with zero
  changes to the debug code.

Rapier's built-in `world.debugRender()` (raw vertex/color buffers) was
evaluated and passed over: it returns flat float arrays with Rapier's own
color scheme, loses the shape/role structure (no "this is an area" or "this
belongs to that unit"), and can't be unit-tested as data. Reconstructing the
three wrapped shape kinds from collider state is ~10 lines and exact —
capsule caps included, since SVG draws a true stadium. Unwrapped Rapier
shapes (trimeshes, polylines) are skipped; if the package ever wraps them,
`debugSnapshot` grows a case.

### `world.rayLog` (opt-in ray recording)

A fixed-capacity ring buffer (default 128) on `PhysicsWorld2D`. While
`rayLog.enabled` is true, every `castRay` appends
`{ origin, direction, maxDistance, hit, time, seq }`; while false (the
default) the cost is one boolean check per cast and zero allocation. The
overlay enables it on tree enter and restores the previous value on exit, so
recording is exactly coextensive with something that can display it.

## The overlay: a unit, not a provider child

`PhysicsDebug2D extends Renderable`. The roadmap sketched two shapes — a
`<PhysicsDebugOverlay/>` as a `MiseProvider` child, or a unit in the tree —
and the unit wins decisively:

- `MiseProvider` children render *outside* the stage, so a provider-child
  overlay would have to re-derive the letterboxed stage rect, `--u`, and the
  inverse camera view transform — re-implementing the compositor's core.
- As a `Renderable`, the compositor gives it camera tracking, `--u`
  resolution independence, and z-ordering for free, and it lives and dies
  with the scene (`changeScene` cleans it up like everything else).

Placed as a direct child of the `PhysicsWorld2D`, which is the natural spot:
the world is a plain `Unit`, so the `Unit2D` transform chain resets there and
the overlay's local space *is* world space.

### Data flow, per frame

1. `tick` (fixed step, after the world's own tick since the engine walks
   parent-first): check the toggle key; if visible, bump `frame$`.
2. The component subscribes to `frame$` (and `visible$`) via
   `useObservable`, so it re-renders once per fixed tick while visible.
3. On render it calls `debugSnapshot(world)` and filters `rayLog` by age,
   computes the world-space bounding box of everything drawn, and emits one
   `<svg>` whose CSS box is that rect in camera units
   (`calc(n * var(--u))`) and whose `viewBox` is the same rect in world
   units — so all drawing coordinates are plain world coordinates, and
   resize stays a pure CSS reflow like every other renderable.

No engine events, no compositor changes, no per-frame work while hidden
(one key check), nothing at all when not mounted.

### Draw list

- Every collider's outline, color-coded by role: green static, blue
  character/kinematic, orange dynamic (reserved for `RigidBody2D`), yellow
  areas. Capsules are exact (SVG rounded rect with corner radius = capsule
  radius is a true stadium); strokes use `vector-effect:
  non-scaling-stroke` so lines stay hairline at any zoom.
- **Areas are filled** (15% opacity) as regions; **bodies are outlined** as
  surfaces.
- Recent raycasts, fading out over `rayTtl` (default 1s): pink with a hit
  marker and surface normal where they hit, gray where they missed.
  Unbounded misses are drawn 200 world units long.
- Contact points: not in v1. Rapier only exposes contacts through
  narrow-phase queries per pair; cheap access arrives with the contact-events
  roadmap item, and the draw list can grow a case then.

### Toggle story

`visible` is an ordinary observable accessor: set it from code, or let the
built-in `toggleKey` (default `` ` ``, the tilde key; `null` disables)
flip it via `input.justPressed`. `startVisible: false` ships the overlay
dormant. Hidden ⇒ the component renders `null` and the per-tick work is one
key check.

## Testing

The data half is plain-value testable and tested in
`physics/src/debug.test.ts`: snapshot contents for known scenes (roles,
shape kinds, world poses including offsets and rotation, the one-tick lag),
ray recording opt-in/off behavior, ring-buffer eviction. The overlay has a
light jsdom test (`physics-debug/src/debug-overlay.test.tsx`): role-coded
elements appear, key toggling works, `rayLog` is enabled/restored, rays
draw. Pixel-accuracy is left to the example app (`examples/physics-debug/`).
