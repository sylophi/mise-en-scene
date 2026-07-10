# audio-demo — Chirp Hunt

A tiny game where **sound is the gameplay**: six birds hide in a dark
meadow, each chirping on loop through an `AudioPlayer2D`. You can barely
see them — walk toward a chirp using stereo panning (left/right) and
loudness (near/far) until you step on the bird's hideout. Background music,
a mute/volume HUD, and every sound effect rendered procedurally with an
`OfflineAudioContext` — the demo ships zero audio files.

What it exercises from [`@mise/audio`](../../audio/README.md):

- `AudioMixer` as the scene root: swap the scene and all sound stops.
- Looping positional `AudioPlayer2D`s (the chirps) panned/attenuated
  against the active camera, which smoothly follows the player.
- Non-positional `AudioPlayer` for music, plus self-destroying one-shots
  (`onFinished` → `destroy`) for pickups and the win fanfare.
- `unlocked$` driving a "click to enable sound" hint until the first
  gesture resumes the `AudioContext`.
- `volume$`/`muted$` bound to a React HUD.

## Run

```sh
pnpm install        # from the repo root
pnpm --filter audio-demo dev
```

Open the printed URL, click once (browser autoplay policy), and walk with
WASD or the arrow keys. Headphones recommended.

`pnpm --filter audio-demo build` type-checks and produces a production
build; `pnpm --filter audio-demo preview` serves it.
