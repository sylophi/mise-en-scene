/**
 * The tilemap data model: plain immutable data, no engine or DOM types.
 * Produced by `parseTmj` (Tiled import) or `tileMapData` (programmatic), and
 * consumed by `TileMap2D`.
 */

/** One spritesheet and the tile ids it defines. */
export interface TilesetData {
  /** Image URL for the spritesheet (already resolved to something loadable). */
  readonly image: string;
  /** Cells per spritesheet row. Cells are tightly packed (no margin/spacing). */
  readonly columns: number;
  /** Total tiles in the set. Rows derive as `ceil(tileCount / columns)`. */
  readonly tileCount: number;
  /** The global tile id (gid) that maps to this set's local id 0. */
  readonly firstGid: number;
  /** Local tile ids (0-based) that stamp colliders. */
  readonly solid: ReadonlySet<number>;
}

/** One layer of the grid. */
export interface TileLayerData {
  readonly name: string;
  /** Row-major gids, `width * height` long; 0 = empty. */
  readonly tiles: readonly number[];
  /**
   * Explicit z layer for this layer's renderable. Omitted layers share the
   * map's base z, tie-broken by layer order.
   */
  readonly z?: number;
}

/** A complete map: grid dimensions, world scale, tilesets, layers. */
export interface TileMapData {
  /** Grid width in tiles. */
  readonly width: number;
  /** Grid height in tiles. */
  readonly height: number;
  /** One tile's width in world units. */
  readonly tileWidth: number;
  /** One tile's height in world units. */
  readonly tileHeight: number;
  readonly tilesets: readonly TilesetData[];
  /** All layers share the map's dimensions. */
  readonly layers: readonly TileLayerData[];
}

/** A gid resolved to its tileset and local tile id. */
export interface GidRef {
  readonly tileset: TilesetData;
  /** 0-based id within the tileset. */
  readonly localId: number;
}

/**
 * Resolve a gid to its tileset (the one with the largest `firstGid` not
 * exceeding it, per the Tiled spec) and local id. Returns null for empty
 * cells (gid 0) and gids no tileset covers.
 */
export function resolveGid(map: TileMapData, gid: number): GidRef | null {
  if (gid <= 0) return null;
  let best: TilesetData | null = null;
  for (const ts of map.tilesets) {
    if (gid >= ts.firstGid && (!best || ts.firstGid > best.firstGid)) {
      best = ts;
    }
  }
  if (!best) return null;
  const localId = gid - best.firstGid;
  return localId < best.tileCount ? { tileset: best, localId } : null;
}

/** Whether a gid is solid according to its tileset's solid set. */
export function isSolidGid(map: TileMapData, gid: number): boolean {
  const ref = resolveGid(map, gid);
  return ref !== null && ref.tileset.solid.has(ref.localId);
}

/**
 * The solid mask colliders are merged from: one boolean per cell, row-major,
 * the union across all layers. A cell is solid when any layer holds a solid
 * gid there. `isSolid` replaces the tileset lookup (it still never sees
 * empty cells).
 */
export function solidMask(
  map: TileMapData,
  isSolid: (gid: number) => boolean = (gid) => isSolidGid(map, gid),
): boolean[] {
  const mask = Array.from({ length: map.width * map.height }, () => false);
  for (const layer of map.layers) {
    for (let i = 0; i < layer.tiles.length; i++) {
      const gid = layer.tiles[i] ?? 0;
      if (gid !== 0 && isSolid(gid)) mask[i] = true;
    }
  }
  return mask;
}

// ── Programmatic construction ────────────────────────────────────────────────

export interface TileMapDataOptions {
  /** World units per tile. A number means square tiles. Default 1. */
  tileSize?: number | { width: number; height: number };
  /** The single tileset. Tile values in `layers` index into it, offset by 1. */
  tileset: {
    image: string;
    columns: number;
    tileCount: number;
    /** Local tile ids (0-based) that stamp colliders. */
    solid?: Iterable<number>;
  };
  /**
   * Row-major grids: `tiles[y][x]` is 0 for empty or `localId + 1`. All
   * layers must share one size, which becomes the map's size.
   */
  layers: ReadonlyArray<{
    name?: string;
    tiles: ReadonlyArray<readonly number[]>;
    z?: number;
  }>;
}

/**
 * Build a `TileMapData` from plain arrays, no Tiled involved. Tile values are
 * `0` = empty, `n` = tileset tile `n - 1` (i.e. gids with `firstGid` 1).
 */
export function tileMapData(opts: TileMapDataOptions): TileMapData {
  const first = opts.layers[0];
  const height = first?.tiles.length ?? 0;
  const width = first?.tiles[0]?.length ?? 0;
  if (width === 0 || height === 0) {
    throw new Error("tileMapData: at least one non-empty layer is required");
  }
  const size =
    typeof opts.tileSize === "object"
      ? opts.tileSize
      : { width: opts.tileSize ?? 1, height: opts.tileSize ?? 1 };

  const layers = opts.layers.map((layer, i): TileLayerData => {
    const rect =
      layer.tiles.length === height &&
      layer.tiles.every((row) => row.length === width);
    if (!rect) {
      throw new Error(`tileMapData: layer ${i} is not ${width}x${height}`);
    }
    return {
      name: layer.name ?? `layer${i}`,
      tiles: layer.tiles.flat(),
      z: layer.z,
    };
  });

  return {
    width,
    height,
    tileWidth: size.width,
    tileHeight: size.height,
    tilesets: [
      {
        image: opts.tileset.image,
        columns: opts.tileset.columns,
        tileCount: opts.tileset.tileCount,
        firstGid: 1,
        solid: new Set(opts.tileset.solid ?? []),
      },
    ],
    layers,
  };
}
