# Asset preloading and sprite animation (`@mise/react`)

Design for two roadmap items that pair naturally: `preload([...urls])` with
progress, and an `AnimatedSprite` helper driven by engine time. Both live in
`@mise/react`; `@mise/core` is untouched.

## Asset preloading

### API

```ts
const task = preload(urls, options?); // imperative
// task: {
//   progress$: ObservableValue<number>   0..1, counts settled urls
//   done$:     ObservableValue<boolean>
//   errors$:   ObservableValue<readonly PreloadError[]>
//   promise:   Promise<PreloadResult>    resolves { errors }; never rejects
//   total:     number
//   loaded:    number                    settled-so-far (getter)
// }

const { progress, done, errors, task } = usePreload(urls); // React
```

- **Images** (`.png .jpg .jpeg .gif .webp .avif .svg`) load through
  `new Image()` + `decode()`, so the browser cache is warm *and* the bitmap is
  decoded; first paint of a preloaded sprite is synchronous.
- **Everything else** (audio, json, arbitrary) goes through `fetch()` and a
  full body read, warming the HTTP cache. v1 deliberately returns no parsed
  asset objects: the DOM cache *is* the asset store (components just use the
  url again), which keeps the API one function with no registry to manage.
- `options.load` overrides the per-url loader — the seam for tests and for
  custom asset types.

### Error policy

**Per-url errors, continue loading.** A game loading screen should never
dead-end on one missing decal:

- a failed url is recorded in `errors$` and still counts toward `progress$`,
  so progress always reaches 1 and `done$` always becomes true;
- `task.promise` *resolves* (never rejects) with `{ errors }`; callers that
  want fail-fast check `errors.length` themselves.

Alternative considered: fail the promise on first error (`Promise.all`
semantics). Rejected — it makes the common case (ship anyway, log the error)
harder and the rare case (abort the game) only marginally easier.

### `usePreload` and StrictMode

`usePreload` memoizes tasks in a module-level cache keyed by the url list, so
StrictMode double-invocation, a remounting loading screen, or two components
watching the same asset set share one task instead of re-issuing loads.
Subscription is plain `useObservable` on the task's channels.

## Sprite animation

### Engine-time binding

The contract: **`engine.time` advances on the fixed clock; if time does not
advance, the animation does not.** Core exposes no per-frame observable for
time, so the React layer needs a change signal. Options considered:

1. **rAF polling** — subscribe via `requestAnimationFrame`, read
   `engine.time`, re-render when the computed frame changes. Works, but keeps
   a wall-clock loop running while paused and is awkward to test with a
   manually-stepped engine.
2. **`time$` observable in core** — fires 60×/s for every subscriber whether
   or not anything changed; also touches core, which a parallel branch
   (timeScale/pause) is already modifying.
3. **Invisible driver unit** (chosen) — the hook mounts a tiny non-renderable
   `Unit` under `engine.root` whose `tick(dt)` advances the clip and writes
   `frame$`. This is the pattern react/README already endorses ("a tween can
   be an invisible Unit"): engine-time sync, pause, and catch-up semantics
   come for free, and tests drive it with `engine.advanceFixed()`. The driver
   is created inside an effect (so StrictMode's mount/unmount/mount cycle
   creates a fresh unit each time — destroyed units cannot re-enter the tree)
   while the clip state (`frame$`, `playing$`, elapsed) lives in `useState`
   and survives remounts. The driver is not a `Renderable`, so mounting one
   never triggers a compositor re-collect.

### API

```ts
// Pure, exported for reuse/testing:
frameAt(elapsed, frameCount, fps, loop) // -> { frame, finished }

// Hook (usable in any component under <MiseProvider>):
const anim = useSpriteAnimation({ frameCount, fps?, loop?, playing?, onFinished? });
// anim: { frame, playing, play(), stop(), gotoFrame(i) }

// Component (sized in camera units):
<AnimatedSprite sheet={{ src, columns, rows }} fps={10} width={8} height={8} />
<AnimatedSprite sheet={{ src, frameWidth: 16, frameHeight: 16 }} ... /> // grid measured from the image
<AnimatedSprite images={[url0, url1, ...]} ... />                       // one image per frame
```

Semantics:

- `fps` defaults to 10, `loop` to true. A non-looping clip clamps on its last
  frame; `onFinished` fires exactly once, after the last frame has been shown
  for its full `1/fps`, and the clip stops (`playing` becomes false).
  `play()` on a finished clip restarts from frame 0. `gotoFrame(i)` clamps,
  rewinds `elapsed` to `i/fps`, clears the finished latch, and shows the
  frame immediately (even while stopped).
- The `playing` prop is synced into the clip by effect; the imperative
  `play()/stop()` remain usable between prop changes (last write wins).
- `frames` on the component selects cells: an index array into the grid (or
  image list), or a count from cell 0; default is every cell in row-major
  order.

### Rendering

Spritesheet mode renders one `div` with `background-image`;
`background-size`/`background-position` are authored entirely in camera units
via `var(--u)` (size = `width×columns` by `height×rows` units), so no source
pixel dimensions are needed when `columns`/`rows` are given and resize stays a
pure CSS reflow. When only `frameWidth`/`frameHeight` (source px) are given,
the grid is measured once from the image's natural size (instant if
preloaded). Multi-image mode renders an `<img>` swapping `src` per frame —
flicker-free when the urls were preloaded. `image-rendering: pixelated` is on
by default (pixel-art-first), overridable via `pixelated={false}` or `style`.
