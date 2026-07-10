# perf-stress

A playable stress demo for the engine's performance work (batched per-frame
React flush + lazy-cached world transforms). You steer a ship through a
swarm of hundreds of seekers; every one of them writes `position` and
`rotation` on every fixed tick, and the whole swarm still costs one React
render pass per displayed frame.

## Run

```sh
pnpm install
pnpm --filter @mise/example-perf-stress dev
```

Then open the printed URL.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Steer |
| E | Spawn 250 more chasers |
| Q | Cull 250 chasers |
| Space | Shockwave (knocks the swarm back) |

The HUD shows FPS and the live unit count. Hold E to pile units on until the
frame rate bends; the interesting part is how far it gets before it does.
