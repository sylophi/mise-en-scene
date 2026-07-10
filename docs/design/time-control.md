# Time control: `timeScale`, `paused`, and per-unit `ticking`

Status: implemented. Covers two roadmap items: **Pause and time scale**
(`@mise/core`, section 2) and **Per-unit tick enable/disable** (`@mise/core`,
section 5).

## Goals

- One knob, `engine.timeScale`, that scales simulated time: slow motion,
  fast-forward, and pause (0) with the same mechanism.
- Pausing must freeze the *whole* fixed clock — `tick`, engine timers
  (`after`/`every`/`cooldown`), camera smoothing, `engine.time` — while the
  device loop and React keep running so menus and HUD stay alive.
- Resuming after a long pause must not trigger a catch-up burst.
- A per-unit switch, `unit.ticking`, to freeze one unit without touching the
  tree or its lifecycle.
- Core-only. `@mise/react` (and `@mise/physics`) need no changes.

## Semantics

| Surface | `timeScale = 1` | `timeScale = 0.5` | `timeScale = 0` (paused) | `unit.ticking = false` |
| --- | --- | --- | --- | --- |
| `tick(dt)` | every step, `dt = fixedStep` | steps at half rate, `dt = fixedStep` (unchanged) | never runs | skipped for this unit only |
| Engine timers / cooldowns | realtime | half speed | frozen | frozen for this unit only |
| Camera smoothing (`advanceView`) | realtime | half speed | frozen | frozen if the *camera* is the disabled unit |
| `engine.time` | realtime | half speed | frozen | unaffected |
| `input.advanceTick()` (just-pressed rollover) | per step | per step | frozen (see caveats) | unaffected (engine-global) |
| `deviceTick(dt)` | real dt | real dt (not scaled) | real dt (keeps running) | skipped for this unit only |
| React / renderers | live | live | live | live (renderable stays drawn; `ticking$` observable for styling) |
| Lifecycle (enter/exit/destroy), subscriptions | live | live | live | live |
| Descendants of a disabled unit | — | — | — | keep ticking (unit-only, v1) |

## Accumulator math: scale the inflow, never the step

The fixed loop is `setInterval` + accumulator:

```
accumulator += realDt * timeScale        // the only change
while (accumulator >= fixedStep && steps < maxCatchUp) {
  tick(fixedStep)                        // dt is always fixedStep
  time += fixedStep
  accumulator -= fixedStep
}
```

Two candidate designs were considered:

1. **Scale the inflow** (chosen): `accumulator += realDt * timeScale`. Each
   executed step is still exactly `fixedStep`; at 0.5 steps simply arrive at
   half the real-time rate ("steps thin out").
2. **Scale the dt**: run steps at the real-time rate but pass
   `dt = fixedStep * timeScale` into `tick`.

(1) wins on determinism: the whole point of a fixed step is that simulation
math sees one constant `dt`, so integration error, timer quantization, and
physics behave identically at any speed — a run at 0.5x is the same sequence
of steps as a run at 1x, just spread over more wall time. (2) silently turns
the fixed step into a variable step and breaks anything tuned to `fixedStep`
(physics engines especially). It also makes 0 degenerate (steps that do
nothing still run, timers see `dt = 0` forever, `every(0.1)` never fires but
burns CPU walking the tree).

Consequences that fall out of (1) for free:

- **Pause is not a special case.** At 0 the accumulator never grows, so the
  loop body never runs: `tick`, timers, camera smoothing, and `time` all stop
  because they are all advanced inside the step loop.
- **No catch-up explosion on resume.** Paused real time contributes
  `realDt * 0 = 0` to the accumulator, so there is no backlog when the scale
  goes back up; the first step after resume is an ordinary fresh step. (This
  is why `advanceFixed` scales rather than some outer layer: the interval
  callback keeps firing while paused, keeps `lastFixed` fresh, and feeds
  zeros.) Tested: 10 simulated-real seconds of pause, then resume, runs
  exactly one step.
- **Fast-forward composes with the spiral guard.** `timeScale = 2` accrues
  double; per `advanceFixed` call the step count is still capped by
  `maxCatchUp` and excess backlog is dropped. Very large scales are therefore
  effectively limited to `maxCatchUp` steps per interval fire — documented
  behavior, not a bug.
- **`engine.time` advances in scaled fashion** with no extra bookkeeping,
  because it only advances inside executed steps.
- Manual stepping (`advanceFixed` in tests/headless) obeys the same scaling,
  so headless behavior matches the live loop.

### What `deviceTick` observes during pause

`deviceTick` receives **real, unscaled dt** (still clamped to `maxDeviceDt`)
at every time scale, including 0. Rationale: the device loop is the
render-aligned "always alive" hook — it is what keeps UI cursors, menu
animation, and input-adapter-driven state working while the world is frozen.
Godot scales `_process` delta by `Engine.time_scale`; we deliberately do not,
because this engine's split is *simulation clock vs. device clock*, and the
React overlay (the primary UI layer) is not driven by `deviceTick` anyway —
scaling it would only freeze in-world units' render-aligned logic with
nothing gained. Units whose device-tick visuals should slow with the game
multiply themselves: `deviceTick(dt) { spin += dt * this.engine.timeScale }`.

**Caveat (documented, accepted):** `input.advanceTick()` — the just-pressed
rollover — runs on the fixed clock, so during a pause `justPressed()` does
not roll over. Code that polls input while paused (from `deviceTick`) should
use `isDown()` or the `onKeyDown`/`onKeyUp` events, which fire on feed and
are pause-independent. A key pressed *and released* entirely within a pause
is never observable via polling (the events still fire). Rolling input on the
device loop instead was rejected: `justPressed` is specified in ticks, and
consuming presses while the simulation cannot react to them would eat inputs.

## `timeScale` / `timeScale$` and `paused`

Follows the house `x`/`x$` convention on `Engine`:

- `timeScale$ = new ObservableValue(1)` — pause menus and slow-mo indicators
  subscribe here (e.g. `useObservable(engine.timeScale$)`).
- `timeScale` accessor — validated: must be finite and `>= 0` (throws
  otherwise; a negative scale would mean time reversal, which the engine
  cannot honor).

`paused` is a convenience accessor, **not** a separate channel:

- `get paused` is exactly `timeScale === 0` — one source of truth, no way for
  the two to disagree, and subscribers use `timeScale$` (deriving a `paused$`
  would need a derived-observable primitive core doesn't have).
- `set paused = true` remembers the current scale and sets 0;
  `set paused = false` restores the remembered scale (1 if the engine was
  only ever paused by writing `timeScale = 0` directly). This makes the
  common composition — bullet time at 0.5, pause menu opens, resume returns
  to 0.5 — work without game code tracking the pre-pause scale. Re-pausing
  while paused is a no-op and never remembers 0.

Alternative considered: `pause()`/`resume()` methods. Rejected — the accessor
reads as state (`if (engine.paused)`), matches the convention used everywhere
else, and a boolean toggle (`engine.paused = !engine.paused`) is the natural
Esc-key handler.

`paused` vs `stop()`: `stop()` halts *both* loops (nothing runs at all, rAF
cancelled); `paused` keeps the loops running and only starves the fixed
clock, so `deviceTick`, input feeding, and React stay live. Pause menus want
`paused`; teardown wants `stop()`.

## Per-unit `ticking` / `ticking$`

A boolean accessor pair on `Unit`, default `true`. When `false`, the engine's
walks skip the unit's simulation surface entirely:

- `tick` and `deviceTick` are not called, and `advanceTimers` is not called,
  so `after`/`every`/`cooldown` freeze — the same freeze the unit gets while
  off-tree, without leaving the tree. If the disabled unit is the active
  camera, its view smoothing freezes too (one flag means "fully dormant").
- Everything else is untouched: the unit stays live, keeps its engine
  binding, keeps rendering (a `Renderable` stays on screen — that is the
  point of "frozen"), keeps receiving events via subscriptions, and its
  lifecycle (`onTreeEnter`/`onTreeExit`/`onDestroy`) fires normally. The flag
  is plain unit state: it survives detach/reattach and is not reset by
  anything.

**Both ticks, one flag.** Godot separates `set_process` /
`set_physics_process` and also has tree-inherited process modes
(`PROCESS_MODE_DISABLED` stops everything and inherits). We take the minimal
slice: one flag, gating both hooks plus timers. A "frozen" unit whose
`deviceTick` keeps animating would be surprising; anyone needing finer grain
can early-return in one hook themselves.

**Unit-only, not inherited (v1).** Disabling a unit does *not* disable its
descendants; the walk still descends and each unit consults its own flag.
This is the cheap, unambiguous semantic (no effective-state computation, no
inheritance/override modes) and the useful direction to extend later —
subtree inheritance can be added compatibly (e.g. a `tickingMode` in the
Godot style), whereas starting inherited and retreating would break code. To
freeze a whole subtree today, set the flag on each unit, or structure the
subtree under one unit whose `tick` drives it.

Alternatives considered: separate `processing`/`physicsProcessing` flags
(more API for no v1 need); Godot-style inherited process modes (significant
walk complexity, ambiguity with `PAUSABLE`/`WHEN_PAUSED` interplay that our
engine-level `timeScale` already covers); auto-detaching frozen units from
the tree (breaks rendering and transforms — a frozen turret must stay
visible).

### Interactions

- `ticking = false` + engine timers: frozen (timers advance in the same
  gated walk callback). Consistent with the existing off-tree freeze.
- `ticking` and `timeScale` are orthogonal gates: a unit ticks iff the fixed
  clock produces a step *and* the unit's flag is true.
- `destroy()` works on a non-ticking unit as usual; `ticking$` listeners are
  external subscriptions and follow the normal rules.

## Files

- `core/src/engine/engine.ts` — `timeScale$`/`timeScale`, `paused`,
  scaled accumulator, `ticking` gates in both walks.
- `core/src/unit/unit.ts` — `ticking$`/`ticking`.
- `core/src/engine/time-control.test.ts`, `core/src/unit/ticking.test.ts`.
- `examples/time-control/` — playable demo (bullet time, pause menu, frozen
  turrets).
