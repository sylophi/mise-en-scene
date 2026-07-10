import { beforeAll, describe, expect, it } from "vitest";
import { Engine, Vector, mes, type Unit } from "@mise/core";
import {
  CharacterBody2D,
  CollisionShape2D,
  PhysicsWorld2D,
  initPhysics,
  rect,
} from "@mise/physics";
import { TileMap2D } from "./tilemap2d.tsx";
import { tileMapData, type TileMapData } from "./data.ts";

beforeAll(() => initPhysics());

const engineWith = (scene: Unit): Engine => {
  const e = new Engine({ autoStart: false });
  e.changeScene(scene);
  return e;
};

const steps = (e: Engine, n: number): void => {
  for (let i = 0; i < n; i++) e.advanceFixed(e.fixedStep);
};

/** 6x4, tiles 2x2 world units: a floor on the bottom row plus one block. */
const makeMap = (): TileMapData =>
  tileMapData({
    tileSize: 2,
    tileset: { image: "tiles.png", columns: 2, tileCount: 2, solid: [0] },
    layers: [
      {
        tiles: [
          [0, 0, 0, 0, 0, 0],
          [0, 0, 1, 0, 0, 0],
          [0, 0, 0, 0, 0, 2], // gid 2 (local id 1) is not solid
          [1, 1, 1, 1, 1, 1],
        ],
      },
    ],
  });

describe("coordinate helpers", () => {
  it("converts tile centers to world space and back, map at the origin", () => {
    const map = mes(TileMap2D, { map: makeMap() });
    engineWith(map);
    expect(map.tileToWorld(0, 0)).toEqual(new Vector(1, 1));
    expect(map.tileToWorld(2, 1)).toEqual(new Vector(5, 3));
    expect(map.worldToTile(new Vector(5, 3))).toEqual({ x: 2, y: 1 });
    expect(map.worldToTile(new Vector(0.1, 7.9))).toEqual({ x: 0, y: 3 });
  });

  it("respects the map's transform", () => {
    const map = mes(TileMap2D, {
      map: makeMap(),
      position: new Vector(10, -4),
    });
    engineWith(map);
    expect(map.tileToWorld(0, 0)).toEqual(new Vector(11, -3));
    expect(map.worldToTile(new Vector(11, -3))).toEqual({ x: 0, y: 0 });
    expect(map.worldToTile(new Vector(9, 0))).toEqual({ x: -1, y: 2 });
  });
});

describe("collider stamping", () => {
  it("greedy-merges solid tiles into few shapes on one static body", () => {
    const map = mes(TileMap2D, { map: makeMap(), collisions: true });
    const world = mes(PhysicsWorld2D, {}, [map]);
    engineWith(world);

    // The floor row merges into one rect; the lone block is another.
    expect(map.collisionRects).toEqual([
      { x: 2, y: 1, width: 1, height: 1 },
      { x: 0, y: 3, width: 6, height: 1 },
    ]);
    const bodies = map.children.filter((c) => !("layerData" in c));
    expect(bodies).toHaveLength(1);
  });

  it("places real colliders where the solid tiles are", () => {
    const map = mes(TileMap2D, { map: makeMap(), collisions: true });
    const world = mes(PhysicsWorld2D, {}, [map]);
    const e = engineWith(world);
    steps(e, 1); // queries see colliders after the first step

    // Straight down at x=2: passes the empty rows, hits the floor top (y=6).
    const down = world.castRay(new Vector(2, 0), new Vector(0, 1));
    expect(down).not.toBeNull();
    expect(down!.point.y).toBeCloseTo(6);

    // Straight down at x=5: hits the lone block's top (tile (2,1), y=2).
    const block = world.castRay(new Vector(5, 0), new Vector(0, 1));
    expect(block!.point.y).toBeCloseTo(2);

    // The non-solid gid-2 tile at (5,2) has no collider above the floor.
    const gap = world.castRay(new Vector(11, 0), new Vector(0, 1));
    expect(gap!.point.y).toBeCloseTo(6);
  });

  it("keeps a character standing on the merged floor", () => {
    class Faller extends CharacterBody2D {
      vy = 0;
      override tick(dt: number): void {
        this.vy = this.isOnFloor ? 0 : this.vy + 60 * dt;
        this.moveAndSlide(new Vector(0, this.vy), dt);
      }
    }
    const map = mes(TileMap2D, { map: makeMap(), collisions: true });
    const player = mes(Faller, { position: new Vector(8, 1) }, [
      mes(CollisionShape2D, { shape: rect(1, 1) }),
    ]);
    const e = engineWith(mes(PhysicsWorld2D, {}, [map, player]));
    steps(e, 120);
    expect(player.isOnFloor).toBe(true);
    // Floor top at y=6, half-height 0.5, controller skin 0.05.
    expect(player.position.y).toBeGreaterThan(5.3);
    expect(player.position.y).toBeLessThan(5.6);
  });

  it("honors a custom solid predicate", () => {
    const map = mes(TileMap2D, {
      map: makeMap(),
      collisions: true,
      solid: (gid) => gid === 2,
    });
    engineWith(mes(PhysicsWorld2D, {}, [map]));
    expect(map.collisionRects).toEqual([{ x: 5, y: 2, width: 1, height: 1 }]);
  });

  it("stamps no colliders when collisions is off", () => {
    const map = mes(TileMap2D, { map: makeMap() });
    engineWith(map);
    expect(map.collisionRects).toEqual([]);
    // Only the single layer renderable was stamped.
    expect(map.children).toHaveLength(1);
  });
});
