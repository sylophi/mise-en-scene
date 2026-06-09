import { describe, expect, it } from "vitest";
import { Matrix2D } from "./matrix2d.ts";
import { Vector } from "./vector.ts";

const expectVec = (v: Vector, x: number, y: number): void => {
  expect(v.x).toBeCloseTo(x);
  expect(v.y).toBeCloseTo(y);
};

describe("Matrix2D", () => {
  it("fromTRS applies scale, then rotation, then translation", () => {
    const m = Matrix2D.fromTRS(
      new Vector(10, 20),
      Math.PI / 2,
      new Vector(2, 3),
    );
    expectVec(m.apply(new Vector(1, 0)), 10, 22); // (2,0) rotated 90° + t
    expectVec(m.apply(new Vector(0, 1)), 7, 20); // (0,3) rotated 90° + t
  });

  it("multiply composes (the argument applies to a point first)", () => {
    const t = Matrix2D.fromTRS(new Vector(5, 0), 0, Vector.one);
    const r = Matrix2D.fromTRS(Vector.zero, Math.PI / 2, Vector.one);
    expectVec(t.multiply(r).apply(new Vector(1, 0)), 5, 1); // rotate, then move
    expectVec(r.multiply(t).apply(new Vector(1, 0)), 0, 6); // move, then rotate
  });

  it("invert round-trips a point", () => {
    const m = Matrix2D.fromTRS(new Vector(3, -2), 0.7, new Vector(2, 0.5));
    const p = new Vector(4, 9);
    expectVec(m.invert().apply(m.apply(p)), p.x, p.y);
  });

  it("represents shear that a TRS triple cannot", () => {
    const parent = Matrix2D.fromTRS(Vector.zero, 0, new Vector(2, 1));
    const child = Matrix2D.fromTRS(Vector.zero, Math.PI / 4, Vector.one);
    const m = parent.multiply(child);
    const c = Math.SQRT1_2;
    // basis vectors rotate 45°, then stretch 2x along world x only —
    // afterwards they are no longer perpendicular (sheared)
    expectVec(m.apply(new Vector(1, 0)), 2 * c, c);
    expectVec(m.apply(new Vector(0, 1)), -2 * c, c);
  });
});
