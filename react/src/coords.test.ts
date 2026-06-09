import { describe, expect, it } from "vitest";
import { Camera, Vector } from "@mise/core";
import {
  entityTransformCss,
  screenToWorld,
  viewportTransformCss,
} from "./coords.ts";

const t = (position: Vector, rotation: number, scale: Vector) => ({
  position,
  rotation,
  scale,
});

describe("entityTransformCss", () => {
  it("builds a translate/rotate/scale string in --u units", () => {
    expect(entityTransformCss(t(new Vector(50, 25), 0, new Vector(1, 1)))).toBe(
      "translate(calc(50 * var(--u)), calc(25 * var(--u))) rotate(0rad) scale(1, 1)",
    );
  });
});

describe("viewportTransformCss", () => {
  it("is the inverse of the camera transform", () => {
    expect(
      viewportTransformCss(t(new Vector(10, 20), 0, new Vector(2, 2))),
    ).toBe(
      "scale(0.5, 0.5) rotate(0rad) translate(calc(-10 * var(--u)), calc(-20 * var(--u)))",
    );
  });
});

describe("screenToWorld", () => {
  it("inverts --u scaling for a camera at the origin", () => {
    const camera = new Camera({ width: 100, height: 100 });
    // u = 8 px/unit; pixel (400,200) relative to stage → world (50,25)
    const w = screenToWorld(400, 200, 0, 0, 8, camera);
    expect(w.equals(new Vector(50, 25))).toBe(true);
  });

  it("accounts for stage offset and camera pan", () => {
    const camera = new Camera({
      width: 100,
      height: 100,
      position: new Vector(10, 5),
    });
    const w = screenToWorld(80, 80, 0, 0, 8, camera); // view (10,10) + cam (10,5)
    expect(w.equals(new Vector(20, 15))).toBe(true);
  });
});
