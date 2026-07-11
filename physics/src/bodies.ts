import {
  QueryFilterFlags,
  RigidBodyDesc,
  type KinematicCharacterController,
} from "@dimforge/rapier2d-compat";
import { Unit2D, Vector, type Unit } from "@sylophi/mise-core";
import {
  CollisionObject2D,
  type CollisionObject2DProps,
} from "./collision-object.ts";

/**
 * An immovable body: platforms, walls, the floor. Its transform is read once
 * on tree enter; moving a live static body does not move its colliders.
 */
export class StaticBody2D<
  P extends CollisionObject2DProps = CollisionObject2DProps,
> extends CollisionObject2D<P> {
  protected createBodyDesc(): RigidBodyDesc {
    return RigidBodyDesc.fixed();
  }

  override pushTransform(): void {}
}

export interface CharacterBody2DProps extends CollisionObject2DProps {
  /**
   * Skin gap kept between the character and obstacles, in world units. Keep
   * it small relative to the character's shape. Default 0.05.
   */
  offset?: number;
}

/**
 * A player- or AI-driven body that collides but is not pushed by the
 * simulation: move it with {@link moveAndSlide} from `tick`. Backed by
 * Rapier's kinematic character controller, which handles sliding along
 * obstacles, slopes, and ground detection ("up" is -y, matching gravity
 * down the screen). Tune the underlying `controller` directly for autostep,
 * snap-to-ground, or slope limits.
 */
export class CharacterBody2D<
  P extends CharacterBody2DProps = CharacterBody2DProps,
> extends CollisionObject2D<P> {
  private readonly offset: number;
  private _controller: KinematicCharacterController | null = null;

  constructor(props?: NoInfer<P>) {
    super(props);
    this.offset = props?.offset ?? 0.05;
  }

  /** The Rapier character controller, while live in a physics world. */
  get controller(): KinematicCharacterController | null {
    return this._controller;
  }

  /**
   * Whether the last {@link moveAndSlide} ended touching the ground (any
   * surface in the -y, "up", direction of travel).
   */
  get isOnFloor(): boolean {
    return this._controller?.computedGrounded() ?? false;
  }

  protected createBodyDesc(): RigidBodyDesc {
    return RigidBodyDesc.kinematicPositionBased();
  }

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    const controller = this.physicsWorld!.world.createCharacterController(
      this.offset,
    );
    controller.setUp(new Vector(0, -1)); // y grows downward; up is -y
    this._controller = controller;
  }

  override onTreeExit(parent: Unit | null): void {
    if (this._controller) {
      this.physicsWorld?.world.removeCharacterController(this._controller);
      this._controller = null;
    }
    super.onTreeExit(parent);
  }

  /**
   * Move by `velocity * dt`, sliding along anything solid in the way, and
   * apply the result to `position`. Returns the world-space movement that
   * actually happened. Sensors are passed through; layer/mask filtering
   * applies. Call once per `tick`.
   */
  moveAndSlide(velocity: Vector, dt: number): Vector {
    const desired = velocity.scale(dt);
    const collider = this.colliders[0];
    if (!this._controller || !collider) {
      this.position = this.position.add(desired);
      return desired;
    }
    this._controller.computeColliderMovement(
      collider,
      desired,
      QueryFilterFlags.EXCLUDE_SENSORS,
      this.interactionGroups,
    );
    const m = this._controller.computedMovement();
    const move = new Vector(m.x, m.y);

    // The corrected movement is world-space; write it back as local position.
    const wt = this.worldTransform;
    const target = new Vector(wt.tx + move.x, wt.ty + move.y);
    const parent = this.parent;
    this.position =
      parent instanceof Unit2D
        ? parent.worldTransform.invert().apply(target)
        : target;
    return move;
  }
}
