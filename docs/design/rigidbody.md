# RigidBody2D and contact events

Design notes for the two remaining dynamic-physics roadmap items:
`RigidBody2D` (dynamic bodies under gravity, forces, and impulses) and
contact events on solid bodies (v1 events were sensor overlaps via
`Area2D` only). They ship together because contact events matter most for
dynamic bodies: things that fall, bounce, and knock into each other.

## Goals

- Dynamic bodies as ordinary units: enter the tree, simulate, tear down on
  exit — exactly like `StaticBody2D` / `CharacterBody2D` / `Area2D`.
- Make `PhysicsWorld2D.gravity` real (it previously affected nothing).
- `onContactStarted` / `onContactEnded` events on bodies, drained during
  the world's tick like `Area2D` overlap events, with the peer unit and
  cheap contact info (point + normal).
- No new concepts: same layer/mask model, same `CollisionShape2D` children,
  same escape hatches (`body`, `colliders`, `physicsWorld`).

## Transform ownership

The existing rule was "transforms have one owner per body type": you move
characters and areas, static bodies don't move. Dynamic bodies add the
third case: **the simulation owns the transform.**

- **After each world step**, `RigidBody2D` writes the Rapier body's pose
  back to `position` / `rotation`. These are ordinary observable setters,
  so `position$` / `rotation$` fire and rendering follows with no extra
  wiring. The write-back is skipped when the pose did not change (sleeping
  bodies fire nothing).
- **Setting `position` or `rotation` on a dynamic body teleports it.** The
  body detects an external assignment (the observable holds a value the
  write-back didn't produce) and pushes the new pose into Rapier before the
  next step with `setTranslation` / `setRotation`. Velocities are
  preserved, matching Godot's behavior when you move a `RigidBody2D`:
  teleporting is an explicit "respawn/reset" tool, not a way to drive the
  body. Drive dynamic bodies with velocities, forces, and impulses.
- **A dynamic body's pose is effectively world-space.** On spawn the body
  is placed at its unit's *world* transform (so a stack builder can offset
  a whole group through a parent). After that, the simulation integrates
  in world space and the write-back converts back to local coordinates
  through the parent chain each step (`parent.worldTransform.invert()`,
  same math as `CharacterBody2D.moveAndSlide`). Consequence: **moving the
  parent of a live dynamic body does not drag the body along** — the body
  keeps its simulated world pose and its local transform is recomputed to
  compensate. This mirrors Godot (a `RigidBody2D` ignores parent motion)
  and avoids the alternative — treating parent motion as an implicit
  teleport every step — which would fight the solver and made stacks
  explode in testing. The conversion is exact only for unscaled, unsheared
  parents, which the existing "no scale or shear on physics units" rule
  already requires.

## API surface

```ts
class RigidBody2D extends CollisionObject2D {
  // Props (constructor-only, like layer/mask on the base class)
  density?: number;         // per-collider density; mass = density × area. Default 1.
  friction?: number;        // Coulomb friction. Default 0.5 (Rapier default).
  restitution?: number;     // bounciness 0..1. Default 0.
  linearDamping?: number;   // velocity decay per second. Default 0.
  angularDamping?: number;  // spin decay per second. Default 0.
  gravityScale?: number;    // multiplier on world gravity. Default 1.
  fixedRotation?: boolean;  // lock rotation (top-down movers, pucks). Default false.
  canSleep?: boolean;       // allow the solver to sleep the body. Default true.
  ccd?: boolean;            // continuous collision detection for fast movers. Default false.
  linearVelocity?: Vector;  // initial velocity.
  angularVelocity?: number; // initial spin, rad/s.

  // Accessors (read/write; live values come from the simulation)
  linearVelocity: Vector;
  angularVelocity: number;
  readonly mass: number;      // computed by Rapier from colliders (0 off-tree)
  readonly sleeping: boolean;

  // Forces and impulses (world-space)
  applyForce(force: Vector): void;          // this step only; call every tick to sustain
  applyTorque(torque: number): void;        // this step only
  applyImpulse(impulse: Vector): void;      // instant velocity change (mass-scaled)
  applyTorqueImpulse(impulse: number): void;
  applyImpulseAt(impulse: Vector, worldPoint: Vector): void; // off-center → spin
  wakeUp(): void;
}
```

Decisions and why:

- **Mass via `density`, not a `mass` prop.** Rapier computes mass from
  collider density × area, which composes naturally with multiple
  `CollisionShape2D` children and keeps the center of mass right. A flat
  `mass` prop would need to answer "how is it split across shapes?".
  `mass` stays available as a read-only accessor, and
  `body.setAdditionalMass` is a one-liner through the escape hatch.
- **`friction` / `restitution` live on the body, applied to every
  collider.** Rapier stores them per collider, but v1 `Shape` is plain
  data (`rect(w, h)`) with no material slot, and one material per body
  covers the overwhelming case. Per-shape materials can be added to
  `Shape` later without breaking this. The `colliders` escape hatch lets
  you differentiate today.
- **Velocity accessors are *not* observable (`$`) channels.** They change
  every step for every awake body; an observable would fire 60×/s per body
  with no consumer (rendering follows `position$`, which already fires
  from the write-back). Game code reads velocity in `tick`, where a plain
  getter is enough. This is a deliberate exception to the x/x$ convention,
  documented on the class.
- **`applyForce`/`applyTorque` act for one physics step.** Rapier's
  `addForce` persists until reset, which is a footgun for tick-based game
  code ("I applied a force once and it never stopped"). The body resets its
  accumulated forces after each step, giving Godot-style semantics: apply
  every tick to sustain. Multiple calls within one tick accumulate.
  Persistent forces remain available via `body.addForce` directly.
- **Off-tree behavior**: force/impulse methods are no-ops off-tree;
  velocity setters are latched and applied when the body (re)enters a
  world; velocity getters return the latched value (snapshotted on tree
  exit), `mass` returns 0 and `sleeping` false.

## Contact events

```ts
// Opt in on at least one side of a pair:
mes(RigidBody2D, { contactEvents: true }, [...])

body.onContactStarted.addListener(({ other, point, normal }) => ...);
body.onContactEnded.addListener(({ other }) => ...);   // point/normal null
```

- **Where they live:** `onContactStarted` / `onContactEnded` on
  `CollisionObject2D`, so they work on static, character, and rigid bodies
  alike (Rapier generates the events for any collider pair once asked).
  Naming follows the `Area2D` style (`onBodyEntered`) — `on` + noun + past
  participle; "contact started/ended" matches Rapier's own event
  vocabulary and avoids overloading "entered", which in this codebase
  means sensor overlap.
- **Opt-in via the `contactEvents` prop (default off).** Rapier only
  generates collision events for colliders flagged with
  `ActiveEvents.COLLISION_EVENTS`, and every flagged pair costs event
  generation and queue traffic each step. Since a pair reports if *either*
  collider is flagged, opting in one body (the cannonball) is enough to
  hear about all its contacts — flagging every wall by default would be
  pure overhead. When the flag is set on a kinematic or fixed body, the
  collider also gets `ActiveCollisionTypes.ALL` so kinematic↔fixed pairs
  are computed at all (Rapier skips them by default); this affects only
  narrow-phase pair detection, never solving.
- **Both units of a pair receive the event**, whichever side opted in —
  the pair reported, and routing to one side only would make behavior
  depend on which unit carried the flag.
- **Payload** is `{ other, point, normal }`. `point` is the first solver
  contact (world space) and `normal` the manifold normal oriented from the
  receiving unit toward `other`; both are fetched via `world.contactPair`
  only when a listener is present, and only for *started* events (Rapier
  has no manifold for a pair that just separated, so ended events carry
  `null`s). v1 deliberately exposes one representative point rather than
  the full manifold or impulse data — the raw manifolds stay reachable via
  `physicsWorld.world.contactPair(...)`.
- **Routing:** the world's existing `drainCollisionEvents` loop now
  branches: pairs involving a sensor go to `reportOverlap` (the `Area2D`
  path, unchanged), solid pairs fire contact events. Events fire during
  the world's tick — before descendant ticks — so game logic sees this
  frame's contacts, same as overlap events.

## Rapier mapping

| Mise | Rapier |
| --- | --- |
| `RigidBody2D` enter | `RigidBodyDesc.dynamic()` + damping/gravityScale/CCD/sleep/velocity, `lockRotations()` when `fixedRotation` |
| `density`/`friction`/`restitution` | `ColliderDesc.setDensity/Friction/Restitution` on each shape's collider |
| write-back | `body.translation()` / `body.rotation()` after `world.step` |
| teleport | `body.setTranslation` / `body.setRotation` (wake = true) |
| `applyForce` etc. | `addForce` / `addTorque` / `applyImpulse` / `applyTorqueImpulse` / `applyImpulseAtPoint`, then `resetForces`/`resetTorques` after the step |
| `contactEvents` | `ColliderDesc.setActiveEvents(COLLISION_EVENTS)` (+ `ActiveCollisionTypes.ALL` on non-dynamic bodies) |
| contact info | `world.contactPair(c1, c2, cb)` → `manifold.normal()`, `manifold.solverContactPoint(0)` |

## Alternatives considered

- **Kinematic-style ownership (unit drives, sim follows)** — rejected:
  it isn't a dynamic body then; the whole point is solver-integrated
  motion. Rapier's `setNextKinematicTranslation` doesn't exist for
  dynamic bodies.
- **Error on setting `position` of a live dynamic body** — rejected as
  hostile: respawns, level resets, and "grab and drop" tools all want
  teleporting, and Godot/Unity both allow it. Documented instead.
- **Parent motion drags the body (re-push world transform every step)** —
  rejected: every parent move becomes a teleport that fights the solver
  (jitter, tunneling, exploding stacks), and the cost is a matrix compose
  + compare per body per step even when nothing moves. The world-space
  rule is simpler to reason about and matches Godot.
- **v1 restriction: dynamic bodies must sit directly under the world** —
  rejected: the parent-chain conversion is three matrix ops already used
  by `CharacterBody2D`, and grouping spawned content under an offset
  parent is too useful to ban.
- **`contactEvents` always on for `RigidBody2D`** — rejected: most
  dynamic bodies (debris, crates) never consume contacts, and Rapier
  charges per flagged pair. One prop on the interested body is cheap and
  explicit.
- **Lazily enabling events when a listener attaches** — rejected:
  requires hooking `addListener` and patching live colliders; too much
  machinery for saving one prop.
- **Exposing full manifolds / contact impulses in the payload** —
  deferred: allocation-heavy for data most games ignore; the raw
  narrow-phase is one escape hatch away.
