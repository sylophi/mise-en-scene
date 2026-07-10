// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Camera, Engine, Vector, mes, type Unit } from "@mise/core";
import { MiseProvider } from "@mise/react";
import { TileMap2D } from "./tilemap2d.tsx";
import { tileMapData } from "./data.ts";

afterEach(() => cleanup());

const makeEngine = (scene: Unit, view = 100): Engine => {
  const engine = new Engine({ autoStart: false });
  const camera = new Camera({ width: view, height: view });
  engine.root.addChild(camera);
  engine.activeCamera = camera;
  engine.changeScene(scene);
  return engine;
};

const cells = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>("[data-tile]"),
];
const chunks = (): string[] =>
  [...document.querySelectorAll<HTMLElement>("[data-chunk]")].map(
    (el) => el.dataset["chunk"]!,
  );

describe("tile layer rendering", () => {
  it("renders one cell per non-empty tile with the spritesheet crop", () => {
    const map = tileMapData({
      tileSize: 2,
      tileset: { image: "sheet.png", columns: 4, tileCount: 8 },
      layers: [
        {
          tiles: [
            [0, 0, 6],
            [1, 2, 0],
          ],
        },
      ],
    });
    render(<MiseProvider engine={makeEngine(mes(TileMap2D, { map }))} />);

    expect(cells()).toHaveLength(3);
    // gid 6 = local id 5 = sheet cell (1, 1) on a 4x2 sheet of 2-unit tiles.
    const six = cells().find((el) => el.dataset["tile"] === "6")!;
    expect(six.style.backgroundImage).toContain("sheet.png");
    expect(six.style.backgroundSize).toBe(
      "calc(8 * var(--u)) calc(4 * var(--u))",
    );
    expect(six.style.backgroundPosition).toBe(
      "calc(-2 * var(--u)) calc(-2 * var(--u))",
    );
    // Placed at tile (2, 0) inside chunk (0, 0).
    expect(six.style.left).toBe("calc(4 * var(--u))");
    expect(six.style.top).toBe("calc(0 * var(--u))");
  });

  it("renders layers as separate renderables with their z", () => {
    const map = tileMapData({
      tileset: { image: "sheet.png", columns: 1, tileCount: 1 },
      layers: [{ tiles: [[1]] }, { tiles: [[1]], z: 3 }],
    });
    const tilemap = mes(TileMap2D, { map });
    render(<MiseProvider engine={makeEngine(tilemap)} />);
    const wrappers = [
      ...document.querySelectorAll<HTMLElement>("[data-unit-id]"),
    ];
    expect(wrappers).toHaveLength(2);
    const zs = wrappers.map((w) => Number(w.style.zIndex));
    // The z: 3 layer lands in a higher z-index band than the z: 0 one.
    expect(Math.max(...zs)).toBeGreaterThan(Math.min(...zs) + 100);
  });

  it("culls chunks to the camera view and re-culls as the camera moves", async () => {
    // 64x64 map of 1-unit tiles, 16-tile chunks -> a 4x4 chunk grid.
    const tiles = Array.from({ length: 64 }, () =>
      Array.from({ length: 64 }, () => 1),
    );
    const map = tileMapData({
      tileset: { image: "sheet.png", columns: 1, tileCount: 1 },
      layers: [{ tiles }],
    });
    const engine = makeEngine(mes(TileMap2D, { map }), 10); // 10x10 view
    render(<MiseProvider engine={engine} />);

    // Camera at (0,0): view spans [-5,5], padded one tile -> chunk (0,0) only.
    expect(chunks()).toEqual(["0,0"]);

    // Move to the middle: view [27,37] straddles chunks 1 and 2 on each axis.
    const camera = engine.activeCamera!;
    camera.position = new Vector(32, 32);
    await act(async () => engine.advanceFixed(engine.fixedStep));
    expect(chunks()).toEqual(["1,1", "2,1", "1,2", "2,2"]); // row-major order

    // Far corner: only the last chunk remains.
    camera.position = new Vector(63, 63);
    await act(async () => engine.advanceFixed(engine.fixedStep));
    expect(chunks()).toEqual(["3,3"]);
  });
});
