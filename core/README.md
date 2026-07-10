# @mise/core

The headless engine of [Mise en Scène](../README.md). Pure TypeScript, zero
dependencies, no DOM. It owns the scene tree and the simulation; renderers
(like [`@mise/react`](../react/README.md)) observe it and draw however they
want.

## The model

An `Engine` owns a `Root` unit and drives two loops over the tree. A unit is
**live** (ticked, lifecycle-active) exactly when it is connected up to that
root. Instantiating a unit does nothing by itself: `new Enemy()` exists but
is inert until something attaches it to the live tree.

```
Engine ── Root ──┬── (your scene)
                 │      ├── Player (Unit2D)
                 │      │     └── Sword (Unit2D)
                 │      └── Spawner (plain Unit, invisible logic)
                 └── Camera (a Unit2D like any other)
```

## Units

```
Unit ──┬── Unit2D ──── Camera
       └── Root
```

### `Unit`

The base. Ticks, holds reactive state, lives in the tree. Invisible by
itself; use plain units for managers, spawners, timers, and controllers.

| Member | Notes |
| --- | --- |
| `id` | Stable string, auto-generated unless passed in props. |
| `parent`, `children`, `root` | Tree accessors. `children` is readonly. |
| `findAncestor(Ctor)` | Nearest ancestor that is an instance of `Ctor`, or null. How units find a containing system (e.g. a physics body locating its world on tree enter). |
| `addChild(child)` | Attaches (reparents if needed). Throws on cycles and on cross-engine moves. |
| `removeChild(child)` | Detaches without destroying. |
| `destroy()` | Removes from the tree and destroys the subtree bottom-up. Permanent. |
| `engine` | The bound `Engine`. Typed non-null: every live unit has one. Reading it on a detached unit returns null at runtime; that is a caller bug (check `isLive` if unsure). |
| `isLive`, `destroyed` | State queries. |
| `onParentChanged` | `ObservableEvent<Unit \| null>`, fires after `parent` changes (attach, reparent, detach). |
| `onDestroyed` | `ObservableEvent<void>`, fires once after destruction (children already destroyed, `onDestroy` already run). The hook for external lifetime cleanup, e.g. `u.onDestroyed.addListener(() => gsap.killTweensOf(u))`. |
| `props` | The constructor props, retained verbatim (`protected`). Pass-through subclasses read `this.props.title` instead of copying fields; type it via the class generic: `class Sign extends Unit2D<SignProps>`. |

**Lifecycle hooks** (override in subclasses):

- `onTreeEnter(parent)` fires every time the unit enters the live tree,
  top-down (parents before children).
- `onTreeExit(parent)` fires every time it leaves, bottom-up. The unit is
  already detached when it fires.
- `onDestroy()` fires once, when torn down for good.

**Lifetime-scoped subscriptions.** `observeUntilDestroyed(observable, cb)`
subscribes to any `ObservableValue`/`ObservableEvent` for the unit's lifetime
and disposes automatically on `destroy` (returns the unsubscribe for early
opt-out). Mirrors Godot, where freeing a node severs its signal connections:
leaving the tree does *not* unsubscribe, so callbacks can fire while the unit
is off-tree, where `engine` is null.

```ts
class FollowCamera extends Camera {
  constructor(props: FollowCameraProps) {
    super(props);
    this.observeUntilDestroyed(props.target.hit$, () => this.kick());
  }
}
```

**Timers.** Engine-driven on the fixed clock, so they work even in subclasses
that override `tick` without calling super. They freeze while the unit is
off-tree and are cancelled by `destroy`.

- `after(delay, cb)`: one-shot. Returns a cancel function.
- `every(interval, cb)`: repeating, first fire after one full interval.
  Returns a cancel function.
- `cooldown(duration)`: returns a `Cooldown` with `ready`, `remaining`,
  `start(duration?)`, and `reset()`. Starts ready.

```ts
this.after(0.4, () => this.arm());
private fireCd = this.cooldown(0.16);
override tick(dt: number) {
  if (this.engine.input.isDown(" ") && this.fireCd.ready) {
    this.fireCd.start();
    this.fire();
  }
}
```

**Tick hooks**, driven by the engine, depth-first top-down over every live
unit:

- `tick(dt)`: fixed-step simulation logic. `dt` in seconds.
- `deviceTick(dt)`: variable-step, render-aligned logic. `dt` in seconds.

**Engine binding rules.** Binding mirrors liveness: it is inherited from the
parent on `addChild`, propagates down the attached subtree, and clears on
detach. A currently bound subtree can never join a different engine's tree
(`addChild` throws); a fully detached subtree may be mounted anywhere.
Same-engine reparenting fires no enter/exit; listen to `onParentChanged` (or
the engine's `onUnitMoved`) for structural changes.

### `Unit2D extends Unit`

A unit with a place in 2D space. May still be invisible (trigger zones,
waypoints, spawn points).

- Local transform accessors: `position: Vector`, `rotation: number` (radians),
  `scale: Vector`. Plain assignment fires the channels, so simulation code
  reads naturally: `this.rotation += dt`,
  `this.position = this.position.add(v)`.
- The channels behind them: `position$`, `rotation$`, `scale$`, each an
  `ObservableValue`. Subscribe to these (see the `x`/`x$` convention below).
- `localTransform` returns the three as a plain `{ position, rotation, scale }`.
- `localMatrix` returns them as a `Matrix2D` (translate · rotate · scale).
- `worldTransform` returns the absolute transform as a `Matrix2D`, composed
  by matrix multiplication up the chain of *contiguous* `Unit2D` ancestors.

**Transform rules worth knowing:**

- Inheritance breaks at the first non-`Unit2D` ancestor. A plain `Unit`
  resets the origin, so its `Unit2D` children form a fresh transform subtree.
- World transforms are matrices, not position/rotation/scale triples, so
  non-uniform ancestor scale over a rotated child shears correctly. This
  matches Godot, whose rendering also composes `Transform2D` by full matrix
  multiplication. (v1 computes on read with no caching.)

### `Camera extends Unit2D`

Defines the logical coordinate space the world is viewed through. It lives in
the tree, so it can be parented, moved, and animated like anything else.

- `width`, `height`: the logical viewport, a design resolution like 100x56.25.
  Number accessors backed by the `width$`/`height$` channels; `aspect` derives
  width/height.
- `position` is the **center** of the view. The visible rect spans
  half the width and height to each side. Coordinates are y-down.
- One camera is active at a time, held by `engine.activeCamera`, and
  **activation follows the tree**: a camera entering the live tree claims the
  slot when no camera is active (or steals it when constructed with
  `active: true`), and an exiting active camera releases it. `changeScene`
  therefore hands the slot from the old scene's camera to the new one with no
  wiring.
- Renderers apply the inverse of the camera's **view transform**: the world
  transform with its translation replaced by the resolved view center
  (`viewTransform`, `viewCenter`/`viewCenter$`). The view center is the
  camera's world position passed through three optional stages, each a
  reactive prop/accessor pair:
  - `smoothing` (rate per second, 0 disables): the view chases the camera's
    position with framerate-independent damping, advanced on the fixed clock
    while the camera is active. It snaps on tree enter, never lerps in.
  - `limits` (`{ left?, top?, right?, bottom? }`, world-space): the view
    rectangle is kept inside the bounds; a span narrower than the view
    centers on it. Limit math ignores camera rotation and scale.
  - `offset` (`Vector`): an additive displacement applied last, ignored by
    smoothing and limits. The seam for screen shake and look-ahead: write
    jitter here and never touch `position`.

  With none of them set, the view transform equals the world transform.
  Moving the camera pans the view, scaling zooms, rotating rotates.

```ts
interface GameCameraProps extends CameraProps {
  target: Unit2D;
}
class GameCamera extends Camera<GameCameraProps> {
  constructor(props: GameCameraProps) {
    super({ smoothing: 5, limits: WORLD_BOUNDS, ...props });
  }
  override tick() {
    this.position = this.props.target.position; // smoothing/limits do the rest
  }
}
```

### `Root extends Unit`

The structural top of the tree, created and held by the `Engine`. It ticks
like any unit but has no transform, so it is naturally a transform origin.

## Building scenes

`mes(Class, props, options?, children?)` instantiates immediately and returns
a live but **treeless** unit. (`mes` is short for Mise en Scène.) When you
have no options, children may take the third slot: a third argument that is
an array is taken as `children`.

```ts
mes(Player, { position: spawn, hp: 100 }, [
  mes(Sword, { damage: 5 }),
  mes(HealthBar, { color: "red" }),
])
```

- `props` is exactly the class constructor's single argument, fully typed
  with autocomplete. Props compose up the inheritance chain, each class
  consuming its slice via `super`:

  ```ts
  type UnitProps   = { id?: string }
  type Unit2DProps = UnitProps   & { position?: Vector; rotation?: number; scale?: Vector }
  type PlayerProps = Unit2DProps & { hp: number }
  ```

- Props are one-time seeds: they set initial field values, then the unit
  owns its state.
- `options` carries instantiation-time concerns that are *not* unit data
  (currently just `ref`, below). They stay out of `props` so props always
  mirror the constructor.
- Lifecycle does not fire during building. The subtree is treeless until the
  engine mounts it, at which point binding and `onTreeEnter` cascade top-down.

A **scene** is just a typed function `(props) => Unit` that calls `mes`. The
laziness is the un-called function; embedding a scene is calling it.

```ts
const Hero = (props: { hp: number }) =>
  mes(Player, { hp: props.hp }, [mes(Sword, { damage: 5 })])

const Level = () =>
  mes(World, {}, [
    Hero({ hp: 100 }),
    Hero({ hp: 50 }),
    mes(Enemy, { position }),
  ])
```

### Holding references

Scenes are plain functions and `mes` returns the real instance, so the first
idiom for "this unit needs that unit" is ordinary code: **hoist the const and
pass it around**. No searching, no registries.

```ts
function Level(): Unit {
  const player = mes(Player, { position: SPAWN });
  return mes(Stage, {}, [
    player,
    mes(GameCamera, { target: player, width: 100, height: 56.25 }),
    mes(Director, { player }),
  ]);
}
```

Hoisting can't reach two cases: the unit doesn't exist yet (a HUD declared
now, a player spawned later) or it is created inside a scene function you are
composing. For those, declare a `UnitRef` and point a placement at it:

```ts
const playerRef = unitRef<Player>();

mes(Hud, { player: playerRef }),       // declared before the player exists
mes(Player, { position: SPAWN }, { ref: playerRef }),
```

The ref fills with the instantiated unit and clears back to null when that
unit is destroyed, so a held ref never goes stale (Godot's freed-node
semantics, made explicit). It is single-occupancy: the last placement wins,
and a respawn that re-fills the ref is not clobbered by the old unit's death.
`current`/`current$` follow the `x`/`x$` convention, so a React HUD can
`useObservable(playerRef.current$)` to track spawn and death. Holders read
`current` lazily (in `tick`, in render) and treat null as "not there right
now". For "all enemies", a ref is the wrong tool: pass a container unit as a
prop instead.

## `Engine`

```ts
const engine = new Engine({ fixedStep: 1 / 60 }); // starts immediately
engine.changeScene(Level());
```

| Member | Notes |
| --- | --- |
| `root` | The `Root` unit. |
| `input` | The input manager (below). |
| `activeCamera` | `Camera \| null` accessor backed by the `activeCamera$` channel renderers subscribe to. |
| `time` | Total simulated seconds, advancing in fixed steps. |
| `start()` / `stop()` / `running` | Loop control. |
| `changeScene(unit, { destroyPrevious? })` | Swaps the scene under root. Destroys the previous scene by default; pass `false` to detach it for reuse. Only manages scenes it mounted: units added directly under root (persistent managers, cameras) are left alone. |
| `onUnitEnter` / `onUnitExit` | `ObservableEvent<Unit>`, fired as units enter (top-down) and leave (bottom-up) the live tree. |
| `onUnitMoved` | Fired on same-engine reparents, which fire no enter/exit. Renderers refresh draw order from this. |
| `advanceFixed(dt)` / `advanceDevice(dt)` | Manual stepping for headless use and tests. |

Options: `fixedStep` (default 1/60), `maxCatchUp` (default 5),
`maxDeviceDt` (default 0.1), `autoStart` (default true).

**Two loops.** The fixed loop runs `tick` via `setInterval` with an
accumulator: it measures real elapsed time and runs catch-up steps when late,
capped at `maxCatchUp` to avoid the spiral of death (excess backlog is
dropped). The device loop runs `deviceTick` via `requestAnimationFrame` at
the display rate; it pauses on hidden tabs, and `dt` is clamped to
`maxDeviceDt` so the first frame after a long pause doesn't take a giant step.

## `Input`

Headless input manager at `engine.input`. A renderer/adapter feeds it real
device events through the `feed*` API; game code reads it in either style.
Payloads (`KeyInput`, `PointerInput`) are neutral types, not DOM events, and
pointer positions are in **world coordinates** (the adapter maps pixels
before feeding).

```ts
// polling, inside tick
if (engine.input.isDown("a")) { ... }
if (engine.input.justPressed(" ")) { jump() }

// events, anywhere
engine.input.onPointerDown.addListener(({ position }) => { ... })
```

Polling: `isDown(key)`, `justPressed(key)`, `justReleased(key)`,
`isButtonDown(button)`, `pointer` (a read-only `Vector` accessor; subscribe
via `pointer$`).
Events: `onKeyDown`, `onKeyUp`, `onPointerDown`, `onPointerUp`,
`onPointerMove`.

**Keys identify the physical key, not the produced character.**
Single-character keys are normalized to lowercase at the feed and the query,
so `"j"` and Shift's `"J"` are the same key, and a key held across a Shift
press can't get stuck down. Named keys (`"ArrowUp"`, `"Enter"`, `" "`) pass
through unchanged.

## Reactive primitives

### The `x` / `x$` convention

Public reactive state follows one pattern: the channel (an `ObservableValue`)
lives at `name$`, and a same-named accessor pair exposes the value. Simulation
code gets natural assignment, including `+=`; subscribers use the channel. The
`$` suffix is Finnish notation from the Rx world, marking "this is the
subscribable channel, not the value".

Declare the trio together (channel, then getter, then setter) so it reads as
one variable; the engine's own classes follow this layout.

```ts
class Player extends Renderable {
  readonly hp$ = new ObservableValue(100);
  get hp() { return this.hp$.get(); }
  set hp(v: number) { this.hp$.set(v); }

  override tick(dt: number) {
    this.hp -= 5 * dt;   // fires hp$ listeners
    this.rotation += dt; // built-in fields follow the same convention
  }
}
```

All built-in reactive fields come in these pairs: `position`/`position$`,
`rotation`, `scale`, `width`, `height`, `z`, `activeCamera`, `pointer`. One
footgun to remember: reading `unit.hp` inside a React component never
subscribes. Components must read through `useObservable(unit.hp$)`.

### `@observable` accessor sugar

The trio collapses to one line with a standard (TC39) decorator on an
`accessor` field — plain TypeScript 5+, no `experimentalDecorators`:

```ts
class Player extends Renderable {
  @observable accessor hp = 100;
  // ≡ readonly hp$ = new ObservableValue(100);
  //   get hp() { return this.hp$.get(); }
  //   set hp(v: number) { this.hp$.set(v); }
}
```

The result is exactly the trio's public shape: `hp` is a real getter/setter
pair on the prototype (so `+=` works and tween libraries can drive it), and
`hp$` is a real per-instance, read-only `ObservableValue` seeded with the
initializer. `ObservableValue` options thread through the factory form, and
constructor seeding stays plain assignment:

```ts
@observable({ equals: structuralEquals }) accessor pos = Vector.zero;

constructor(props?: PlayerProps) {
  super(props);
  if (props?.hp !== undefined) this.hp = props.hp;
}
```

**The typing caveat.** A decorator cannot add declared members to a class
type, so `hp$` exists at runtime but TypeScript does not know about it. Two
ways to get the typed channel:

```ts
// 1. Declare it (one line; shows up in autocomplete, it's your public API):
declare readonly hp$: ObservableValue<number>;

// 2. Or look it up, typed from the accessor it backs:
useObservable(channel(player, "hp")); // ObservableValue<number>
```

`channel(obj, "name")` also finds manual trios (same `name$` convention) and
throws if `name$` is not an `ObservableValue`. Only public, string-named
instance accessors can be decorated (the channel name is derived by
appending `$`, and it must be reachable from outside).

**Toolchain note.** Type-wise this is standard TypeScript; at runtime your
bundler must lower TC39 decorators. esbuild-based tools (Vite 7, esbuild
0.21+) do when the target is `es2022` (not `esnext`, which passes them
through); oxc-based Vite 8 cannot yet. This repo pins Vitest's Vite to 7 for
that reason.

### `ObservableEvent<T>`

A pure event, no stored value. `addListener(cb)` returns an unsubscribe
function; `fire(payload)` notifies listeners (snapshot iteration, so
listeners may add/remove during dispatch).

### `ObservableValue<T>`

Holds a value. `get()`, `set(value)`, `addListener(cb)`. Listeners fire only
on the next change, never on subscribe. `set` is a no-op (fires nothing) when
the new value is `===` the current one — or equal under an optional
comparator:

```ts
new ObservableValue(Vector.zero, { equals: structuralEquals })
```

`equals: (a, b) => boolean` decides whether a `set` is a no-op; the `===`
fast path always applies first, and a suppressed set keeps the old reference
(subscribers like React see a stable snapshot). `structuralEquals` is the
built-in comparator for immutable value objects: same reference, or
same-class instances whose `equals` method (like `Vector`'s) returns true.
Without the option, comparison is `===` as in v1, so prefer immutable values
like `Vector`.

### `Vector`

Immutable 2D vector with `readonly x, y`, shared by position and scale.
`add`, `sub`, `scale(s)`, `mul(v)` (component-wise), `rotate(rad)`, `dot`,
`cross`, `length`, `lengthSquared`, `normalize`, `lerp(v, t)`, `angle()`,
`equals`, plus `Vector.zero` / `Vector.one` / `Vector.fromAngle(rad, length?)`.

### Math helpers

Free functions (JS has no built-ins for these): `clamp(v, min, max)`,
`lerp(a, b, t)`, and `damp(a, b, lambda, dt)`, the framerate-independent
exponential approach (`lambda` per second, higher is snappier) behind camera
smoothing.

### `Matrix2D`

Immutable 2x3 affine matrix in CSS `matrix(a, b, c, d, tx, ty)` order; the
world-transform representation. `Matrix2D.fromTRS(position, rotation, scale)`,
`multiply(m)` (the argument applies to a point first), `invert()`,
`apply(v)`, `Matrix2D.identity`. Unlike a TRS triple, a matrix composes
exactly: non-uniform scale under rotation produces shear, which only a
matrix can hold.
