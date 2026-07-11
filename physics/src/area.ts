import {
  ActiveCollisionTypes,
  ActiveEvents,
  RigidBodyDesc,
  type ColliderDesc,
} from "@dimforge/rapier2d-compat";
import { ObservableEvent } from "@sylophi/mise-core";
import {
  CollisionObject2D,
  type CollisionObject2DProps,
} from "./collision-object.ts";

/**
 * A detection zone: overlaps things but collides with nothing. Hitboxes,
 * hurtboxes, triggers, pickups. Follows its unit transform like a kinematic
 * body, so it can be parented to a moving character.
 *
 * Enter/exit events fire during the physics world's tick, one step after the
 * overlap actually changes. For "what is inside right now" (a hitbox alive
 * for a few frames), poll {@link getOverlapping} instead.
 */
export class Area2D<
  P extends CollisionObject2DProps = CollisionObject2DProps,
> extends CollisionObject2D<P> {
  /** Fires when a body (not an area) starts overlapping this area. */
  readonly onBodyEntered = new ObservableEvent<CollisionObject2D>();
  /** Fires when a body stops overlapping this area. */
  readonly onBodyExited = new ObservableEvent<CollisionObject2D>();
  /** Fires when another area starts overlapping this area. */
  readonly onAreaEntered = new ObservableEvent<Area2D>();
  /** Fires when another area stops overlapping this area. */
  readonly onAreaExited = new ObservableEvent<Area2D>();

  protected createBodyDesc(): RigidBodyDesc {
    return RigidBodyDesc.kinematicPositionBased();
  }

  protected override configureColliderDesc(desc: ColliderDesc): void {
    desc
      .setSensor(true)
      .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
      // Sensors only watch dynamic bodies by default; our bodies are
      // kinematic and fixed, so opt into every pairing.
      .setActiveCollisionTypes(ActiveCollisionTypes.ALL);
  }

  override reportOverlap(other: CollisionObject2D, started: boolean): void {
    if (other instanceof Area2D) {
      (started ? this.onAreaEntered : this.onAreaExited).fire(other);
    } else {
      (started ? this.onBodyEntered : this.onBodyExited).fire(other);
    }
  }

  /** Everything overlapping this area right now (bodies and areas). */
  getOverlapping(): CollisionObject2D[] {
    const world = this.physicsWorld;
    if (!world) return [];
    const found = new Set<CollisionObject2D>();
    for (const collider of this.colliders) {
      world.world.intersectionPairsWith(collider, (other) => {
        const unit = world.objectFor(other.handle);
        if (unit && unit !== this) found.add(unit);
      });
    }
    return [...found];
  }
}
