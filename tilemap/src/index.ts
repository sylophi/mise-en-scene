// Data model
export {
  isSolidGid,
  resolveGid,
  solidMask,
  tileMapData,
  type GidRef,
  type TileLayerData,
  type TileMapData,
  type TileMapDataOptions,
  type TilesetData,
} from "./data.ts";

// Tiled import
export { parseTmj, type ParseTmjOptions } from "./tmj.ts";

// Collider merging
export { greedyRects, type TileRect } from "./merge.ts";

// Units
export {
  TileMap2D,
  TileMapLayer2D,
  type TileMap2DProps,
  type TileMapLayer2DProps,
} from "./tilemap2d.tsx";
