/** An axis-aligned rectangle in tile coordinates (sizes in whole tiles). */
export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Greedy rectangle decomposition of a solid mask (row-major, `width * height`
 * booleans): scan row-major; at each unclaimed solid cell, extend a run
 * rightward as far as possible, then extend that run downward while every row
 * below is fully solid and unclaimed; claim and emit. The result covers the
 * mask exactly, with no overlaps — a `100x2` floor is one rectangle, not 200
 * cells — which is what keeps merged tile colliders few and snag-free.
 */
export function greedyRects(
  solid: readonly boolean[],
  width: number,
  height: number,
): TileRect[] {
  const used = Array.from({ length: width * height }, () => false);
  const open = (x: number, y: number): boolean => {
    const i = y * width + x;
    return (solid[i] ?? false) && !(used[i] ?? false);
  };

  const rects: TileRect[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!open(x, y)) continue;

      let w = 1;
      while (x + w < width && open(x + w, y)) w++;

      const rowOpen = (ry: number): boolean => {
        for (let i = 0; i < w; i++) {
          if (!open(x + i, ry)) return false;
        }
        return true;
      };
      let h = 1;
      while (y + h < height && rowOpen(y + h)) h++;

      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          used[(y + dy) * width + (x + dx)] = true;
        }
      }
      rects.push({ x, y, width: w, height: h });
    }
  }
  return rects;
}
