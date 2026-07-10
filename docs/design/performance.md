# Performance: cached world transforms and the batched frame flush

Design notes for the two items under "Performance debt" in
[ROADMAP.md](../../ROADMAP.md). Both are internal optimizations: no public API
changes beyond one additive engine event, and no change to observable
semantics for game code.

## Problem

Two costs grew linearly (or worse) with unit count in v1:

1. **`Unit2D.worldTransform` recomputed on every read.** Each read composed
   `Matrix2D.fromTRS` and a multiply per ancestor, so a chain of depth *d*
   cost *O(d)* allocations per read — and hot readers (the compositor's
   wrappers, the camera's view resolution every fixed step, physics sync)
   read it constantly, even for units that never move.
2. **One React notification per change.** Every `position$`/`rotation$`/
   `scale$` fire reached React immediately through the wrapper subscriptions
   and `useObservable`. A unit that writes position *and* rotation each fixed
   tick produced two store notifications per tick per unit; with the 60 Hz
   fixed loop (plus catch-up steps) decoupled from the display rate, React
   could run several render passes per displayed frame, each visiting every
   dirty component. The DOM only paints once per frame; the extra passes were
   pure waste.

## Approach

### 1. Lazy-cached world transforms (`@mise/core`)

`Unit2D` keeps two nullable caches, `_localMatrix` and `_worldMatrix`
(`null` = dirty). Reads fill them; invalidation clears them. `Matrix2D` stays
immutable, so a cached matrix can be handed out by reference — which also
gives subscribers a free change test (reference equality) that the React
layer exploits.

**Invalidation rules** (the entire correctness story):

- A **local change** (`position$`, `rotation$`, `scale$` fires) clears the
  unit's local *and* world caches, then descends.
- A **parent change** (attach, reparent, detach — via a new internal
  `Unit.parentChanged` hook) clears only the world cache, then descends.
- **Descent** clears the world cache of every *contiguous `Unit2D`*
  descendant. It stops at non-`Unit2D` children: the transform chain breaks
  there, so their `Unit2D` descendants form fresh subtrees that do not depend
  on anything above the break. For the same reason, reparenting a plain
  `Unit` invalidates nothing.
- **Pruning invariant:** a dirty world cache implies every dependent
  descendant's is dirty too. It holds because reads only ever fill a
  contiguous ancestor path (computing a child computes its parents) and
  invalidation always descends. Descent can therefore stop at the first
  already-dirty unit, making invalidation *O(newly dirtied)* — a swarm of
  leaf units that all move every tick pays one flag write each, not a
  subtree walk each.

**Ordering.** Caches must be coherent *before any observer runs*:

- The invalidating listeners are registered in the `Unit2D` constructor,
  before game code can subscribe, and `ObservableValue` notifies in insertion
  order — so a `position$` listener that reads `worldTransform` sees the
  fresh value.
- `parentChanged` is a protected hook called by `addChild`/`removeChild`
  immediately after relinking, *before* `onTreeEnter`/`onTreeExit`/
  `onParentChanged` fire (a `Camera` snaps its view in `onTreeEnter` by
  reading `worldTransform`; a stale cache there would be a real bug). It is a
  hook rather than a self-subscription because `onParentChanged` is allocated
  lazily and units are a per-frame spawn hot path.

`Camera.viewTransform`/`viewCenter` sit on top of `worldTransform` unchanged
and behave identically; they just read a memo now.

**Alternatives considered**

- *Version counters compared per read:* avoids descent on invalidate but pays
  an ancestor walk on every read — exactly the hot path we're removing.
- *Per-unit parent subscriptions:* each `Unit2D` listening to its parent's
  channels. Allocation-heavy on spawn, churny on reparent, and equivalent in
  effect to the descent with worse constants.
- *Eager recompute on change:* wasted work for offscreen/unread units and
  wrong order of magnitude when a root moves (recomputes the world instead of
  flagging it).

### 2. Batched per-frame flush (`@mise/react`)

One additive core hook: `Engine.onDeviceTick` fires at the end of
`advanceDevice`, after the frame's `deviceTick` walk, with the clamped dt.

The react package adds a `FrameFlusher` (one per engine, lazily created in a
`WeakMap`, engine-lifetime). Renderer subscriptions — the wrapper transform
chains in the compositor and every `useObservable` under a `<MiseProvider>` —
no longer call React's `onStoreChange` per change. They `enqueue` it on the
flusher, which dedupes callbacks by identity in a `Set` (a unit changed five
times in a frame is one entry) and flushes the whole set once per device
tick. The flush is a single synchronous burst, so React 18+ batches it into
one render pass, and each re-rendering component reads its *current*
snapshot — coalescing loses nothing, it only skips intermediate paints that
never could have hit the screen.

**What is not batched:** `ObservableValue` itself. Game-code listeners still
fire synchronously per change; only React notification is deferred. Chain
*resubscription* on reparent is also still synchronous — deferring it would
open a listener gap that could drop changes on the new ancestor chain; only
the resulting re-render is deferred.

**Correctness details**

- *Tearing:* both hooks now go through `useSyncExternalStore`.
  `useWorldTransform` uses `unit.worldTransform` itself as the snapshot,
  which the core cache keeps reference-stable between changes (the property a
  uSES snapshot must have). Values never mutate during a render pass (game
  code runs outside React), so a flush render is internally consistent.
- *StrictMode:* subscriptions are set up inside the uSES `subscribe`
  callback; teardown unsubscribes the chain and `cancel`s the pending
  notification, so double-mounting neither leaks listeners nor notifies dead
  subscribers.
- *Units entering/exiting mid-frame:* the enter/exit re-collect path
  (microtask-coalesced `useRenderables`) is unchanged. A unit destroyed with
  a notification pending is harmless: its wrapper either unmounted (cancelled
  on unsubscribe) or re-renders once against still-readable state.

**Flush timing.** While the device loop is driving (engine running and rAF
available), the *only* flush point is `onDeviceTick` — fixed-tick changes
accumulate and flush at the next frame, deviceTick changes flush in the same
frame, one render pass per displayed frame. When nothing is ticking (stopped
engine, no rAF — tests, paused games, headless), the flusher falls back to a
microtask, coalescing per task instead of per frame so external writes still
reach React. Manual `engine.advanceDevice(dt)` flushes deterministically,
which is what the tests use.

**Alternatives considered**

- *A renderer-owned rAF loop:* no core change needed, but its ordering
  against the engine's own rAF callback is registration luck; changes made in
  `deviceTick` could consistently pay a full frame of latency.
- *Batching inside `ObservableValue`:* would defer game-code listeners too,
  changing simulation semantics. Rejected outright.
- *Per-hook throttling:* no shared frame boundary, so N hooks still produce N
  scattered render passes.

## Tradeoffs

- **Latency, not loss:** React paint of a change now happens at the next
  device tick instead of immediately — at most one frame, invisible in
  practice since the DOM only paints per frame anyway.
- **Interleaved non-engine renders** (e.g. HUD `setState` from a click) can
  commit mid-frame while engine changes are still pending; those components
  read fresh snapshots while un-notified neighbors haven't re-rendered yet.
  Transient (resolved at the next flush, ≤1 frame) and only reachable from
  UI events.
- **`stop()` with same-frame pending marks:** if the engine is hard-stopped
  after changes were enqueued under a running loop and *nothing ever changes
  again*, one stale frame can persist until the next write (which flushes
  everything via the microtask fallback). The future `timeScale` pause
  (ROADMAP §2) does not have this problem — the device loop keeps running.
- **Memory:** two matrix references per `Unit2D`, three constructor listener
  registrations, one `Set` entry per dirty subscriber per frame. All O(1)
  per unit.
