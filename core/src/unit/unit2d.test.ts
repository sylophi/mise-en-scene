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
    const origin = child.worldTransform.apply(Vector.zero);
    expect(origin.equals(new Vector(15, 0))).toBe(true);
  });

  it("applies parent rotation to child offset", () => {
    const parent = new Unit2D({
      position: new Vector(10, 0),
      rotation: Math.PI / 2,
    });
    const child = new Unit2D({ position: new Vector(5, 0) });
    parent.addChild(child);
    const w = child.worldTransform.apply(Vector.zero);
    expect(w.x).toBeCloseTo(10);
    expect(w.y).toBeCloseTo(5);
  });

  it("composes nested scale per-axis", () => {
    const parent = new Unit2D({ scale: new Vector(2, 3) });
    const child = new Unit2D({ scale: new Vector(4, 5) });
    parent.addChild(child);
    const p = child.worldTransform.apply(new Vector(1, 1));
    expect(p.x).toBeCloseTo(8);
    expect(p.y).toBeCloseTo(15);
  });

  it("keeps shear when non-uniform parent scale meets child rotation", () => {
    const parent = new Unit2D({ scale: new Vector(2, 1) });
    const child = new Unit2D({ rotation: Math.PI / 2 });
    parent.addChild(child);
    // (1,0) rotates 90° to (0,1); the parent stretches x only, so it stays
    // (0,1). The old TRS composition produced (0,2) — scale leaked onto the
    // rotated axis.
    const p = child.worldTransform.apply(new Vector(1, 0));
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it("breaks inheritance at a non-Unit2D ancestor", () => {
    const top = new Unit2D({ position: new Vector(10, 0) });
    const plain = new Unit(); // non-Unit2D resets the origin
    const leaf = new Unit2D({ position: new Vector(5, 0) });
    top.addChild(plain);
    plain.addChild(leaf);
    // leaf's parent is a plain Unit, so its world == its local
    const origin = leaf.worldTransform.apply(Vector.zero);
    expect(origin.equals(new Vector(5, 0))).toBe(true);
  });
});
