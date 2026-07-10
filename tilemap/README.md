# @mise/tilemap

Tilemaps for [Mise en Scène](../README.md): a grid of spritesheet tiles
rendered as chunked DOM, greedy-merged static colliders, and Tiled (`.tmj`)
import as the authoring path. A content-level package sitting **above** the
pillars: it depends on [`@mise/core`](../core/README.md),
[`@mise/react`](../react/README.md), and
[`@mise/physics`](../physics/README.md); the pillars still know nothing of
each other.

```tsx
import { mes } from "@mise/core";
import { PhysicsWorld2D, initPhysics } from "@mise/physics";
import { TileMap2D, parseTmj } from "@mise/tilemap";
import tilesUrl from "./tiles.png";
import levelRaw from "./level.tmj?raw";

await initPhysics();
const map = parseTmj(levelRaw, { resolveImage: () => tilesUrl });

engine.changeScene(
  mes(PhysicsWorld2D, {}, [
    mes(TileMap2D, { map, collisions: true }),
    mes(Player, { position: spawn }, [/* ... */]),
  ]),
);
```

## `TileMap2D extends Unit2D`

Places a `TileMapData` in the scene. The map's origin is the top-left corner
of tile (0, 0); tiles extend +x/+y, sized `tileWidth`/`tileHeight` world
units each. On construction it stamps:

- one **`TileMapLayer2D extends Renderable`** child per map layer — the
  renderable count is the number of layers, never the number of tiles;
- with `collisions: true`, one **`StaticBody2D`** child whose
  `CollisionShape2D`s are the solid tiles greedy-merged into few rectangles.

Props (beyond `Unit2DProps`):

| Prop | Notes |
| --- | --- |
| `map` | The `TileMapData`, from `parseTmj` or `tileMapData`. Immutable once placed. |
| `collisions` | Stamp merged colliders. Requires a `PhysicsWorld2D` ancestor and `initPhysics()` awaited. Default false. |
| `z` | Base z layer for tile layers without an explicit `z`. Default 0. |
| `chunkSize` | Tiles per render chunk side. Default 16. |
| `solid` | `(gid) => boolean` overriding tileset solidity for collider stamping. |
| `collisionLayer`, `collisionMask` | Bitmasks passed to the stamped static body. |

Instance members: `tileToWorld(x, y)` / `tileToLocal(x, y)` (tile center),
`worldToTile(point)` / `localToTile(point)` (integer tile coords, may be
off-grid), and `collisionRects` (the merged rectangles, tile coords — handy
for debugging and tests).

**Draw order.** Layers default to the map's base `z`; within a z layer, tree
order draws them in map order and below units placed after the map. Give a
layer an explicit `z` (a Tiled custom layer property, or the field in
programmatic data) to lift it — e.g. foreground foliage at `z: 1` above a
`z: 0` player.

**Static scenery.** Colliders are read once on tree enter (static bodies)
and chunk culling re-evaluates on camera changes, not map moves: position
the map before mounting and leave it still.

## How rendering works

One renderable per layer; each layer draws its tiles in **chunks** (default
16×16 tiles), one `<div>` per chunk holding one cell `<div>` per non-empty
tile. Cells crop the spritesheet with CSS: `background-size` scales the
sheet so one sheet cell equals one map cell and `background-position`
selects the cell — every length in camera units via `calc(n * var(--u))`, so
tilemaps reflow on resize like everything else.

Layers **cull chunks against the active camera**: the view rectangle is
mapped into map-local space and only intersecting chunks (padded by one
tile) are mounted. Live DOM is O(viewport), not O(map) — a 512×512 map
renders the same few hundred cells a 30×20 one does. Chunks are memoized on
immutable inputs, so a camera pan re-renders one chunk-list diff per layer
and touches only edge chunks.

Seams: at fractional `--u`, adjacent cells can show subpixel seams (the
usual DOM tilemap artifact); `image-rendering: pixelated` is applied. If it
bothers a scene, favor integer-friendly camera sizes.

## Merged colliders

`solidMask` builds one boolean per cell (union across layers; a tile is
solid when its tileset marks it `solid`, or your `solid` predicate says so),
and `greedyRects` decomposes the mask into few axis-aligned rectangles:
scan row-major, extend each unclaimed solid cell rightward then downward,
claim and emit. Exact cover, no overlaps — a 100×2 floor is one collider,
not 200, which also removes the internal edges character controllers snag
on. The rectangles become `CollisionShape2D`s on a single static body, so
the whole map is one Rapier body.

## Tiled import: `parseTmj(source, opts?)`

Parses a `.tmj` (Tiled's JSON format — plain JSON, no dependency) from text
or an already-parsed object into `TileMapData`.

- **Supported**: finite orthogonal maps; tile layers with plain-array/CSV
  data; multiple **embedded** tilesets (gids resolve through `firstgid`);
  per-tile bool property `solid: true` marking collider tiles; per-layer int
  property `z` setting a layer's z layer. Invisible layers and
  object/image/group layers are skipped.
- **Rejected, with specific errors**: infinite and non-orthogonal maps;
  base64/compressed layer data (set *Map → Tile Layer Format* to **CSV** in
  Tiled); external `.tsj`/`.tsx` tilesets (use *Map → Embed in Map*);
  tileset margin/spacing (cells must be tightly packed).
- **Flip flags**: Tiled stores flips in the top gid bits (`0x80000000`
  horizontal, `0x40000000` vertical, `0x20000000` diagonal, `0x10000000`
  hex-120°). v1 strips them — the tile renders unflipped and collides
  normally.

Options:

- `resolveImage: (path) => url` maps the tileset's authored image path to
  whatever your bundler serves (e.g. a Vite asset import). Default identity.
- `tileSize`: one tile's **world** width (Tiled speaks pixels, the engine
  speaks camera units); tile height follows the pixel aspect. Default 1.

## Programmatic maps: `tileMapData(options)`

No Tiled required — row-major 2D arrays where `0` is empty and `n` is
tileset tile `n - 1`:

```ts
const map = tileMapData({
  tileSize: 1,
  tileset: { image: tilesUrl, columns: 4, tileCount: 8, solid: [0, 1] },
  layers: [{
    tiles: [
      [0, 0, 0, 0],
      [0, 3, 0, 0],
      [1, 1, 2, 2],
    ],
  }],
});
```

The pure pieces are exported for direct use: `solidMask`, `greedyRects`,
`resolveGid`, `isSolidGid`.

## Rules of the road

- **Position before mounting.** Colliders read the map's transform once on
  tree enter; culling assumes the map holds still afterward.
- **`collisions` needs physics.** A `PhysicsWorld2D` ancestor and an awaited
  `initPhysics()`; without `collisions`, neither is required (though Rapier
  is still a dependency of this package).
- **No scale or shear on collidable maps** — the static body inherits the
  physics rule; keep the map's subtree unscaled when `collisions` is on.
- **Map data is a one-time seed.** Mutating `TileMapData` after placement
  changes nothing; build a new map and a new `TileMap2D` (v1 has no tile
  set/clear API).
