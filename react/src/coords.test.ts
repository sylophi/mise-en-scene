import { describe, expect, it } from "vitest";
import { Camera, Matrix2D, Vector } from "@sylophi/mise-core";
import {
  entityTransformCss,
  screenToWorld,
  viewportTransformCss,
} from "./coords.ts";

describe("entityTransformCss", () => {
  it("splits the --u translation from a unitless linear matrix", () => {
    const m = Matrix2D.fromTRS(new Vector(50, 25), 0, Vector.one);
    expect(entityTransformCss(m)).toBe(
      "translate(calc(50 * var(--u)), calc(25 * var(--u))) matrix(1, 0, 0, 1, 0, 0)",
    );
  });
});

describe("viewportTransformCss", () => {
  it("is the inverse of the camera transform", () => {
    const m = Matrix2D.fromTRS(new Vector(10, 20), 0, new Vector(2, 2));
    expect(viewportTransformCss(m)).toBe(
      "matrix(0.5, 0, 0, 0.5, 0, 0) translate(calc(-10 * var(--u)), calc(-20 * var(--u)))",
    );
  });
});

describe("screenToWorld", () => {
  it("maps the stage center to the camera position", () => {
    const camera = new Camera({
      width: 100,
      height: 100,
      position: new Vector(10, 5),
    });
    // u = 8 px/unit → the stage is 800x800; its center is the camera position
    const w = screenToWorld(400, 400, 0, 0, 8, camera);
    expect(w.equals(new Vector(10, 5))).toBe(true);
  });

  it("maps corners symmetrically around the camera", () => {
    const camera = new Camera({ width: 100, height: 100 });
    expect(
      screenToWorld(0, 0, 0, 0, 8, camera).equals(new Vector(-50, -50)),
    ).toBe(true);
    expect(
      screenToWorld(800, 800, 0, 0, 8, camera).equals(new Vector(50, 50)),
    ).toBe(true);
  });
});
