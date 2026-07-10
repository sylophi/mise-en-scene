# physics-debug example

A small platformer that shows `@mise/physics-debug` over a live game: a
character capsule, floors, a rotated slope, coin pickups (`Area2D`), a
per-tick ground-probe ray, and a periodic line-of-sight ray toward the
pointer.

## Run

```sh
pnpm install               # once, from the repo root
pnpm --filter @mise/example-physics-debug dev
```

Open the printed URL.

## Controls

- **A / D** — move
- **Space** — jump
- **`** (the tilde/backquote key) — toggle the physics debug overlay

With the overlay on you see every collider outlined (green static bodies,
blue character), the coin sensors as filled yellow circles, and recent
raycasts fading out (pink where they hit, gray where they missed).
