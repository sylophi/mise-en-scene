import { describe, expect, it } from "vitest";
import { parseTmj } from "./tmj.ts";
import { isSolidGid, resolveGid } from "./data.ts";

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;

/** A minimal 4x3 Tiled JSON map, overridable per test. */
const makeTmj = (overrides: Record<string, unknown> = {}): object => ({
  type: "map",
  version: "1.10",
  orientation: "orthogonal",
  renderorder: "right-down",
  infinite: false,
  width: 4,
  height: 3,
  tilewidth: 16,
  tileheight: 16,
  tilesets: [
    {
      firstgid: 1,
      name: "tiles",
      image: "tiles.png",
      imagewidth: 64,
      imageheight: 16,
      tilewidth: 16,
      tileheight: 16,
      columns: 4,
      tilecount: 4,
      margin: 0,
      spacing: 0,
      tiles: [
        { id: 0, properties: [{ name: "solid", type: "bool", value: true }] },
        { id: 1, properties: [{ name: "solid", type: "bool", value: false }] },
      ],
    },
  ],
  layers: [
    {
      type: "tilelayer",
      name: "terrain",
      visible: true,
      width: 4,
      height: 3,
      data: [0, 0, 0, 0, 2, 3, 0, 0, 1, 1, 1, 1],
    },
  ],
  ...overrides,
});

describe("parseTmj", () => {
  it("parses dimensions, layers, and tilesets from a JSON string", () => {
    const map = parseTmj(JSON.stringify(makeTmj()));
    expect(map.width).toBe(4);
    expect(map.height).toBe(3);
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0]!.name).toBe("terrain");
    expect(map.layers[0]!.tiles).toEqual([0, 0, 0, 0, 2, 3, 0, 0, 1, 1, 1, 1]);
    expect(map.tilesets[0]).toMatchObject({
      image: "tiles.png",
      columns: 4,
      tileCount: 4,
      firstGid: 1,
    });
  });

  it("defaults to one world unit per tile and scales height by pixel aspect", () => {
    const square = parseTmj(makeTmj());
    expect(square.tileWidth).toBe(1);
    expect(square.tileHeight).toBe(1);
    const tall = parseTmj(makeTmj({ tileheight: 24 }), { tileSize: 2 });
    expect(tall.tileWidth).toBe(2);
    expect(tall.tileHeight).toBe(3);
  });

  it("resolves tileset images through resolveImage", () => {
    const map = parseTmj(makeTmj(), {
      resolveImage: (path) => `/assets/${path}`,
    });
    expect(map.tilesets[0]!.image).toBe("/assets/tiles.png");
  });

  it("reads per-tile solid properties into the tileset's solid set", () => {
    const map = parseTmj(makeTmj());
    expect(map.tilesets[0]!.solid).toEqual(new Set([0]));
    expect(isSolidGid(map, 1)).toBe(true); // gid 1 = local id 0
    expect(isSolidGid(map, 2)).toBe(false); // solid: false
    expect(isSolidGid(map, 3)).toBe(false); // no properties
  });

  it("strips flip flags from gids", () => {
    const map = parseTmj(
      makeTmj({
        layers: [
          {
            type: "tilelayer",
            name: "terrain",
            width: 4,
            height: 3,
            data: [
              FLIP_H + 1,
              FLIP_V + 2,
              FLIP_D + 3,
              FLIP_H + FLIP_V + 4,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
              0,
            ],
          },
        ],
      }),
    );
    expect(map.layers[0]!.tiles.slice(0, 4)).toEqual([1, 2, 3, 4]);
  });

  it("resolves gids across multiple tilesets by firstgid", () => {
    const second = {
      firstgid: 5,
      name: "props",
      image: "props.png",
      columns: 2,
      tilecount: 2,
    };
    const map = parseTmj(
      makeTmj({
        tilesets: [...(makeTmj() as { tilesets: object[] }).tilesets, second],
      }),
    );
    expect(resolveGid(map, 4)!.tileset.image).toBe("tiles.png");
    expect(resolveGid(map, 4)!.localId).toBe(3);
    expect(resolveGid(map, 6)!.tileset.image).toBe("props.png");
    expect(resolveGid(map, 6)!.localId).toBe(1);
    expect(resolveGid(map, 7)).toBeNull(); // past the last tileset's range
    expect(resolveGid(map, 0)).toBeNull(); // empty
  });

  it("reads a per-layer z custom property", () => {
    const layer = {
      type: "tilelayer",
      name: "foreground",
      width: 4,
      height: 3,
      data: Array.from({ length: 12 }, () => 0),
      properties: [{ name: "z", type: "int", value: 2 }],
    };
    const map = parseTmj(makeTmj({ layers: [layer] }));
    expect(map.layers[0]!.z).toBe(2);
  });

  it("skips invisible layers and non-tile layers", () => {
    const map = parseTmj(
      makeTmj({
        layers: [
          { type: "objectgroup", name: "objects", objects: [] },
          {
            type: "tilelayer",
            name: "hidden",
            visible: false,
            width: 4,
            height: 3,
            data: Array.from({ length: 12 }, () => 1),
          },
          {
            type: "tilelayer",
            name: "shown",
            width: 4,
            height: 3,
            data: Array.from({ length: 12 }, () => 2),
          },
        ],
      }),
    );
    expect(map.layers).toHaveLength(1);
    expect(map.layers[0]!.name).toBe("shown");
  });

  it("rejects unsupported maps with specific errors", () => {
    expect(() => parseTmj(makeTmj({ orientation: "isometric" }))).toThrow(
      /orthogonal/,
    );
    expect(() => parseTmj(makeTmj({ infinite: true }))).toThrow(/infinite/);
    expect(() =>
      parseTmj(
        makeTmj({
          layers: [
            {
              type: "tilelayer",
              name: "terrain",
              width: 4,
              height: 3,
              encoding: "base64",
              data: "AAAAAA==",
            },
          ],
        }),
      ),
    ).toThrow(/CSV/);
    expect(() =>
      parseTmj(makeTmj({ tilesets: [{ firstgid: 1, source: "tiles.tsj" }] })),
    ).toThrow(/external tileset/i);
    expect(() =>
      parseTmj(
        makeTmj({
          tilesets: [
            {
              firstgid: 1,
              name: "spaced",
              image: "tiles.png",
              columns: 4,
              tilecount: 4,
              spacing: 2,
            },
          ],
        }),
      ),
    ).toThrow(/margin\/spacing/);
  });

  it("rejects layer data that does not match the map size", () => {
    expect(() =>
      parseTmj(
        makeTmj({
          layers: [
            {
              type: "tilelayer",
              name: "short",
              width: 4,
              height: 3,
              data: [1, 2],
            },
          ],
        }),
      ),
    ).toThrow(/map size/);
  });
});
