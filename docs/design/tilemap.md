# Tilemaps: `TileMap2D`, merged colliders, and Tiled import

Roadmap item 3 ("Content and workflow"): a `TileMap2D` that stamps
renderables and merged static colliders from a grid, with Tiled (`.tmj`)
import as the authoring path.

## Where it lives: a new `@mise/tilemap` package

`@mise/tilemap` depends on `@mise/core`, `@mise/react`, and `@mise/physics`.

A tilemap is not a pillar; it is *content* that composes the pillars: a grid
that needs to be drawn (react) and to be solid (physics). The dependency rule
this repo protects is that the pillars stay independent — `core` knows
nothing of rendering or physics, and `react` and `physics` never see each
other. A content-level package sitting **above** both pillars breaks none of
that; it is exactly the position a game sits in.

Alternatives considered:

- **Split across the pillars**: a data model in `core` (or a data-only
  package), a `TileMapRenderer` in `react`, and a collider stamping helper in
  `physics`. This respects the same rules but fragments one feature across
  three packages, forces users to wire the pieces together by hand, and puts
  grid-content code inside packages whose subject is a pillar, not content.
  The seams it buys (render without physics, collide without rendering) are
  seams almost no game needs to consume separately.
- **`@mise/tilemap` depending on `core` only, with adapters injected** for
  rendering and colliders. Maximum decoupling, maximum ceremony: every user
  writes the same two adapter registrations. Rejected as inversion for its
  own sake.

Cost accepted: importing `@mise/tilemap` pulls in Rapier (via
`@mise/physics`) even when `collisions` is never used. Acceptable for v1;
if it ever matters, the collider stamping can move behind a dynamic import
without changing the API.

Internally the package still keeps the layers separate, so a future split
would be mechanical: `data.ts` (pure data model, no imports from any pillar),
`tmj.ts` (pure parsing), `merge.ts` (pure greedy meshing), and only
`tilemap2d.tsx` touches react and physics.

## Rendering: one Renderable per layer, culled chunks, CSS spritesheet cells

One `Renderable` per **tile** is out: the compositor gives every renderable a
wrapper element plus transform-chain subscriptions, so a 200×200 map would
mean 40,000 subscriptions before the first frame. Instead:

- `TileMap2D` (a plain `Unit2D`, itself invisible) creates one
  **`TileMapLayer2D extends Renderable`** child per tile layer. The number of
  renderables is the number of layers, not tiles.
- Each layer draws its tiles in **chunks** (default 16×16 tiles). A chunk is
  a single absolutely-positioned `<div>` containing one cell `<div>` per
  non-empty tile. Cells crop the spritesheet with the classic CSS trick:
  `background-image` is the sheet, `background-size` scales it so one sheet
  cell equals one map cell, `background-position` selects the cell. All
  lengths are authored in camera units via `calc(n * var(--u))`, so tilemaps
  reflow on resize like everything else and never see a pixel.
- The layer component **culls chunks against the camera view**. It maps the
  camera's view rectangle (via `camera.viewTransform`) into map-local space,
  pads by one tile, and renders only intersecting chunks. Chunk components
  are memoized on immutable inputs, so a camera pan re-renders one cheap
  list-diff per layer and mounts/unmounts only edge chunks.

This is what makes "hundreds × hundreds" work: live DOM is O(viewport), not
O(map). A 512×512 map behind a 24-unit-wide camera renders the same few
hundred cell divs a 30×20 map would. Memory for the data stays a flat
`number[]` per layer.

Re-render triggers for culling are `engine.activeCamera$`,
`camera.viewCenter$` (fires as the view advances on the fixed clock, so it
also covers direct `position` writes one step later), and
`camera.width$`/`height$`.

Alternatives considered:

- **One element per chunk using CSS multiple backgrounds**: a background
  layer cannot be clipped to a subregion of the element, so neighboring
  spritesheet cells would bleed. Not expressible.
- **Bake each chunk to a canvas once and show it as one `<img>`**: fewest
  nodes, but abandons the engine's no-canvas inspectability, adds async image
  decode and lifecycle, and is unnecessary once culling bounds the live DOM.
  It remains the natural future optimization behind the same chunk seam.
- **No culling, all chunks always mounted**: simpler, but a 512×512 map is
  ~260k cell divs. Rejected.

Draw order: every layer defaults to the map's base `z` (prop, default 0),
tie-broken by tree order, so a two-layer map draws background-then-terrain
and a player placed after the map in the scene draws above both. A layer can
opt out via a per-layer `z` (a Tiled custom layer property or the
programmatic field) — e.g. foreground foliage at `z: 1` above a `z: 0`
player.

Known rendering limitations (v1):

- Subpixel seams between tiles can appear at non-integer `--u`; typical for
  DOM/CSS tilemaps. `image-rendering: pixelated` is applied; no gutter
  bleeding is attempted.
- Culling assumes the tilemap itself does not move (it re-culls on camera
  change, not on map transform change). Tilemaps are static scenery in v1.
- Camera `scale`/`rotation` changes alone do not trigger a re-cull (the next
  `viewCenter$` fire does). Zoom by animating `camera.width`/`height`, which
  does.

## Colliders: greedy-merged rectangles on one static body

With `collisions: true`, `TileMap2D` builds a **solid mask** (one boolean per
cell, the union across all layers) and decomposes it into few axis-aligned
rectangles with classic greedy meshing: scan row-major; at each unclaimed
solid cell extend a run rightward, then extend that run downward while every
row below is fully solid and unclaimed; claim and emit. The result exactly
covers the mask with no overlaps — a 100×2 floor is **one** rectangle, not
200.

The rectangles are stamped as **one `StaticBody2D` child holding one
`CollisionShape2D` per rectangle**: one Rapier body, few colliders — the
cheapest shape Rapier offers for static scenery, and it tears down with the
scene like every other physics unit. Merging also removes the internal edges
that make character controllers snag on tile boundaries.

Solidity comes from the tileset: a Tiled per-tile custom property
`solid: true` (or the `solid` id list in programmatic maps). A
`solid?: (gid) => boolean` prop on `TileMap2D` overrides it for maps you
don't control. `collisionLayer`/`collisionMask` pass through to the body.

Requirements inherited from `@mise/physics`: the map must live under a
`PhysicsWorld2D` when `collisions` is on, `initPhysics()` must have been
awaited, and — since static bodies read their transform once on tree enter —
the map must be positioned before mounting.

## Tiled import: `parseTmj`

`.tmj` is plain JSON, so parsing needs no dependency. `parseTmj(source,
opts)` accepts the JSON text or the already-parsed object and returns the
same `TileMapData` the programmatic builder produces. Supported, and enforced
with early, specific errors:

- **Orthogonal, finite maps** only (isometric/hexagonal/infinite rejected).
- **Tile layers** with plain-array/CSV data. Base64 and compressed layers are
  rejected with a pointer to Tiled's "Tile Layer Format: CSV" setting —
  supporting them would drag in inflate implementations for zero authoring
  benefit. Object, image, and group layers are skipped; invisible layers are
  skipped.
- **Embedded tilesets**, first-class, multiple allowed (gids resolve through
  `firstgid` ranges). External `.tsj`/`.tsx` tilesets are rejected with a
  clear message (embed via Tiled's "Embed in Map"); resolving them would make
  the parser async and filesystem-aware. Optional for a later version.
  Margin/spacing must be 0 (the CSS `background-size` crop assumes tightly
  packed cells).
- **Image resolution** is delegated to the caller:
  `resolveImage: (path) => url` maps the tileset's authored image path to
  whatever the bundler serves (e.g. a Vite asset import). Default: identity.
- **World scale**: Tiled speaks pixels; the engine speaks camera units.
  `tileSize` (default 1) sets a tile's world width; height follows the
  tileset's pixel aspect. Pixel sizes are used for nothing else.
- **Per-tile properties**: `solid: true` populates the tileset's solid set.
  A per-layer custom property `z` (int) sets that layer's z layer.
- **Flip flags**: Tiled stores flips in the top gid bits (`0x80000000`
  horizontal, `0x40000000` vertical, `0x20000000` diagonal, `0x10000000`
  hex-120°). v1 documents and **strips** them — the tile renders unflipped
  and collides normally — rather than misrendering garbage gids. Honoring
  them later is a cell-level CSS transform.

Programmatic maps skip Tiled entirely: `tileMapData({ tileset, layers })`
takes row-major 2D arrays (0 = empty, n = tileset tile n−1) and returns the
same `TileMapData`.

## API

```tsx
import { TileMap2D, parseTmj, tileMapData } from "@mise/tilemap";
import tilesUrl from "./tiles.png";
import levelRaw from "./level.tmj?raw";

const map = parseTmj(levelRaw, { resolveImage: () => tilesUrl });

mes(PhysicsWorld2D, {}, [
  mes(TileMap2D, { map, collisions: true }),
  mes(Player, { position: SPAWN }, [...]),
]);
```

- `TileMap2D` props: `map`, `collisions?`, `z?` (base for layers),
  `chunkSize?`, `solid?`, `collisionLayer?`, `collisionMask?` +
  `Unit2DProps`.
- Coordinate helpers on the instance: `tileToWorld(x, y)` (tile center, world
  space), `worldToTile(point)` (integer tile coords), plus the local-space
  pair. `collisionRects` exposes the merged rectangles (debug/tests).
- Pure pieces exported for direct use and testing: `parseTmj`,
  `tileMapData`, `greedyRects`, `solidMask`, `resolveGid`, `isSolidGid`.

## Testing

- `tmj.test.ts`: inline fixture; dimensions, world scaling, gid flag
  stripping, solid properties, multi-tileset gid resolution, layer `z`,
  skip/reject paths.
- `merge.test.ts`: exact rectangles for known grids plus an exact-cover/no-
  overlap check.
- `tilemap2d.test.ts` (node): coordinate math under a transformed map;
  collider stamping verified end-to-end with a raycast and a
  `CharacterBody2D` landing on the merged floor.
- `render.test.tsx` (jsdom): cells and spritesheet crop styles through the
  real compositor; chunk culling responds to camera movement.

The example game `examples/tilemap-platformer` exercises the full path:
generated spritesheet PNG, generated `.tmj`, merged colliders under a
character controller, camera limits from map bounds, and a goal tile.
