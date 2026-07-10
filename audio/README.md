# @mise/audio

Web Audio for Mise en Scène, as units. Players, the mixer, and the listener
live in the scene tree: a sound plays when its unit enters the tree and
stops when it leaves, so `changeScene` silences a scene the same way it
tears down its physics and rendering. Positional sounds pan and fade
against a listener that follows the active camera by default. Depends only
on [`@mise/core`](../core/README.md); `core` knows nothing about audio.

## A noisy scene in one tree

```tsx
import { Engine, Vector, mes } from "@mise/core";
import { AudioMixer, AudioPlayer, AudioPlayer2D } from "@mise/audio";

const engine = new Engine();
engine.changeScene(
  mes(AudioMixer, {}, [
    // Music: non-positional, loops until the scene dies.
    mes(AudioPlayer, { src: "music/theme.ogg", loop: true, volume: 0.4 }),
    // A campfire you can walk toward: louder and more centered as you near it.
    mes(AudioPlayer2D, {
      src: "sfx/fire.ogg",
      loop: true,
      position: new Vector(120, 40),
      maxDistance: 80,
    }),
  ]),
);
```

One-shots follow the same rule — entering the tree is playing — so a sound
effect is a unit you spawn, and it cleans itself up:

```ts
const hit = mes(AudioPlayer, { src: "sfx/hit.ogg" }); // autoplay by default
hit.onFinished.addListener(() => hit.destroy());
scene.addChild(hit);
```

`src` is a URL (fetched and decoded once per context, shared cache) or a
decoded `AudioBuffer` — render one procedurally with an
`OfflineAudioContext` and no asset files at all (the
[audio-demo example](../examples/audio-demo) does exactly this).

## Units

### `AudioMixer extends Unit`

The audio system; the analogue of `PhysicsWorld2D`. Players and listeners
register with their nearest `AudioMixer` ancestor on tree enter and
unregister on exit. Place one at the root of your scene for scene-scoped
sound, or directly under `engine.root` (next to a persistent camera) for
music that survives `changeScene`.

- Owns the master `GainNode`: `volume`/`volume$` and `muted`/`muted$`
  (mute preserves the volume setting). Disconnected on destroy.
- Runs the spatialization pass: each fixed tick it re-pans and
  re-attenuates every registered `AudioPlayer2D` against
  `listenerPosition`. It ticks before its descendants, so your `tick`
  always hears this frame's positions.
- `load(src)`: resolve a URL to a decoded buffer through the shared cache —
  the preloading hook.
- `context` prop: omit for the process-wide shared `AudioContext`
  (created lazily), pass your own or a test stub, or pass `null` to force
  silent mode. The mixer never closes the context.
- `unlocked`/`unlocked$`: see [autoplay unlock](#autoplay-unlock).

### `AudioPlayer extends Unit`

Non-positional playback: music, UI sounds. Props: `src`, `autoplay`
(default true: play on every tree enter), `loop`, `volume`,
`playbackRate`. All but `src` and `autoplay` are live accessors in the
`x`/`x$` convention, applied mid-play.

- `play()` / `stop()`, and read-only `playing`/`playing$`. `play()` records
  intent immediately (even off-tree or while the buffer is still decoding)
  and starts the source as soon as the unit is live and the buffer is
  ready; `playing$` is the observable your UI wants.
- `onFinished` fires when a non-looping sound reaches its natural end
  (also flipping `playing$` off). A commanded `stop()` does not fire it.

### `AudioPlayer2D extends Unit2D`

Positional playback. Everything `AudioPlayer` has, plus a place in space:
the mixer pans and attenuates it against the listener every fixed tick, so
a player parented to a moving unit just sounds right. Extra props:

- `maxDistance` (default 100, live accessor): distance at which the sound
  is inaudible. Attenuation is `(1 - d / maxDistance) ^ rolloff`.
- `panRange` (default `maxDistance / 2`): horizontal offset at which
  panning reaches full left/right.
- `rolloff` (default 1, linear): attenuation curve exponent.
- Read-only `pan`/`pan$` (−1..1) and `attenuation`/`attenuation$` (0..1)
  carry the resolved values — useful for debug UI or "hot/cold" gameplay.

### `AudioListener2D extends Unit2D`

Optional explicit ears. With none in the tree, the mixer listens from the
active camera's **view center** (smoothing, limits, and shake resolved —
what the player actually sees), falling back to the world origin. Mount one
— typically as a child of the player character — and its nearest mixer
hears from its world position instead. Enter claims the slot, exit
releases it; the most recent one wins.

## Autoplay unlock

Browsers create `AudioContext`s suspended until a user gesture. You don't
have to do anything: sounds scheduled while suspended are queued by Web
Audio and begin the moment the context resumes, and a live mixer arms
one-shot `pointerdown`/`keydown`/`touchend` listeners that call `resume()`
on the first gesture. Subscribe to `mixer.unlocked$` to show a "click to
enable sound" hint until then. One caveat: one-shots fired while locked
all start together on resume — gate gameplay-critical stingers on
`mixer.unlocked` if that matters.

## Headless and tests

Everything is typed against small structural slices of Web Audio
(`MiseAudioContext` and friends), so:

- With no `AudioContext` at all (node, SSR, vitest), units construct,
  mount, and tear down normally; `playing$`, `pan$`, and `attenuation$`
  still update. No crash, just silence.
- Tests inject a stub: `mes(AudioMixer, { context: myStub }, [...])`. A
  full stub is ~50 lines with no jsdom; see
  [`src/audio.test.ts`](src/audio.test.ts).

## Rules of the road

- **Players need a mixer.** A player or listener entering the tree without
  an `AudioMixer` ancestor throws, like a physics body without a world.
- **The mixer's scope is its subtree.** Scene-scoped sound: mixer as scene
  root. Cross-scene music: mixer under `engine.root`.
- **Spatial math runs on the fixed tick.** Pan and attenuation update at
  the simulation rate (plus once immediately on tree enter), not per
  audio sample.
- **Buffers, not streams.** v1 decodes whole files into memory; fine for
  SFX and loops, wasteful for ten-minute soundtracks.
