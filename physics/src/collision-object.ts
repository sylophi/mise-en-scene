import type {
  Collider,
  ColliderDesc,
  RigidBody,
  RigidBodyDesc,
} from "@dimforge/rapier2d-compat";
import {
  Unit2D,
  Vector,
  type Unit,
  type Unit2DProps,
  type Unsub,
} from "@sylophi/mise-core";
import { colliderDescFor, type Shape } from "./shape.ts";
import { PhysicsWorld2D } from "./world.ts";

export interface CollisionObject2DProps extends Unit2DProps {
  /** Bitmask of layers this object occupies. Default 1. */
  layer?: number;
  /** Bitmask of layers this object collides with. Default all. */
  mask?: number;
}

/** Whether `unit` is `root` or lives somewhere under it. */
const isSelfOrDescendantOf = (unit: Unit, root: Unit): boolean => {
  for (let u: Unit | null = unit; u; u = u.parent) {
    if (u === root) return true;
  }
  return false;
};

/**
 * Base of every physics unit: a `Unit2D` backed by a Rapier rigid body, with
 * collision shapes contributed by `CollisionShape2D` children.
 *
 * On tree enter it registers with the nearest `PhysicsWorld2D` ancestor; on
 * tree exit the rigid body and its colliders are removed, so physics teardown
 * follows the tree like everything else. A same-engine reparent fires no
 * enter/exit, so the object also watches `engine.onUnitMoved`: when it (or an
 * ancestor) moves under a different world, its Rapier resources are rebuilt
 * there.
 *
 * Two objects interact when each one's `layer` intersects the other's `mask`.
 * Colliders follow only the translation and rotation of the world transform:
 * rigid bodies cannot scale or shear, so keep physics units unscaled.
 */
export abstract class CollisionObject2D<
  P extends CollisionObject2DProps = CollisionObject2DProps,
> extends Unit2D<P> {
  readonly layer: number;
  readonly mask: number;

  private _world: PhysicsWorld2D | null = null;
  private _body: RigidBody | null = null;
  // Attached shapes in tree order, each with its live collider (null while
  // this object has no world, so a rebuild can restore them).
  private readonly shapes = new Map<CollisionShape2D, Collider | null>();
  private unwatchMoves: Unsub | null = null;

  constructor(props?: NoInfer<P>) {
    super(props);
    this.layer = props?.layer ?? 1;
    this.mask = props?.mask ?? 0xffff;
  }

  /** The Rapier rigid body, while live in a physics world. */
  get body(): RigidBody | null {
    return this._body;
  }

  /** The world this object is registered in, while live. */
  get physicsWorld(): PhysicsWorld2D | null {
    return this._world;
  }

  /** The Rapier colliders created from this object's shapes, in tree order. */
  get colliders(): readonly Collider[] {
    return [...this.shapes.values()].filter((c) => c !== null);
  }

  /** This object's `(layer, mask)` packed in Rapier's interaction-group format. */
  protected get interactionGroups(): number {
    return ((this.layer & 0xffff) << 16) | (this.mask & 0xffff);
  }

  /** Build the rigid-body descriptor (fixed, kinematic, ...) for this object. */
  protected abstract createBodyDesc(): RigidBodyDesc;

  /** Adjust each collider descriptor before creation (sensors, events, ...). */
  protected configureColliderDesc(_desc: ColliderDesc): void {}

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    this.enterWorld();
    // A move of this unit or an ancestor can change which world contains it.
    this.unwatchMoves = this.engine.onUnitMoved.addListener((moved) => {
      if (isSelfOrDescendantOf(this, moved)) this.relocate();
    });
  }

  override onTreeExit(parent: Unit | null): void {
    this.unwatchMoves?.();
    this.unwatchMoves = null;
    this.exitWorld();
    super.onTreeExit(parent);
  }

  /**
   * Create this object's Rapier resources in the nearest ancestor world.
   * Subclasses that hold extra per-world resources (e.g. a character
   * controller) extend this and {@link exitWorld}, calling super.
   */
  protected enterWorld(): void {
    const world = this.findAncestor(PhysicsWorld2D);
    if (!world) {
      throw new Error(
        `${this.constructor.name} must be a descendant of a PhysicsWorld2D`,
      );
    }
    this._world = world;
    const wt = this.worldTransform;
    const desc = this.createBodyDesc()
      .setTranslation(wt.tx, wt.ty)
      .setRotation(Math.atan2(wt.b, wt.a));
    this._body = world.world.createRigidBody(desc);
    world.register(this);
    // Empty on tree enter (shapes attach as they enter, after this); on a
    // relocation the attached shapes are still here and get new colliders.
    for (const shape of this.shapes.keys()) this.createCollider(shape);
  }

  /** Remove this object's Rapier resources from its current world, if any. */
  protected exitWorld(): void {
    const world = this._world;
    if (world && this._body) {
      for (const collider of this.shapes.values()) {
        if (collider) world.unmapCollider(collider.handle);
      }
      // Removing the rigid body removes its colliders with it.
      world.world.removeRigidBody(this._body);
      world.unregister(this);
    }
    for (const shape of this.shapes.keys()) this.shapes.set(shape, null);
    this._world = null;
    this._body = null;
  }

  /**
   * A same-engine reparent moved this object (or an ancestor of it): rebuild
   * the Rapier resources under whichever world now contains it. Tears down
   * first, so a move out from under every world throws (same guard as tree
   * enter) but leaves nothing behind in the old world.
   */
  private relocate(): void {
    if (this.findAncestor(PhysicsWorld2D) === this._world) return;
    this.exitWorld();
    this.enterWorld();
  }

  /**
   * @internal Push this unit's transform into the simulation, before each
   * step. Kinematic by default; `StaticBody2D` overrides this to a no-op.
   */
  pushTransform(): void {
    const body = this._body;
    if (!body) return;
    const wt = this.worldTransform;
    body.setNextKinematicTranslation(new Vector(wt.tx, wt.ty));
    body.setNextKinematicRotation(Math.atan2(wt.b, wt.a));
  }

  /**
   * @internal Called by the world when a sensor overlap involving this object
   * starts or stops. `Area2D` overrides this to fire its events.
   */
  reportOverlap(_other: CollisionObject2D, _started: boolean): void {}

  /** @internal Called by a `CollisionShape2D` child entering the tree. */
  attachShape(shape: CollisionShape2D): void {
    this.shapes.set(shape, null);
    if (this._world && this._body) this.createCollider(shape);
  }

  /** @internal Called by a `CollisionShape2D` child leaving the tree. */
  detachShape(shape: CollisionShape2D): void {
    const collider = this.shapes.get(shape);
    this.shapes.delete(shape);
    if (collider && this._world) {
      this._world.unmapCollider(collider.handle);
      this._world.world.removeCollider(collider, false);
    }
  }

  private createCollider(shape: CollisionShape2D): void {
    const desc = colliderDescFor(shape.shape)
      .setTranslation(shape.position.x, shape.position.y)
      .setRotation(shape.rotation)
      .setCollisionGroups(this.interactionGroups);
    this.configureColliderDesc(desc);
    const collider = this._world!.world.createCollider(desc, this._body!);
    this.shapes.set(shape, collider);
    this._world!.mapCollider(collider.handle, this);
  }
}

export interface CollisionShape2DProps extends Unit2DProps {
  shape: Shape;
}

/**
 * Contributes one collision shape to its parent body or area. Place as a
 * direct child; its local position and rotation offset the shape within the
 * body. A body may carry several.
 */
export class CollisionShape2D<
  P extends CollisionShape2DProps = CollisionShape2DProps,
> extends Unit2D<P> {
  readonly shape: Shape;
  private owner: CollisionObject2D | null = null;
  private unwatchMoves: Unsub | null = null;

  constructor(props: NoInfer<P>) {
    super(props);
    this.shape = props.shape;
  }

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    const owner = this.findAncestor(CollisionObject2D);
    if (!owner) {
      throw new Error(
        "CollisionShape2D must be a descendant of a physics body or area",
      );
    }
    this.owner = owner;
    owner.attachShape(this);
    // A move of this unit or an ancestor can change which body owns it.
    this.unwatchMoves = this.engine.onUnitMoved.addListener((moved) => {
      if (isSelfOrDescendantOf(this, moved)) this.relocate();
    });
  }

  override onTreeExit(parent: Unit | null): void {
    this.unwatchMoves?.();
    this.unwatchMoves = null;
    this.owner?.detachShape(this);
    this.owner = null;
    super.onTreeExit(parent);
  }

  /** A same-engine reparent moved this shape: re-attach to the new owner. */
  private relocate(): void {
    const owner = this.findAncestor(CollisionObject2D);
    if (owner === this.owner) return; // same body: its own relocation covers us
    this.owner?.detachShape(this);
    this.owner = owner;
    if (!owner) {
      throw new Error(
        "CollisionShape2D must be a descendant of a physics body or area",
      );
    }
    owner.attachShape(this);
  }
}
