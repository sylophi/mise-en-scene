# Tilemap platformer

A small playable platformer exercising [`@mise/tilemap`](../../tilemap/README.md)
end to end: a Tiled `.tmj` level rendered from a real spritesheet image,
greedy-merged static colliders under a `CharacterBody2D` player, a camera
with smoothing and map-bounds limits, and a flag tile that wins.

## Run

```sh
pnpm install            # from the repo root
pnpm --filter tilemap-platformer dev
```

Open the printed URL. **A/D** (or arrows) to run, **Space** to jump; reach
the flag on the far right. Falling into the pit respawns you; after winning,
**R** (or the button) restarts.

`pnpm --filter tilemap-platformer build` type-checks and bundles.

## Assets

`src/tiles.png` (a 4-tile 16px spritesheet) and `src/level.tmj` (the Tiled
JSON level, authored as ASCII art) are generated, checked-in files. Edit and
regenerate them with:

```sh
pnpm --filter tilemap-platformer generate
```

The level's tileset is embedded in the map, with `solid: true` custom
properties on the terrain tiles — exactly what hand-authoring in the Tiled
editor produces with "Embed in Map" and "Tile Layer Format: CSV".
