import type { TileLayerData, TileMapData, TilesetData } from "./data.ts";

export interface ParseTmjOptions {
  /**
   * Map a tileset's image path, as authored in Tiled, to a loadable URL
   * (e.g. a bundler asset import). Default: identity.
   */
  resolveImage?: (path: string) => string;
  /**
   * One tile's width in world units (Tiled speaks pixels; the engine speaks
   * camera units). Tile height follows the map's pixel aspect ratio.
   * Default 1.
   */
  tileSize?: number;
}

/**
 * Tiled packs flip flags into the top gid bits: `0x80000000` horizontal,
 * `0x40000000` vertical, `0x20000000` diagonal, `0x10000000` hex-120°
 * rotation. v1 strips them (tiles render unflipped and collide normally);
 * honoring them later is a cell-level CSS transform.
 */
const GID_MASK = 0x0fff_ffff;

// The slices of the Tiled JSON format this parser reads.
// https://doc.mapeditor.org/en/stable/reference/json-map-format/
interface TmjProperty {
  name: string;
  value: unknown;
}
interface TmjTile {
  id: number;
  properties?: TmjProperty[];
}
interface TmjTileset {
  firstgid?: number;
  source?: string;
  name?: string;
  image?: string;
  columns?: number;
  tilecount?: number;
  margin?: number;
  spacing?: number;
  tiles?: TmjTile[];
}
interface TmjLayer {
  type?: string;
  name?: string;
  visible?: boolean;
  width?: number;
  height?: number;
  data?: number[] | string;
  encoding?: string;
  properties?: TmjProperty[];
}
interface TmjMap {
  orientation?: string;
  infinite?: boolean;
  width?: number;
  height?: number;
  tilewidth?: number;
  tileheight?: number;
  layers?: TmjLayer[];
  tilesets?: TmjTileset[];
}

const fail = (msg: string): never => {
  throw new Error(`parseTmj: ${msg}`);
};

const property = (props: TmjProperty[] | undefined, name: string): unknown =>
  props?.find((p) => p.name === name)?.value;

/**
 * Parse a Tiled `.tmj` map (the JSON text, or the already-parsed object)
 * into a `TileMapData`.
 *
 * Supported: finite orthogonal maps; tile layers with plain-array/CSV data;
 * embedded tilesets (several allowed), margin/spacing 0; a per-tile custom
 * property `solid: true` marking collider tiles; a per-layer custom property
 * `z` (int) setting that layer's z layer. Invisible layers and
 * object/image/group layers are skipped. Rejected with specific errors:
 * infinite or non-orthogonal maps, base64/compressed layer data (set Tiled's
 * "Tile Layer Format" to CSV), and external tilesets (use Tiled's "Embed in
 * Map"). Flip flags in gids are stripped, see {@link GID_MASK}.
 */
export function parseTmj(
  source: string | object,
  opts: ParseTmjOptions = {},
): TileMapData {
  const json = (
    typeof source === "string" ? JSON.parse(source) : source
  ) as TmjMap;

  if (json.orientation !== "orthogonal") {
    fail(`only orthogonal maps are supported (got "${json.orientation}")`);
  }
  if (json.infinite) {
    fail("infinite maps are not supported; give the map a fixed size");
  }
  const { width, height, tilewidth, tileheight } = json;
  if (!width || !height || !tilewidth || !tileheight) {
    fail("map is missing width/height/tilewidth/tileheight");
  }

  const tileWidth = opts.tileSize ?? 1;
  const tileHeight = tileWidth * (tileheight! / tilewidth!);
  const resolveImage = opts.resolveImage ?? ((path: string) => path);

  const tilesets = (json.tilesets ?? []).map((ts): TilesetData => {
    if (ts.source !== undefined) {
      fail(
        `external tilesets are not supported (found "${ts.source}"); ` +
          `embed the tileset in the map (Tiled: Map > Embed in Map)`,
      );
    }
    if (!ts.image || !ts.columns || !ts.tilecount || !ts.firstgid) {
      fail(`tileset "${ts.name ?? "?"}" is missing image/columns/tilecount`);
    }
    if ((ts.margin ?? 0) !== 0 || (ts.spacing ?? 0) !== 0) {
      fail(
        `tileset "${ts.name ?? "?"}" has margin/spacing; ` +
          `only tightly packed tilesets are supported`,
      );
    }
    const solid = new Set<number>();
    for (const tile of ts.tiles ?? []) {
      if (property(tile.properties, "solid") === true) solid.add(tile.id);
    }
    return {
      image: resolveImage(ts.image!),
      columns: ts.columns!,
      tileCount: ts.tilecount!,
      firstGid: ts.firstgid!,
      solid,
    };
  });

  const layers: TileLayerData[] = [];
  for (const layer of json.layers ?? []) {
    if (layer.type !== "tilelayer") continue; // object/image/group: skipped
    if (layer.visible === false) continue;
    if (typeof layer.data === "string" || layer.encoding === "base64") {
      fail(
        `layer "${layer.name ?? "?"}" uses base64/compressed data; ` +
          `set Map > Tile Layer Format to CSV in Tiled`,
      );
    }
    if (!Array.isArray(layer.data) || layer.data.length !== width! * height!) {
      fail(`layer "${layer.name ?? "?"}" data does not match the map size`);
    }
    const z = property(layer.properties, "z");
    layers.push({
      name: layer.name ?? "",
      tiles: (layer.data as number[]).map((gid) => gid & GID_MASK),
      z: typeof z === "number" ? z : undefined,
    });
  }

  return {
    width: width!,
    height: height!,
    tileWidth,
    tileHeight,
    tilesets,
    layers,
  };
}
