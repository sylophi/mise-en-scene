import { describe, expect, it } from "vitest";
import { clamp, damp, lerp } from "./math.ts";

describe("clamp", () => {
  it("clamps into the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("lerp", () => {
  it("interpolates linearly, unclamped", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 1.5)).toBe(15);
  });
});

describe("damp", () => {
  it("approaches the target without overshooting", () => {
    const next = damp(0, 10, 5, 0.1);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(10);
  });

  it("is framerate-independent: one big step equals many small ones", () => {
    const oneStep = damp(0, 10, 5, 0.1);
    let manySteps = 0;
    for (let i = 0; i < 10; i++) manySteps = damp(manySteps, 10, 5, 0.01);
    expect(manySteps).toBeCloseTo(oneStep, 10);
  });
});
