import { ColliderDesc } from "@dimforge/rapier2d-compat";

/**
 * A collision shape descriptor: plain data, in world units. Sizes are full
 * extents (a `rect` is `width` by `height`, centered on the owning unit).
 */
export type Shape =
  | { readonly kind: "rect"; readonly width: number; readonly height: number }
  | { readonly kind: "circle"; readonly radius: number }
  | {
      readonly kind: "capsule";
      /** Distance from the center to each cap center, along the y axis. */
      readonly halfHeight: number;
      readonly radius: number;
    };

export const rect = (width: number, height: number): Shape => ({
  kind: "rect",
  width,
  height,
});

export const circle = (radius: number): Shape => ({ kind: "circle", radius });

export const capsule = (halfHeight: number, radius: number): Shape => ({
  kind: "capsule",
  halfHeight,
  radius,
});

/** Build the Rapier collider descriptor for a shape. */
export function colliderDescFor(shape: Shape): ColliderDesc {
  switch (shape.kind) {
    case "rect":
      return ColliderDesc.cuboid(shape.width / 2, shape.height / 2);
    case "circle":
      return ColliderDesc.ball(shape.radius);
    case "capsule":
      return ColliderDesc.capsule(shape.halfHeight, shape.radius);
  }
}
