import { describe, expect, it } from "vitest";
import { Unit } from "./unit.ts";
import { Unit2D } from "./unit2d.ts";
import { Vector } from "../primitives/vector.ts";

describe("Unit2D transform", () => {
  it("defaults to zero position, zero rotation, unit scale", () => {
    const u = new Unit2D();
    expect(u.position.get().equals(Vector.zero)).toBe(true);
    expect(u.rotation.get()).toBe(0);
    expect(u.scale.get().equals(Vector.one)).toBe(true);
  });

  it("composes world position by translation", () => {
    const parent = new Unit2D({ position: new Vector(10, 0) });
    const child = new Unit2D({ position: new Vector(5, 0) });
    parent.addChild(child);
    expect(child.worldTransform.position.equals(new Vector(15, 0))).toBe(true);
  });

  it("applies parent rotation to child offset", () => {
    const parent = new Unit2D({ position: new Vector(10, 0), rotation: Math.PI / 2 });
    const child = new Unit2D({ position: new Vector(5, 0) });
    parent.addChild(child);
    const w = child.worldTransform.position;
    expect(w.x).toBeCloseTo(10);
    expect(w.y).toBeCloseTo(5);
  });

  it("composes scale per-axis and sums rotation", () => {
    const parent = new Unit2D({ scale: new Vector(2, 3), rotation: 0.5 });
    const child = new Unit2D({ scale: new Vector(4, 5), rotation: 0.25 });
    parent.addChild(child);
    expect(child.worldTransform.scale.equals(new Vector(8, 15))).toBe(true);
    expect(child.worldTransform.rotation).toBeCloseTo(0.75);
  });

  it("breaks inheritance at a non-Unit2D ancestor", () => {
    const top = new Unit2D({ position: new Vector(10, 0) });
    const plain = new Unit(); // non-Unit2D resets the origin
    const leaf = new Unit2D({ position: new Vector(5, 0) });
    top.addChild(plain);
    plain.addChild(leaf);
    // leaf's parent is a plain Unit, so its world == its local
    expect(leaf.worldTransform.position.equals(new Vector(5, 0))).toBe(true);
  });
});
