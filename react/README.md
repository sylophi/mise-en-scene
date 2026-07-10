# @mise/react

The React DOM renderer for [Mise en Scène](../README.md). A retained-mode
renderer that draws the engine's live tree as positioned HTML elements. No
canvas. Depends on [`@mise/core`](../core/README.md); `core` never depends on
this.

```tsx
import { Engine, ObservableValue, Vector, mes } from "@mise/core";
import { MiseProvider, Renderable, useObservable } from "@mise/react";

class Player extends Renderable {
  readonly hp$ = new ObservableValue(100);
  get hp() { return this.hp$.get(); }
  set hp(v: number) { this.hp$.set(v); }

  readonly component = ({ unit }: { unit: Player }) => {
    const hp = useObservable(unit.hp$);
    return <div className="player">{hp} hp</div>;
  };
}

const engine = new Engine();
engine.changeScene(mes(Player, { position: new Vector(50, 30) }));

createRoot(el).render(
  <MiseProvider engine={engine}>
    <Hud /> {/* optional overlay: menus, debug UI */}
  </MiseProvider>,
);
```

## `Renderable extends Unit2D`

A unit that draws via a React component.

- `component` is a function component receiving `{ unit }` (the typed
  instance) as its only prop. Reach everything else through the unit
  (`unit.engine.time`, observables, children).
- The component is **position-agnostic**: it draws appearance at the origin,
  in camera units via `var(--u)` (below). The compositor positions it.
- `z` is an integer layer accessor (default 0) backed by the `z$` channel.
  Draw order is z layer first, tree order within a layer (the Godot model).

## `<MiseProvider engine={...}>`

Provides the engine via context and renders its world. The engine is
injected, not created here: it runs (and self-starts) independently of
React, which sidesteps `StrictMode` double-effects entirely. Children render
on top of the world, for HUDs and menus.

Hooks:

- `useEngine()`: the engine from context.
- `useObservable(ov)`: subscribes to one `ObservableValue` via
  `useSyncExternalStore` and returns its current value. Read three values,
  subscribe to three; an unread value changing never re-renders you.

## How the compositor works

**Flat, keyed, per-unit-subscribed.** Not a mirrored DOM tree.

- On mount it crawls the tree once for existing `Renderable`s, then stays in
  sync via `onUnitEnter`/`onUnitExit` (filtered to renderables) and
  `onUnitMoved` (unfiltered: a moved invisible ancestor shifts its subtree's
  draw order). Event bursts coalesce into one re-collect per microtask.
  Structure is never re-crawled per frame.
- Each renderable gets its own wrapper element, keyed by `unit.id`. A unit's
  change re-renders only that unit; siblings and the container are untouched.
- Spatial parent/child relationships are preserved by math
  (`worldTransform`), not DOM nesting, since the transform chain breaks at
  non-`Unit2D` ancestors and invisible units emit no DOM.
- **Wrapper/content split:** the wrapper (cheap, empty) handles movement and
  subscribes to the transform chain; your `component` subscribes only to the
  appearance state it reads. Moving a unit does not re-run your component.
- Z-order: wrappers get CSS `z-index = z * 100000 + treeOrder`, so explicit
  layers always beat tree position and tree order breaks ties within a layer.

### Two-layer transform

The camera transform is applied once, on a viewport element; each wrapper
carries only its own world transform. A camera move re-renders one element,
not every unit. What the viewport inverts is the camera's **view transform**
(`camera.viewTransform`): its world transform with smoothing, limits, and
offset resolved into the translation, re-rendered from both the camera's
transform chain and `viewCenter$` (which fires as the smoothed view advances
on the fixed clock).

```html
<div class="stage">      <!-- real pixels; ResizeObserver sets --u -->
  <div class="viewport"> <!-- at the stage center; inverse camera transform -->
    <div class="wrapper"><!-- translate(calc(tx * var(--u)), ...) matrix(a, b, c, d, 0, 0) -->
      <!-- your component, position-agnostic -->
    </div>
  </div>
</div>
```

World transforms are `Matrix2D`s, so shear renders correctly. CSS `matrix()`
cannot contain `var()`, so each transform splits: the unitless linear part
(rotation/scale/shear) goes in `matrix()` and the translation goes in
`translate(calc(n * var(--u)))`, keeping resize a pure CSS reflow. The
viewport is the mirror image, with the camera's view center landing at the
center of the stage.

## Coordinates and sizing

Resolution-independent by construction; the renderer observes the scale, it
never assumes one.

- The active camera defines the logical space (e.g. 100x56.25 camera units).
  The stage fills its container at the camera's aspect ratio.
- A `ResizeObserver` recomputes one number on resize and pushes it into one
  CSS variable: `--u`, pixels per camera unit.
- Author **everything** in camera units via `calc(n * var(--u))`: positions
  (done for you by the wrapper) and sizes (in your components). On resize,
  that one variable updates and the whole scene reflows.
- Units have no width/height, only `scale`. On-screen size is whatever your
  component renders, times scale.

## Input adapter

The stage captures DOM keyboard and pointer events and feeds
`engine.input` through its `feed*` API. Pointer pixels are mapped to world
coordinates first (divide out `--u`, recenter, apply the camera's view
transform, so the pointer agrees with what is actually rendered, shake and
all), so game code never sees a pixel. Single-character keys are normalized
to lowercase by `Input` itself, so Shift can't split `"j"`/`"J"` into two
keys. v1 is keyboard and pointer only: no touch, no action mapping.

## Asset preloading

`preload(urls)` warms the cache ahead of use: images load through
`new Image()` + `decode()` (fetched *and* decoded, so first paint is
instant), everything else through `fetch()` with a full body read. It returns
no asset objects on purpose — the browser cache is the asset store, and
consumers just use the same url again.

- `preload(urls, options?)` returns a task: `progress$` / `done$` / `errors$`
  (`ObservableValue`s a loading screen observes), `promise`, `total`,
  `loaded`.
- **Failures don't abort the batch.** A failed url is recorded in `errors$`,
  still counts toward `progress$` (which always reaches 1), and `promise`
  *resolves* — never rejects — with `{ errors }`. Check `errors.length` if
  you want fail-fast.
- `options.load` overrides the per-url loader (tests, custom asset types).

There is no bundled loading hook, for the same reason there is no bundled
tween system: orchestration is your app's business, and the task speaks
protocols your tools already understand. In plain React, hoist the task to
module scope (like the engine itself, it starts once, so StrictMode can't
double-load) and observe its channels:

```tsx
const task = preload(ASSET_URLS);

function Gate({ children }: { children: ReactNode }) {
  const done = useObservable(task.done$);
  const progress = useObservable(task.progress$);
  return done ? children : <ProgressBar value={progress} />;
}
```

Or hand the promise to a data library — React Query adds caching, retry, and
eviction for free:

```tsx
useQuery({ queryKey: ["preload", ...urls], queryFn: () => preload(urls).promise });
```

Live progress still comes from `task.progress$` via `useObservable`; keep the
task where both the query and the progress bar can reach it.

## Sprite animation

`AnimatedSprite` flips frames on **engine time**, not wall clock: the hook
behind it mounts an invisible driver unit whose `tick` advances the clip, so
if `engine.time` doesn't advance, neither does the animation — game pauses
pause your sprites for free.

```tsx
// One spritesheet image with a grid of cells…
<AnimatedSprite sheet={{ src, columns: 6, rows: 1 }} fps={12} width={8} height={8} />
// …or give the cell size in source px and the grid is measured from the image
<AnimatedSprite sheet={{ src, frameWidth: 16, frameHeight: 16 }} fps={12} width={8} height={8} />
// …or one image per frame
<AnimatedSprite images={frames} fps={12} width={8} height={8} />
```

- Sized in camera units (`width`/`height`); sheet cells render via
  `background-position` authored entirely in `var(--u)`, so resize stays a
  pure CSS reflow. Draws with its top-left at the origin like everything
  else; center it with `style={{ transform: "translate(-50%, -50%)" }}`.
  `pixelated` (default true) keeps pixel art crisp.
- `frames` selects cells: an index array into the row-major grid (or image
  list), or a count from cell 0. Default: every cell.
- `fps` (default 10), `loop` (default true), declarative `playing`, and
  `onFinished` — fired once when a non-looping clip has shown its last frame
  for a full `1/fps`, after which the clip stops; `play()` restarts it.
- The underlying hook is exported for custom components:

```tsx
const anim = useSpriteAnimation({ frameCount: 6, fps: 12 });
// anim.frame, anim.playing, anim.play(), anim.stop(), anim.gotoFrame(i)
```

`frameAt(elapsed, frameCount, fps, loop)` is the pure frame math, exported
for reuse. See `examples/sprites-demo` for a playable loading-screen +
walk-cycle demo.

## Animation: bring your own

There is no built-in tween system, by design. The `x`/`x$` accessors speak
the plain-property protocol tween libraries already use, so GSAP, anime.js,
or your own tweener drive engine state directly. No adapter:

```ts
gsap.to(pinwheel, { rotation: Math.PI * 2, duration: 2 });
gsap.to(camera, { width: 50, duration: 1 }); // animated zoom
```

Vector fields are immutable, so tween a plain object and write through:

```ts
const p = { x: player.position.x, y: player.position.y };
gsap.to(p, {
  x: 100,
  y: 40,
  onUpdate: () => (player.position = new Vector(p.x, p.y)),
});
```

Rules of the road:

- Animate engine state, or your own elements inside `component` (the usual
  React + GSAP ref patterns apply). Never target the compositor's wrapper,
  viewport, or stage elements: it owns their `transform`/`z-index` and will
  clobber external writes.
- Kill tweens when a unit dies: `onDestroy() { gsap.killTweensOf(this) }`,
  or from outside the class via the event:
  `unit.onDestroyed.addListener(() => gsap.killTweensOf(unit))`.
- Shake the camera through `camera.offset`, not `camera.position`: offset is
  exempt from smoothing and limits, so juice never fights the follow logic.
- Tween clocks are independent of the engine. Pausing the engine does not
  pause tweens; drive your library's ticker from `deviceTick` if you need
  game-time-synced animation.

Building your own is equally natural: a tween can be an invisible `Unit`
that interpolates a target's accessors in `tick` and destroys itself when
done, which gets engine-time sync (and pause) for free.
