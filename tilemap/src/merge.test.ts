import { describe, expect, it } from "vitest";
import { greedyRects, type TileRect } from "./merge.ts";

/** Parse an ASCII grid: `#` solid, anything else empty. */
const grid = (rows: string[]): [boolean[], number, number] => {
  const width = rows[0]?.length ?? 0;
  const solid = rows.flatMap((row) => [...row].map((c) => c === "#"));
  return [solid, width, rows.length];
};

/** Every solid cell covered exactly once, no rect over an empty cell. */
const expectExactCover = (
  rects: TileRect[],
  solid: boolean[],
  width: number,
  height: number,
): void => {
  const covered = Array.from({ length: width * height }, () => 0);
  for (const r of rects) {
    for (let dy = 0; dy < r.height; dy++) {
      for (let dx = 0; dx < r.width; dx++) {
        covered[(r.y + dy) * width + (r.x + dx)]! += 1;
      }
    }
  }
  for (let i = 0; i < width * height; i++) {
    expect(covered[i]).toBe(solid[i] ? 1 : 0);
  }
};

describe("greedyRects", () => {
  it("merges a fully solid grid into one rectangle", () => {
    const [solid, w, h] = grid(["####", "####", "####"]);
    expect(greedyRects(solid, w, h)).toEqual([
      { x: 0, y: 0, width: 4, height: 3 },
    ]);
  });

  it("returns nothing for an empty grid", () => {
    const [solid, w, h] = grid(["....", "...."]);
    expect(greedyRects(solid, w, h)).toEqual([]);
  });

  it("merges a long floor into one rectangle, not per-tile cells", () => {
    const [solid, w, h] = grid([
      "................",
      "################",
      "################",
    ]);
    expect(greedyRects(solid, w, h)).toEqual([
      { x: 0, y: 1, width: 16, height: 2 },
    ]);
  });

  it("splits runs across gaps in a row", () => {
    const [solid, w, h] = grid(["##.#"]);
    expect(greedyRects(solid, w, h)).toEqual([
      { x: 0, y: 0, width: 2, height: 1 },
      { x: 3, y: 0, width: 1, height: 1 },
    ]);
  });

  it("extends a run downward only while the full row below is solid", () => {
    const [solid, w, h] = grid(["##.", "##.", "###"]);
    expect(greedyRects(solid, w, h)).toEqual([
      { x: 0, y: 0, width: 2, height: 3 },
      { x: 2, y: 2, width: 1, height: 1 },
    ]);
  });

  it("keeps checkerboard cells separate", () => {
    const [solid, w, h] = grid(["#.#", ".#.", "#.#"]);
    const rects = greedyRects(solid, w, h);
    expect(rects).toHaveLength(5);
    expectExactCover(rects, solid, w, h);
  });

  it("exactly covers an irregular platformer-ish grid", () => {
    const [solid, w, h] = grid([
      "..........",
      "...###....",
      "..........",
      "#......##.",
      "#......##.",
      "##########",
      "##########",
    ]);
    const rects = greedyRects(solid, w, h);
    expectExactCover(rects, solid, w, h);
    // Sanity on the merge quality: far fewer rects than solid cells.
    const solidCount = solid.filter(Boolean).length;
    expect(rects.length).toBeLessThan(solidCount / 3);
  });
});
