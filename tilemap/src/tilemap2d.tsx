import { memo, type CSSProperties, type ReactNode } from "react";
import { Unit2D, Vector, type Camera, type Unit2DProps } from "@mise/core";
import {
  Renderable,
  useEngine,
  useObservable,
  type RenderableProps,
} from "@mise/react";
import { CollisionShape2D, StaticBody2D, rect } from "@mise/physics";
import {
  resolveGid,
  solidMask,
  type TileLayerData,
  type TileMapData,
} from "./data.ts";
import { greedyRects, type TileRect } from "./merge.ts";

/** Tiles per chunk side. One chunk is one DOM element holding its cells. */
const DEFAULT_CHUNK_SIZE = 16;

// ── Chunked, culled layer rendering ──────────────────────────────────────────

/**
 * One chunk: a single positioned element with one cell per non-empty tile.
 * Cells crop the spritesheet via `background-position`, with every length in
 * camera units (`var(--u)`), so tilemaps reflow on resize like everything
 * else. Memoized on immutable inputs: a mounted chunk never re-renders.
 */
const Chunk = memo(function Chunk({
  map,
  tiles,
  cx,
  cy,
  chunkSize,
}: {
  map: TileMapData;
  tiles: readonly number[];
  cx: number;
  cy: number;
  chunkSize: number;
}): ReactNode {
  const tw = map.tileWidth;
  const th = map.tileHeight;
  const x0 = cx * chunkSize;
  const y0 = cy * chunkSize;
  const xEnd = Math.min(x0 + chunkSize, map.width);
  const yEnd = Math.min(y0 + chunkSize, map.height);

  const cells: ReactNode[] = [];
  for (let y = y0; y < yEnd; y++) {
    for (let x = x0; x < xEnd; x++) {
      const gid = tiles[y * map.width + x] ?? 0;
      if (gid === 0) continue;
      const ref = resolveGid(map, gid);
      if (!ref) continue;
      const { tileset, localId } = ref;
      const rows = Math.ceil(tileset.tileCount / tileset.columns);
      const sx = localId % tileset.columns;
      const sy = Math.floor(localId / tileset.columns);
      const style: CSSProperties = {
        position: "absolute",
        left: `calc(${(x - x0) * tw} * var(--u))`,
        top: `calc(${(y - y0) * th} * var(--u))`,
        width: `calc(${tw} * var(--u))`,
        height: `calc(${th} * var(--u))`,
        backgroundImage: `url("${tileset.image}")`,
        backgroundSize: `calc(${tileset.columns * tw} * var(--u)) calc(${rows * th} * var(--u))`,
        backgroundPosition: `calc(${-sx * tw} * var(--u)) calc(${-sy * th} * var(--u))`,
        imageRendering: "pixelated",
      };
      cells.push(<div key={`${x},${y}`} style={style} data-tile={gid} />);
    }
  }

  const style: CSSProperties = {
    position: "absolute",
    left: `calc(${x0 * tw} * var(--u))`,
    top: `calc(${y0 * th} * var(--u))`,
  };
  return (
    <div style={style} data-chunk={`${cx},${cy}`}>
      {cells}
    </div>
  );
});

interface ChunkRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const chunksAcross = (tiles: number, chunkSize: number): number =>
  Math.ceil(tiles / chunkSize);

/**
 * The chunks intersecting the camera's view, or null when none: the view
 * rectangle's corners (`camera.viewTransform` is view → world) are mapped
 * into map-local space, the local AABB is padded by one tile, and the range
 * is clamped to the grid. Assumes the tilemap itself is static: a moved map
 * re-culls on the next camera change, not on its own.
 */
function visibleChunks(
  layer: TileMapLayer2D,
  camera: Camera,
): ChunkRange | null {
  const map = layer.map;
  const inv = layer.worldTransform.invert();
  const view = camera.viewTransform;
  const hw = camera.width / 2;
  const hh = camera.height / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of [
    new Vector(-hw, -hh),
    new Vector(hw, -hh),
    new Vector(hw, hh),
    new Vector(-hw, hh),
  ]) {
    const p = inv.apply(view.apply(corner));
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const cw = layer.chunkSize * map.tileWidth;
  const ch = layer.chunkSize * map.tileHeight;
  const x0 = Math.max(0, Math.floor((minX - map.tileWidth) / cw));
  const y0 = Math.max(0, Math.floor((minY - map.tileHeight) / ch));
  const x1 = Math.min(
    chunksAcross(map.width, layer.chunkSize) - 1,
    Math.floor((maxX + map.tileWidth) / cw),
  );
  const y1 = Math.min(
    chunksAcross(map.height, layer.chunkSize) - 1,
    Math.floor((maxY + map.tileHeight) / ch),
  );
  return x0 > x1 || y0 > y1 ? null : { x0, y0, x1, y1 };
}

function allChunks(layer: TileMapLayer2D): ChunkRange {
  return {
    x0: 0,
    y0: 0,
    x1: chunksAcross(layer.map.width, layer.chunkSize) - 1,
    y1: chunksAcross(layer.map.height, layer.chunkSize) - 1,
  };
}

function ChunkGrid({
  layer,
  range,
}: {
  layer: TileMapLayer2D;
  range: ChunkRange | null;
}): ReactNode {
  if (!range) return null;
  const tiles = layer.layerData.tiles;
  const chunks: ReactNode[] = [];
  for (let cy = range.y0; cy <= range.y1; cy++) {
    for (let cx = range.x0; cx <= range.x1; cx++) {
      chunks.push(
        <Chunk
          key={`${cx},${cy}`}
          map={layer.map}
          tiles={tiles}
          cx={cx}
          cy={cy}
          chunkSize={layer.chunkSize}
        />,
      );
    }
  }
  return <>{chunks}</>;
}

/**
 * Re-renders as the view moves — `viewCenter$` fires on the fixed clock while
 * the camera advances, covering direct `position` writes one step later — and
 * on zoom (`width$`/`height$`). Camera scale/rotation changes alone re-cull
 * on the next `viewCenter$` fire.
 */
function CulledChunkGrid({
  layer,
  camera,
}: {
  layer: TileMapLayer2D;
  camera: Camera;
}): ReactNode {
  useObservable(camera.viewCenter$);
  useObservable(camera.width$);
  useObservable(camera.height$);
  return <ChunkGrid layer={layer} range={visibleChunks(layer, camera)} />;
}

const LayerView = ({ unit }: { unit: TileMapLayer2D }): ReactNode => {
  const engine = useEngine();
  const camera = useObservable(engine.activeCamera$);
  if (!camera) return <ChunkGrid layer={unit} range={allChunks(unit)} />;
  return <CulledChunkGrid layer={unit} camera={camera} />;
};

// ── Units ────────────────────────────────────────────────────────────────────

export interface TileMapLayer2DProps extends RenderableProps {
  map: TileMapData;
  /** Index into `map.layers`. */
  layerIndex: number;
  /** Tiles per chunk side. Default 16. */
  chunkSize?: number;
}

/**
 * One tile layer as a renderable: draws its slice of the grid in culled
 * chunks. Created by `TileMap2D` (one per layer); place directly only when
 * layers need to live at different points of the tree.
 */
export class TileMapLayer2D extends Renderable<TileMapLayer2DProps> {
  readonly map: TileMapData;
  readonly layerIndex: number;
  readonly chunkSize: number;

  constructor(props: NoInfer<TileMapLayer2DProps>) {
    super(props);
    this.map = props.map;
    this.layerIndex = props.layerIndex;
    this.chunkSize = props.chunkSize ?? DEFAULT_CHUNK_SIZE;
    if (!this.map.layers[this.layerIndex]) {
      throw new Error(`TileMapLayer2D: no layer ${this.layerIndex} in map`);
    }
  }

  /** The layer's slice of the map data. */
  get layerData(): TileLayerData {
    return this.map.layers[this.layerIndex]!;
  }

  readonly component = LayerView;
}

export interface TileMap2DProps extends Unit2DProps {
  /** The map, from `parseTmj` or `tileMapData`. Immutable once placed. */
  map: TileMapData;
  /**
   * Stamp merged static colliders from the map's solid tiles. Requires a
   * `PhysicsWorld2D` ancestor (and `initPhysics()` awaited). Static bodies
   * read their transform once on tree enter: position the map before
   * mounting.
   */
  collisions?: boolean;
  /** Base z layer for tile layers without an explicit `z`. Default 0. */
  z?: number;
  /** Tiles per chunk side for rendering. Default 16. */
  chunkSize?: number;
  /** Overrides tileset solidity: which gids stamp colliders. */
  solid?: (gid: number) => boolean;
  /** Collision `layer` bitmask for the stamped static body. Default 1. */
  collisionLayer?: number;
  /** Collision `mask` bitmask for the stamped static body. Default all. */
  collisionMask?: number;
}

/**
 * A tile grid in the scene: stamps one `TileMapLayer2D` renderable per map
 * layer, and (with `collisions`) one `StaticBody2D` carrying the solid
 * tiles greedy-merged into few rectangle colliders. The map's origin is the
 * top-left corner of tile (0, 0); tiles extend `+x`/`+y` in world units of
 * `map.tileWidth`/`tileHeight` per tile.
 *
 * Layers default to the map's base `z` — tree order then draws them in layer
 * order, below units placed after the map — and a per-layer `z` (a Tiled
 * custom layer property) lifts e.g. foreground foliage above the player.
 */
export class TileMap2D<
  P extends TileMap2DProps = TileMap2DProps,
> extends Unit2D<P> {
  readonly map: TileMapData;
  /** The merged collider rectangles, in tile coordinates. Empty without `collisions`. */
  readonly collisionRects: readonly TileRect[];

  constructor(props: NoInfer<P>) {
    super(props);
    const { map } = props;
    this.map = map;
    const chunkSize = props.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const zBase = props.z ?? 0;

    map.layers.forEach((layer, layerIndex) => {
      this.addChild(
        new TileMapLayer2D({
          map,
          layerIndex,
          chunkSize,
          z: layer.z ?? zBase,
        }),
      );
    });

    if (props.collisions) {
      this.collisionRects = greedyRects(
        solidMask(map, props.solid),
        map.width,
        map.height,
      );
      const body = new StaticBody2D({
        layer: props.collisionLayer,
        mask: props.collisionMask,
      });
      for (const r of this.collisionRects) {
        body.addChild(
          new CollisionShape2D({
            shape: rect(r.width * map.tileWidth, r.height * map.tileHeight),
            position: new Vector(
              (r.x + r.width / 2) * map.tileWidth,
              (r.y + r.height / 2) * map.tileHeight,
            ),
          }),
        );
      }
      this.addChild(body);
    } else {
      this.collisionRects = [];
    }
  }

  /** The center of tile `(x, y)` in map-local coordinates. */
  tileToLocal(x: number, y: number): Vector {
    return new Vector(
      (x + 0.5) * this.map.tileWidth,
      (y + 0.5) * this.map.tileHeight,
    );
  }

  /** The center of tile `(x, y)` in world coordinates. */
  tileToWorld(x: number, y: number): Vector {
    return this.worldTransform.apply(this.tileToLocal(x, y));
  }

  /** The tile containing a map-local point (integer coords; may be off-grid). */
  localToTile(point: Vector): { x: number; y: number } {
    return {
      x: Math.floor(point.x / this.map.tileWidth),
      y: Math.floor(point.y / this.map.tileHeight),
    };
  }

  /** The tile containing a world point (integer coords; may be off-grid). */
  worldToTile(point: Vector): { x: number; y: number } {
    return this.localToTile(this.worldTransform.invert().apply(point));
  }
}
