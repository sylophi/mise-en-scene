import {
  ActiveCollisionTypes,
  ActiveEvents,
  type Collider,
  type ColliderDesc,
  type RigidBody,
  type RigidBodyDesc,
} from "@dimforge/rapier2d-compat";
import {
  ObservableEvent,
  Unit2D,
  Vector,
  type Unit,
  type Unit2DProps,
} from "@mise/core";
import { colliderDescFor, type Shape } from "./shape.ts";
import { PhysicsWorld2D } from "./world.ts";

export interface CollisionObject2DProps extends Unit2DProps {
  /** Bitmask of layers this object occupies. Default 1. */
  layer?: number;
  /** Bitmask of layers this object collides with. Default all. */
  mask?: number;
  /**
   * Generate `onContactStarted`/`onContactEnded` events for solid contacts
   * involving this object. Default false: Rapier charges per reporting pair,
   * and a pair reports when *either* side opts in, so flag the interested
   * body (the cannonball), not the world (every wall).
   */
  contactEvents?: boolean;
}

/** A solid contact reported to `onContactStarted`/`onContactEnded`. */
export interface Contact2D {
  /** The other unit of the contact pair. */
  other: CollisionObject2D;
  /**
   * A representative world-space contact point, or null when unavailable
   * (always null for ended contacts: the pair no longer touches).
   */
  point: Vector | null;
  /**
   * Unit contact normal pointing from the receiving object toward `other`,
   * or null when unavailable (always null for ended contacts).
   */
  normal: Vector | null;
}

/**
 * Base of every physics unit: a `Unit2D` backed by a Rapier rigid body, with
 * collision shapes contributed by `CollisionShape2D` children.
 *
 * On tree enter it registers with the nearest `PhysicsWorld2D` ancestor; on
 * tree exit the rigid body and its colliders are removed, so physics teardown
 * follows the tree like everything else.
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
  /** Whether this object's colliders generate contact events. */
  readonly contactEvents: boolean;

  /**
   * Fires when a solid (non-sensor) contact involving this object starts.
   * Requires `contactEvents: true` on at least one side of the pair; both
   * sides then receive the event. Fires during the world's tick, one step
   * after the contact actually forms.
   */
  readonly onContactStarted = new ObservableEvent<Contact2D>();
  /** Fires when a solid contact involving this object ends. */
  readonly onContactEnded = new ObservableEvent<Contact2D>();

  private _world: PhysicsWorld2D | null = null;
  private _body: RigidBody | null = null;
  private readonly shapeColliders = new Map<CollisionShape2D, Collider>();

  constructor(props?: NoInfer<P>) {
    super(props);
    this.layer = props?.layer ?? 1;
    this.mask = props?.mask ?? 0xffff;
    this.contactEvents = props?.contactEvents ?? false;
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
    return [...this.shapeColliders.values()];
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
  }

  override onTreeExit(parent: Unit | null): void {
    const world = this._world;
    if (world && this._body) {
      for (const collider of this.shapeColliders.values()) {
        world.unmapCollider(collider.handle);
      }
      this.shapeColliders.clear();
      world.world.removeRigidBody(this._body);
      world.unregister(this);
    }
    this._world = null;
    this._body = null;
    super.onTreeExit(parent);
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
   * @internal Whether this object's colliders are sensors (overlap, don't
   * collide). The world routes events by this: sensor pairs report overlaps,
   * solid pairs report contacts. `Area2D` overrides it to true.
   */
  get isSensor(): boolean {
    return false;
  }

  /**
   * @internal Called by the world after each step, before events are drained.
   * `RigidBody2D` overrides this to write the simulated pose back to the unit.
   */
  postStep(): void {}

  /**
   * @internal Called by the world when a sensor overlap involving this object
   * starts or stops. `Area2D` overrides this to fire its events.
   */
  reportOverlap(_other: CollisionObject2D, _started: boolean): void {}

  /** @internal Called by a `CollisionShape2D` child entering the tree. */
  attachShape(shape: CollisionShape2D): void {
    const world = this._world;
    const body = this._body;
    if (!world || !body) return;
    const desc = colliderDescFor(shape.shape)
      .setTranslation(shape.position.x, shape.position.y)
      .setRotation(shape.rotation)
      .setCollisionGroups(this.interactionGroups);
    this.configureColliderDesc(desc);
    if (this.contactEvents) {
      desc
        .setActiveEvents(ActiveEvents.COLLISION_EVENTS)
        // Rapier skips kinematic↔fixed pairs by default; opting into every
        // pairing only widens narrow-phase *detection*, never solving.
        .setActiveCollisionTypes(ActiveCollisionTypes.ALL);
    }
    const collider = world.world.createCollider(desc, body);
    this.shapeColliders.set(shape, collider);
    world.mapCollider(collider.handle, this);
  }

  /** @internal Called by a `CollisionShape2D` child leaving the tree. */
  detachShape(shape: CollisionShape2D): void {
    const collider = this.shapeColliders.get(shape);
    if (!collider || !this._world) return;
    this.shapeColliders.delete(shape);
    this._world.unmapCollider(collider.handle);
    this._world.world.removeCollider(collider, false);
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
  }

  override onTreeExit(parent: Unit | null): void {
    this.owner?.detachShape(this);
    this.owner = null;
    super.onTreeExit(parent);
  }
}
