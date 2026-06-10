import { Vector, type Camera, type Matrix2D } from "@mise/core";

/**
 * CSS transform placing an entity wrapper at its world pose. The linear part
 * (rotation/scale/shear) goes in a unitless `matrix()`; the translation stays
 * in a `translate()` because positions are in camera units scaled by the
 * stage's `--u` variable, and `matrix()` cannot contain `calc()`/`var()`.
 */
export function entityTransformCss(m: Matrix2D): string {
  return (
    `translate(calc(${m.tx} * var(--u)), calc(${m.ty} * var(--u))) ` +
    `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, 0, 0)`
  );
}

/**
 * CSS transform for the viewport: the inverse of the camera's world
 * transform, applied once so a camera move re-renders one element, not every
 * entity. `M⁻¹ = L⁻¹ · T⁻¹`: the translation undoes first (rightmost), then
 * the inverted linear part.
 */
export function viewportTransformCss(m: Matrix2D): string {
  const inv = m.invert();
  return (
    `matrix(${inv.a}, ${inv.b}, ${inv.c}, ${inv.d}, 0, 0) ` +
    `translate(calc(${-m.tx} * var(--u)), calc(${-m.ty} * var(--u)))`
  );
}

/**
 * Map a screen pixel (relative to the stage's top-left) to world coordinates:
 * divide out `--u`, recenter (the camera's position is the middle of the
 * stage), then apply the camera's world transform.
 */
export function screenToWorld(
  clientX: number,
  clientY: number,
  stageLeft: number,
  stageTop: number,
  u: number,
  camera: Camera,
): Vector {
  const view = new Vector(
    (clientX - stageLeft) / (u || 1) - camera.width / 2,
    (clientY - stageTop) / (u || 1) - camera.height / 2,
  );
  return camera.worldTransform.apply(view);
}
