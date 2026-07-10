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
  type Contact2D,
} from "./collision-object.ts";
export {
  CharacterBody2D,
  StaticBody2D,
  type CharacterBody2DProps,
} from "./bodies.ts";
export { RigidBody2D, type RigidBody2DProps } from "./rigidbody.ts";
export { Area2D } from "./area.ts";

// Shapes
export { capsule, circle, rect, type Shape } from "./shape.ts";
