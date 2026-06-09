# mise/react — Spec Sheet

The React renderer for `mise`. A retained-mode renderer that mirrors the engine's
live unit tree into HTML elements (no canvas). Depends on `mise/core`; `core` never
depends on this.

## Relationship to core

- `core` is headless and rendering-agnostic. This package is one renderer; others
  (canvas, etc.) could exist alongside it.
- This package subclasses `core`'s `Unit2D` to add a React view (`Renderable`).
- It observes the engine: lifecycle events (tree enter/exit) keep the rendered set in
  sync; `ObservableValue` subscriptions re-render individual units.

---

## `Renderable extends Unit2D`
A `Unit2D` that draws via a React component. Generic over its own subclass so the
component is fully typed.

- `component` — a function component that defines the view. Receives `{ unit }` (this
  `Renderable` instance) as its only prop. Everything else (engine, time, root) is
  reached through the unit. Typed to the subclass:
  ```tsx
  class Player extends Renderable {
    component = ({ unit }: { unit: Player }) => {
      const hp = useObservable(unit.hp)
      return <div className="player">{hp}</div>
    }
  }
  ```
- The component is **position-agnostic** — it draws appearance at the origin. The
  compositor positions it (see transform wrapper).

---

## `<MiseProvider engine={engine}>`
The context provider **and** the compositor — one component.

- **Injected engine.** You build/configure the engine and pass it in. The engine can
  exist and run without React; this is just a viewer.
- Holds the engine in a **ref** (stable across renders; never recreated on render).
- Exposes the engine via context + a `useEngine()` hook.
- **Does not** control start/stop — the engine self-starts (configurable). Keeping
  start/stop out of React also sidesteps `StrictMode`'s double-invoked effects.
- Renders the live tree (compositor, below).

---

## Compositor (what `MiseProvider` renders)

**Flat, keyed, per-unit-subscribed.** Not a mirrored DOM tree.

- On mount: crawl the tree **once** to collect existing `Renderable`s.
- After that: subscribe to **tree enter/exit** (filtered to `Renderable`s) to add/remove
  entries, and to **`onUnitMoved`** (unfiltered — a moved invisible ancestor shifts its
  renderable subtree in draw order) to refresh order on reparents. Structure is only
  re-collected on these events, never per frame, and event bursts (N spawns in one
  tick) coalesce into a single microtask re-collect. (The per-tick simulation crawl
  in `core` is separate.)
- Renders a **keyed list** (key = `unit.id`); each `Renderable` is its **own** memoized,
  subscribed component. A unit's change re-renders only that unit — siblings and the
  container are untouched. The container reconciles only on add/remove.
- Spatial parent/child relationships are preserved by **math** (`worldTransform`), not
  DOM nesting. (Mirroring the tree into nested DOM would mismatch the transform chain,
  since the chain breaks at non-`Unit2D` ancestors and invisible `Unit2D`s emit no DOM.)

### Z-order (Godot model)
- Draw order = **`z` layer first, tree order within a layer**. `z` is an integer
  `ObservableValue<number>` on `Renderable` (default `0`); tree order is depth-first
  (parents under children, siblings in order).
- Implemented per wrapper as CSS `z-index = z * 100000 + treeOrder` — banding keeps
  every layer strictly above lower layers regardless of tree position, with no
  global sort. (Tree indices are assumed < 100000; `z` is meant to be a small
  integer layer.)

### Two-layer transform (compositor-owned)
The camera transform is applied **once** on a container; each unit wrapper carries only
its **own** `worldTransform`. So a camera move re-renders one element, not every unit.

```html
<div class="stage">                              <!-- fixed pixels; ResizeObserver sets --u -->
  <div class="viewport" style="left:50%; top:50%; transform: «inverse(cameraWorldTransform)»">
    <div class="wrapper" style="position:absolute; transform: translate(calc(tx * var(--u)), ...) matrix(a, b, c, d, 0, 0)">
      <!-- your component renders here, position-agnostic -->
    </div>
    ...
  </div>
</div>
```

World transforms are `Matrix2D`s (so shear from non-uniform ancestor scale under
rotation renders correctly). CSS `matrix()` cannot contain `var()`/`calc()`, so each
transform splits: the unitless linear part (rotation/scale/shear) goes in `matrix()`,
the translation goes in `translate(calc(n * var(--u)))` so resize still reflows via
`--u` alone. The viewport is the mirror image: `matrix(L⁻¹) translate(-t · --u)`.

- The **viewport** subscribes to the active camera (its transform + `width/height`) and
  re-renders only when the camera changes. It sits at the **stage center** (the
  camera's `position` is the center of the view), so the inverse camera transform
  acts around mid-screen.
- Each **wrapper** applies its unit's `worldTransform` (camera-unit space × `--u`) and
  subscribes only to that unit's `transform` — re-renders only when *that* unit moves.
- **Wrapper/content split:** the wrapper (cheap, empty) handles movement; the `component`
  subscribes only to appearance state and re-renders only when *that* changes. Moving a
  unit doesn't re-run your component.

---

## Reactivity bridge

### `useObservable(ov)`
Wraps `useSyncExternalStore`. Subscribes the component to a single `ObservableValue`,
returns its current value, and re-renders **only** when that value fires.

```tsx
const hp = useObservable(unit.hp)     // re-renders on hp change only
```

- Read three values = subscribe to three. An unread value changing doesn't re-render.
- `useSyncExternalStore` guards against tearing.
- **v1: naive** — a unit's change can trigger its re-render directly. The batched
  per-frame flush (below) is a later optimization.

---

## Coordinate system & sizing (resolution-independent)

The renderer **observes** the scale live; it never assumes one.

- The active **camera** defines the logical space (e.g. `100×100`). World coords map
  through `inverse(cameraWorldTransform)`, then ÷ camera `width/height` → normalized.
- The **canvas** (stage container) is sized in real pixels — by default fills the
  window, **locked to the camera's aspect ratio**. Flexible enough to embed in a page;
  fill-the-window is the primary target.
- A `ResizeObserver` on the stage recomputes a single uniform factor on every resize and
  pushes it into one CSS variable:
  ```
  --u = canvasPixelWidth / cameraWidth   // pixels per camera unit
  ```
- **Everything is authored in camera units** via `calc(n * var(--u))` — positions and
  sizes alike. On resize, that one value updates and the whole scene reflows.
- Units have **no width/height** — only `scale`. A unit's on-screen size is whatever its
  component's HTML renders (in camera units), times `scale`.
- Coordinate space is y-down; the camera's `position` lands at the center of the
  stage (matches `core`'s `Camera`).
- (`em`-as-unit was rejected — the font-size cascade would corrupt component text sizing.)

---

## Input capture (adapter)

`core`'s `Input` is headless; this package captures real device events and feeds it.

- Attaches DOM listeners (keyboard on the document/stage, pointer on the stage) and calls
  the `Input` feed API (`feedKeyDown`, `feedPointerMove`, ...).
- **Maps pointer pixels → world coordinates** before feeding: divide out `--u`, then
  apply the active camera's world transform. Only the React side knows the canvas
  size + camera, so it owns this mapping.
- v1: keyboard + pointer only. No touch, no action mapping.

---

## Open / deferred

- **Batched per-frame flush.** Collect dirty units in a `Set`, flush once per frame on
  the `deviceTick`/RAF boundary so a unit changing N times = one re-render. v1 is naive.
- A live preview to validate the `--u` resolution-independence model in practice.
- Canvas/WebGL escape-hatch layer for effects DOM is bad at (particles, etc.).
