import { Vector, type Camera, type Transform } from "@mise/core";

/**
 * CSS transform placing an entity wrapper at its world pose. Positions are in
 * camera units, scaled to pixels by the stage's `--u` variable.
 */
export function entityTransformCss(t: Transform): string {
  return (
    `translate(calc(${t.position.x} * var(--u)), calc(${t.position.y} * var(--u))) ` +
    `rotate(${t.rotation}rad) scale(${t.scale.x}, ${t.scale.y})`
  );
}

/**
 * CSS transform for the viewport — the inverse of the camera's world transform,
 * applied once so a camera move re-renders one element, not every entity.
 */
export function viewportTransformCss(t: Transform): string {
  return (
    `scale(${1 / t.scale.x}, ${1 / t.scale.y}) rotate(${-t.rotation}rad) ` +
    `translate(calc(${-t.position.x} * var(--u)), calc(${-t.position.y} * var(--u)))`
  );
}

/**
 * Map a screen pixel (relative to the stage's top-left) to world coordinates:
 * divide out `--u` to get view coords, then apply the camera's world transform.
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
    (clientX - stageLeft) / (u || 1),
    (clientY - stageTop) / (u || 1),
  );
  const cam = camera.worldTransform;
  return cam.position.add(view.mul(cam.scale).rotate(cam.rotation));
}
