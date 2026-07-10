// Initialization
export { initPhysics } from "./init.ts";

// World
export {
  PhysicsWorld2D,
  type PhysicsWorld2DProps,
  type RayCastOptions,
  type RayHit,
} from "./world.ts";

// Bodies and areas
export {
  CollisionObject2D,
  CollisionShape2D,
  type CollisionObject2DProps,
  type CollisionShape2DProps,
} from "./collision-object.ts";
export {
  CharacterBody2D,
  StaticBody2D,
  type CharacterBody2DProps,
} from "./bodies.ts";
export { Area2D } from "./area.ts";

// Shapes
export { capsule, circle, rect, type Shape } from "./shape.ts";

// Debug draw data (rendered by @mise/physics-debug)
export {
  RayLog,
  debugSnapshot,
  type DebugRay,
  type DebugRole,
  type DebugShape,
} from "./debug.ts";
