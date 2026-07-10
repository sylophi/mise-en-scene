# Design: `@mise/audio` — sound as units

Status: implemented (v1). This document records the design and the
alternatives considered.

## Goals

- Sound follows the tree. A player unit plays when it enters the live tree
  and stops when it leaves, so `changeScene` tears audio down exactly like
  physics and rendering.
- Positional audio: pan and attenuate 2D sounds relative to a listener that,
  by default, follows the active camera.
- Web Audio underneath; zero dependencies besides `@mise/core`; core knows
  nothing about audio.
- Headless-safe: constructing and mounting audio units without a real
  `AudioContext` (tests, SSR, node) must work, and tests must be able to
  inject a stub context.

## Unit taxonomy

Mirrors `@mise/physics`: one system unit that owns the underlying resource,
plus leaf units that register with their nearest system ancestor on
`onTreeEnter` and tear down on `onTreeExit`.

| Unit | Extends | Role |
| --- | --- | --- |
| `AudioMixer` | `Unit` | The system. Owns the master `GainNode`, the unlock handling, the listener slot, and the per-tick spatialization pass. Analogue of `PhysicsWorld2D`. |
| `AudioPlayer` | `Unit` | Non-positional playback: music, UI sounds. Full volume, centered. |
| `AudioPlayer2D` | `Unit2D` | Positional playback: panned and attenuated against the listener each fixed tick. |
| `AudioListener2D` | `Unit2D` | Optional explicit listener. Claims the mixer's listener slot on tree enter, releases it on exit. |

`AudioPlayer` and `AudioPlayer2D` cannot share a base class (one is a
`Unit`, the other a `Unit2D`; single inheritance), so both delegate to an
internal `Playback` object that owns the Web Audio node graph
(`AudioBufferSourceNode → GainNode → [StereoPannerNode] → master`). This is
the same reason `@mise/physics` documents "a body cannot also be a
`Renderable`": composition over multiple inheritance.

### Why a mixer unit (and not an engine-level service)

Considered: a module- or engine-keyed `WeakMap<Engine, AudioSystem>` that
players find implicitly through `this.engine`. Rejected because:

- The ancestor idiom is the established plugin contract
  (`findAncestor(PhysicsWorld2D)`); a second registration mechanism would
  make the plugin story inconsistent.
- The mixer's placement expresses scope naturally: as the scene root it dies
  with the scene (all sound stops on `changeScene`); directly under
  `engine.root` it persists across scenes (background music), exactly like
  persistent cameras.
- It gives configuration (volume, mute, injected context) an obvious,
  reactive home that serializes with the tree later.

Players throw on tree enter when no `AudioMixer` ancestor exists — same
loud-failure contract as physics units without a `PhysicsWorld2D`.

## The context: shared, injectable, optional

The `AudioContext` is *not* owned by the mixer. Browsers cap live contexts
and the unlock state is per-context, so creating one per scene-scoped mixer
would be wasteful and would re-lock audio on every scene change. Instead:

- `getSharedAudioContext()` lazily creates one real `AudioContext` per
  process (or returns `null` where the API doesn't exist — node, SSR).
- `AudioMixer` defaults to the shared context; `context: myCtx` injects one
  (tests pass a stub), `context: null` forces silent mode.
- The mixer owns only its *graph* on that context (a master `GainNode`),
  which it disconnects on destroy. The context itself is never closed.

All Web Audio types are consumed through minimal structural interfaces
(`MiseAudioContext`, `GainNodeLike`, ...) capturing exactly the members the
package touches. A real `AudioContext` satisfies them structurally (there is
a compile-time test asserting this), and a vitest stub is ~40 lines with no
jsdom. With no context at all, everything still runs: `playing$`, `pan$`,
and `attenuation$` update normally; only node calls are skipped. Tests can
therefore assert intent and spatial math with no audio implementation at
all.

## Lifecycle rules

- **Tree enter** (top-down, so the mixer is live before its descendants):
  the player finds its mixer, builds its gain/pan chain into the master, and
  begins resolving its buffer. If `autoplay` (default `true`) or if `play()`
  was called while off-tree, playback starts.
- **Tree exit** (bottom-up, so players detach before a dying mixer): the
  player stops (`playing$ → false`) and disconnects its nodes. Exit fires on
  detach *and* on destroy, so both `changeScene` variants clean up.
- **Re-enter** replays when `autoplay` is set: an enter/exit cycle is a
  play/stop cycle, per the roadmap contract.
- **Mixer destroy** disconnects the master gain — a hard cut for anything
  that leaked past player teardown (there is nothing in v1, but it makes the
  invariant local).
- `play()` while off-tree or before the buffer decodes records intent
  (`playing$` fires immediately); the source starts as soon as the unit is
  live *and* the buffer is ready. `stop()` clears intent. `playing$` is thus
  "intent to be audible", the observable a UI wants; `onFinished` fires when
  a non-looping source ends naturally (also flipping `playing$` off).

## Listener model and spatial math

Priority for the listener position, resolved per fixed tick by the mixer:

1. An `AudioListener2D` registered with this mixer (its world translation).
2. `engine.activeCamera.viewCenter` — the *view* center (smoothing, limits,
   and offset resolved), i.e. what the player actually sees, shake and all.
   Followed via `activeCamera$` implicitly: the position is read fresh each
   tick, so camera swaps need no subscription bookkeeping.
3. World origin (headless fallback; deterministic for tests).

Each fixed tick (and immediately on registration, so the first audible
frame is already correct), the mixer updates every registered
`AudioPlayer2D`:

```
d           = |playerWorldPos − listenerPos|
attenuation = (1 − min(d / maxDistance, 1)) ^ rolloff     // 1 at the listener, 0 at maxDistance
pan         = clamp(dx / panRange, −1, 1)                 // panRange defaults to maxDistance / 2
```

Results land on reactive `pan$` / `attenuation$` channels (handy for debug
UI and "signal strength" gameplay) and on the player's `StereoPannerNode`
and `GainNode` (`gain = volume × attenuation`).

Considered: Web Audio's native `PannerNode`/`AudioListener`. Rejected — it
is a 3D HRTF/cone model with per-context global listener state, awkward for
multiple mixers, much harder to stub, and its distance models don't map
cleanly onto 2D camera units. Explicit 2D math is ~15 lines, exactly
testable, and matches how Godot's `AudioStreamPlayer2D` behaves. The math
runs on the fixed tick like physics; per-sample ramping (`setTargetAtTime`)
was skipped in v1 for stub simplicity — at 60 Hz updates, zipper noise is
inaudible in practice.

## Buffers and the decode cache

`src` accepts a URL string or a pre-built `AudioBuffer` (procedural sound:
render with an `OfflineAudioContext`, pass the buffer straight in — the
audio-demo example does exactly this). URL decodes go through a
per-context cache (`WeakMap<context, Map<url, Promise<AudioBuffer>>>`):
many players sharing one `src` fetch and decode once. `mixer.load(src)`
exposes the cache for preloading. Failed loads warn and leave the player
silent rather than throwing from an async gap.

## Autoplay unlock

Browsers create `AudioContext`s in the `suspended` state until a user
gesture. Handling:

- Sources are scheduled regardless of context state. Web Audio queues them:
  when the context resumes, loops and music simply begin. Nothing crashes,
  nothing needs re-triggering.
- On tree enter, a mixer whose context is suspended installs one-time
  `pointerdown`/`keydown`/`touchend` listeners on `globalThis` that call
  `context.resume()`; on success they remove themselves and flip the
  mixer's `unlocked$` to true. On failure (the gesture didn't qualify) they
  stay armed. Listeners are removed on tree exit.
- `unlocked$` is public so UI can show "click to enable sound" (the example
  does).
- Headless (`context: null`) reports `unlocked = true` — there is nothing
  to unlock.

One caveat, documented in the README: one-shots scheduled while suspended
all start on resume. For enter-driven ambient loops and music (the main
autoplay use case) that is the desired behavior.

## Reactive surface (x/x$ convention)

- Players: `volume`/`volume$`, `loop`/`loop$`, `playbackRate`/`playbackRate$`,
  read-only `playing`/`playing$`, `onFinished`.
- `AudioPlayer2D` adds `maxDistance`/`maxDistance$` and read-only
  `pan`/`pan$`, `attenuation`/`attenuation$` (`panRange` and `rolloff` are
  construction-time).
- Mixer: `volume`/`volume$`, `muted`/`muted$` (mute preserves the volume
  setting), read-only `unlocked`/`unlocked$`.

## Out of scope for v1

- Buses/groups beyond the single master gain (a `volume` per mixer plus
  per-player volume covers the demo; buses can become nested mixers later).
- Doppler, filters, reverb zones — reachable through the exposed nodes.
- Click-free parameter ramps (`setTargetAtTime`) — needs a slightly richer
  context interface; a compatible extension.
- Streaming (`MediaElementAudioSourceNode`) for long music; buffers are fine
  at demo scale.
