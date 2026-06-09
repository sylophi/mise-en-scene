# mise/core — Spec Sheet

The headless game engine. Pure TypeScript, zero dependencies, no DOM, no React.
A renderer (e.g. `mise/react`) observes the engine and draws it however it wants.

## Design principles

- **Decoupled rendering.** The engine is framework-agnostic. Rendering is a plugin
  that observes the engine. React-DOM is one renderer; canvas, WebGL, terminal,
  headless-test are others.
- **Two renderer modes the engine must serve:**
  - *Retained-mode* (React-DOM, raw DOM): needs lifecycle events + change
    subscriptions to touch only what changed. Served by the reactive primitives.
  - *Immediate-mode* (canvas, WebGL): ignores subscriptions, polls live state each
    frame. Served by the enumerable tree.
- **Instantiated ≠ in the tree.** A `new Unit()` exists but is inert (not ticked).
  Being in the tree (under the root) is what makes it live.

---

## Reactive primitives

### `ObservableEvent<T>`
A pure event. No stored value.

- `fire(payload: T)` — notify all listeners with the payload.
- `addListener(cb: (payload: T) => void): Unsub` — register; returns an unsubscribe.

### `ObservableValue<T>`
Holds a value; notifies on change.

- `get(): T`
- `set(value: T)` — updates and fires listeners. **Skips firing if `value === current`.**
- `addListener(cb: (value: T) => void): Unsub` — register; returns unsubscribe.
- Listeners fire **only on the next change**, never immediately on subscribe.

> A future compile step may rewrite `x = v` → `x.set(v)`. For now: explicit `.get()`/`.set()`.

### `Vector`
Immutable 2-component vector. `readonly x, y`. Shared for position and scale.
All methods return new `Vector`s.

- `add(v)`, `sub(v)` — vector +/−
- `scale(s)` — multiply by scalar
- `mul(v)` — component-wise (Hadamard); used to compose scale
- `rotate(rad)` — rotate around origin
- `dot(v)` → scalar
- `cross(v)` → scalar (`x*v.y - y*v.x`)
- `length()`, `lengthSquared()`, `normalize()`

### `Matrix2D`
Immutable 2x3 affine matrix in CSS `matrix(a, b, c, d, tx, ty)` order. The world-
transform representation: unlike a position/rotation/scale triple it composes
exactly — non-uniform scale under rotation produces **shear**, which only a
matrix can hold. (Local transforms stay TRS; only composed results are matrices.)

- `Matrix2D.fromTRS(position, rotation, scale)` — translate · rotate · scale
- `multiply(m)` — compose (`m` applies to a point first)
- `invert()`
- `apply(v)` — transform a point → `Vector`
- `Matrix2D.identity`

---

## Class hierarchy

`core` provides `Unit`, `Unit2D`, and `Root`. Renderers extend these in their own
packages (e.g. `mise/react` subclasses `Unit2D` to add a view) — `core` knows nothing
about rendering.

```
Unit ──┬── Unit2D ──── Camera
       └── Root
```

### `Unit` (base)
Ticks, has reactive state, lives in a tree. Invisible. (managers, spawners, timers, controllers)

**Identity**
- `id`

**Tree** (owned here so invisible logic nodes can also be in the tree)
- `parent`, `children`
- `addChild(child)` / `removeChild(child)` — detaches but does **not** destroy
- Reparenting allowed (move via `addChild`)
- `onParentChanged` — `ObservableEvent<Unit | null>`, fires after `parent` changes
  (attach, reparent, detach) with the new parent. Same-engine reparenting fires
  no tree enter/exit, so structural observers (e.g. a renderer following an
  ancestor chain) listen here.
- Everything hangs off the **`Root`** (see below); the `Root` is held by the `Engine`.

**Engine binding**
- A unit is bound to **at most one engine at a time**; binding mirrors liveness.
  It is bound exactly while it is connected up to an engine-bound `Root`, and the
  binding clears when it detaches. A *currently bound* subtree can never be
  attached into a different engine's tree; a fully detached subtree may be
  mounted anywhere, including a different engine.
- Binding is **inherited from the parent** on `addChild` and propagates **down the
  whole subtree** being attached.
- A detached subtree you're building is **engine-less** until its top joins an
  engine-bound parent; binding flows in at that moment.
- `addChild` **throws** if the child's subtree is already bound to a *different*
  engine. (Same-engine reparenting is fine.)
- The binding originates at the `Root` via `root.setEngine(engine)`.
- `engine` — reference to the bound `Engine`. Components and logic reach global
  state through it (e.g. `unit.engine.time`). Typed **non-null** for ergonomics:
  every live unit has one and tick/lifecycle code is the intended call site.
  Reading it on a treeless/detached unit returns null at runtime — that's on
  the caller (check `isLive` if genuinely unsure).

**Lifecycle**
- `constructor` — one-time setup (runs while treeless; cannot see `parent`/siblings)
- `onTreeEnter(parent)` — fires **every** time it enters the tree (the parent being joined)
- `onTreeExit(parent)` — fires **every** time it leaves (the parent being left)
- `onDestroy()` — fires **once**, when torn down for good
- `destroy()` — removes from tree and recursively destroys children **bottom-up**
  (children destroyed first, then this unit's `onDestroy`)
- Enter is top-down (parent before children); destroy/exit is bottom-up

**Tick** (driven by the `Engine`)
- `tick(dt)` — fixed-step simulation logic. `dt` in **seconds**.
- `deviceTick(dt)` — variable-step, render-aligned logic. `dt` in seconds.
- Both fire on **every live unit**, **depth-first top-down**, each cycle. (v1: always tick everything, no per-unit toggle.)

**State**
- Declared as `ObservableEvent` / `ObservableValue` fields.

### `Unit2D extends Unit`
Has a place in 2D space; may be invisible. (trigger zones, waypoints, spawn points, sensors)

**Local transform** (relative to parent), each an `ObservableValue`:
- `position: ObservableValue<Vector>`
- `rotation: ObservableValue<number>` — radians
- `scale: ObservableValue<Vector>`

**World transform**
- `worldTransform: Matrix2D` — computed on read by multiplying matrices up the
  chain (v1: dumb, no cache, no dirty flags). Local TRS converts via
  `Matrix2D.fromTRS`; composing as matrices keeps shear exact where non-uniform
  ancestor scale meets rotation, which a TRS triple cannot represent.
- `localMatrix: Matrix2D` — the local transform as a matrix.
- **Inheritance breaks at non-`Unit2D` ancestors.** Walk up only through contiguous
  `Unit2D` parents; stop at the first non-`Unit2D` (or root). A plain `Unit` resets
  the origin — its `Unit2D` children form a fresh transform subtree.

### `Root extends Unit`
Special structural unit at the top of the tree. Origin of the engine binding.

- `setEngine(engine)` — binds this root (and its subtree) to an engine.
- Held by the `Engine`.
- It **is** a `Unit`: it lives in the tree and **ticks like any other unit**.
- It is **not** a `Unit2D` — it has no transform. (Consistent with the transform rule:
  a non-`Unit2D` ancestor breaks inheritance, so `Root` is naturally a transform origin.)

### `Camera extends Unit2D`
Defines the logical coordinate space the world is viewed through. Lives in the tree
like any unit, so it can be parented, moved, and animated.

- `width: ObservableValue<number>`, `height: ObservableValue<number>` — the **logical
  viewport** (a design resolution, e.g. `100×100`). The render surface locks to this
  aspect ratio. Units are positioned in these coordinates.
- Inherits the `Unit2D` transform. Rendering applies the **inverse of the camera's
  world transform** to the scene, so moving the camera pans the view, scaling zooms,
  rotating rotates: `world → view = inverse(cameraWorldTransform)`, then ÷ `width/height`
  to normalize.
- The camera's `position` is the **center** of the view: the visible rect spans
  ±`width/2`, ±`height/2` around it. The coordinate space is y-down (DOM-native).
- **One active camera at a time**, held by the `Engine` (see below). It does not draw
  itself; it only defines the view.

---

## `Engine`
Owns the root unit and drives the loops. Units stay pure; the engine drives them.

- Holds the **root unit**.
- `start()` / `stop()`.
- Mounts a scene by `addChild`ing the unit it returns under `Root` (binding +
  `onTreeEnter` propagate at that moment). See **Scenes & composition**.
- `activeCamera: ObservableValue<Camera | null>` — the camera the world is viewed
  through. A renderer reads this; swapping it re-renders the view. (The `Camera` itself
  is just a `Unit2D` in the tree; this is the pointer to the active one.)
- `input: Input` — the input manager (see below).
- `onUnitEnter` / `onUnitExit` — `ObservableEvent<Unit>`, fired as units enter (top-down)
  and leave (bottom-up) the live tree. Retained renderers use these to keep their
  view set in sync without re-crawling. A unit is fully detached before `onUnitExit`
  fires, so the tree already reflects the removal.
- `onUnitMoved` — `ObservableEvent<Unit>`, fired on a same-engine reparent (which fires
  no enter/exit). The moved unit may be an invisible ancestor whose subtree shifted
  with it; retained renderers refresh draw order from this.
- `changeScene(unit)` — destroys the scene it previously mounted and mounts the new
  one (a flag can detach-for-reuse instead of destroy). It only manages scenes
  mounted through it: units added directly under `Root` (persistent managers,
  cameras) are left alone, and a previous scene already detached or destroyed
  externally is not touched.
- **Fixed loop** (`tick`): `setInterval`-driven, default **60Hz** (configurable).
  Measures real elapsed time and corrects (runs catch-up steps when late). Catch-up
  is **capped** (~5 steps) to avoid the spiral of death; excess time is dropped.
- **Device loop** (`deviceTick`): `requestAnimationFrame`-driven, variable `dt`,
  device refresh rate. Auto-pauses on hidden tab; `dt` is clamped (default 0.1s,
  configurable) so the first frame after a long pause doesn't take a giant step.

---

## `Input`
Headless input manager, exposed as `engine.input`. Offers **both** event and polling
styles, built from the reactive primitives. `core` defines it; a renderer/adapter feeds
it real device events (see `mise/react`). No DOM here.

Event payloads (`KeyEvent`, `PointerEvent`) are **neutral `core` types**, not DOM events.

**Events** (`ObservableEvent`s — listen anywhere):
- `onKeyDown` / `onKeyUp` — `ObservableEvent<KeyEvent>` (raw keys; no action mapping in v1)
- `onPointerDown` / `onPointerUp` / `onPointerMove` — `ObservableEvent<PointerEvent>`

**Polling** (query inside `tick`):
- `isDown(key)` → boolean
- `pointer` — `ObservableValue<Vector>`, in **world coordinates** (the adapter
  already applied the camera transform)
- pointer button state
- "just pressed/released this tick" is derived: `down-now && !down-last-tick`

**Feed API** (called by the adapter, not game code):
- `feedKeyDown(...)`, `feedPointerMove(...)`, etc. The adapter maps pointer pixels →
  world coords before feeding.

---

## Scenes & composition

### Construction & props
- A unit's constructor takes **one typed props object**: `new Player(props)`.
  (Object, not positional — there's no runtime way to map a named object onto
  positional args, the same reason React props are objects.)
- Props **compose up the inheritance chain**, each class consuming its slice via `super`:
  ```ts
  type UnitProps   = { id?: string }
  type Unit2DProps = UnitProps   & { position?: Vector; rotation?: number; scale?: Vector }
  type PlayerProps = Unit2DProps & { hp: number; name: string }
  ```
- Props are **one-time seeds**: they set the initial values of the unit's fields /
  `ObservableValue`s and its transform, then the unit owns its state.

### `mes(Class, props, children?)`
The placement builder. **Instantiates immediately** and returns a live, **treeless** unit.

- `props` is exactly `ConstructorParameters<C>[0]` — fully typed/checked against the
  class, with autocomplete. `children` is a separate trailing arg (so `props` stays an
  exact mirror of the constructor input).
- Builds depth-first: `new Class(props)`, then `addChild`s each (already-live, treeless)
  child. Returns the live treeless top unit.
- Lifecycle does **not** fire yet — the subtree is treeless until the engine mounts it
  under `Root`, at which point binding + `onTreeEnter` cascade top-down.

```ts
mes(Player, { position: spawn, hp: 100 }, [
  mes(Sword, { damage: 5 }),
  mes(HealthBar, { color: "red" }),
])
```

### Scenes are plain functions
A scene is just a typed function `(props) => Unit` (it calls `mes`). No wrapper type.
The **laziness is the un-called function** — nothing is built until you call it (at mount).
Embedding a scene = calling it; the result nests interchangeably with `mes(...)`.

```ts
const Hero = (props: { hp: number }) =>
  mes(Player, { position: spawn, hp: props.hp }, [
    mes(Sword, { damage: 5 }),
  ])

const Level = () =>
  mes(World, {}, [
    Hero({ hp: 100 }),     // embedded + customized
    Hero({ hp: 50 }),      // reused
    mes(Enemy, { position }),
  ])
```

- A scene **declares its own props** and forwards them wherever it wants (not limited to
  overriding the top unit). Same model as React components.
- If React didn't exist, these would just be called components.

---

## Open / deferred

- `Renderable` and the render binding — designed in `mise/react`; `core` stays
  rendering-agnostic. (Renderers subclass `Unit2D` and add their own view.)
- Multiple simultaneous scenes — v1 `changeScene` swaps a single child under `Root`.
- Serialization for a future editor — walk the live unit tree (units expose a
  serialize method). Scene functions hold arbitrary logic, so only their built output
  is serializable, never the functions themselves.
- Object/array equality for `ObservableValue` (v1 uses `===`)
- Lazy-cached world transform + dirty propagation (v1 is dumb walk-up)
- Per-unit tick enable/disable toggle
- Compile step to rewrite `=` → `.set()`
