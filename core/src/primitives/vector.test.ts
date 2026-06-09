import { describe, expect, it } from "vitest";
import { Vector } from "./vector.ts";

describe("Vector", () => {
  it("is immutable and constructs with x/y", () => {
    const v = new Vector(3, 4);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
  });

  it("add / sub", () => {
    expect(new Vector(1, 2).add(new Vector(3, 4)).equals(new Vector(4, 6))).toBe(true);
    expect(new Vector(5, 5).sub(new Vector(1, 2)).equals(new Vector(4, 3))).toBe(true);
  });

  it("scale (scalar) and mul (component-wise)", () => {
    expect(new Vector(2, 3).scale(2).equals(new Vector(4, 6))).toBe(true);
    expect(new Vector(2, 3).mul(new Vector(4, 5)).equals(new Vector(8, 15))).toBe(true);
  });

  it("rotate by 90 degrees", () => {
    const r = new Vector(1, 0).rotate(Math.PI / 2);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });

  it("dot and cross", () => {
    expect(new Vector(1, 2).dot(new Vector(3, 4))).toBe(11);
    expect(new Vector(1, 0).cross(new Vector(0, 1))).toBe(1);
  });

  it("length / lengthSquared", () => {
    expect(new Vector(3, 4).length()).toBe(5);
    expect(new Vector(3, 4).lengthSquared()).toBe(25);
  });

  it("normalize, with zero-safe behavior", () => {
    expect(new Vector(0, 5).normalize().equals(new Vector(0, 1))).toBe(true);
    expect(Vector.zero.normalize().equals(Vector.zero)).toBe(true);
  });

  it("does not mutate the original", () => {
    const v = new Vector(1, 1);
    v.add(new Vector(9, 9));
    expect(v.equals(new Vector(1, 1))).toBe(true);
  });
});
