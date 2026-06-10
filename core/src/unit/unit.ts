import { ObservableEvent } from "../primitives/observable-event.ts";
import type { Engine } from "../engine/engine.ts";

export interface UnitProps {
  /** Stable id. Auto-generated if omitted. */
  id?: string;
}

let nextId = 1;

/**
 * Base unit. Ticks, holds reactive state, and lives in a tree. Invisible by itself.
 *
 * A unit is "live" (in the tree, ticked, lifecycle-active) exactly when it is
 * bound to an {@link Engine}, i.e. connected up to a {@link Root} that has one.
 * Binding is inherited from the parent on {@link addChild}, propagates down the
 * attached subtree, and clears on detach. A currently bound subtree can never
 * be attached into a different engine's tree.
 */
export class Unit {
  readonly id: string;

  private _parent: Unit | null = null;
  // Allocated lazily: most units (bullets, timers, spawners) never have a
  // structural observer, and units are a per-frame spawn hot path.
  private _onParentChanged: ObservableEvent<Unit | null> | null = null;
  private readonly _children: Unit[] = [];
  protected _engine: Engine | null = null;
  private _destroyed = false;

  constructor(props: UnitProps = {}) {
    this.id = props.id ?? `unit-${nextId++}`;
  }

  // ── Tree ────────────────────────────────────────────────────────────────

  get parent(): Unit | null {
    return this._parent;
  }

  /**
   * Fires after this unit's `parent` changes (attach, reparent, detach), with
   * the new parent. Same-engine reparenting fires no tree enter/exit, so
   * structural observers (e.g. a renderer's transform subscriptions) listen
   * here instead.
   */
  get onParentChanged(): ObservableEvent<Unit | null> {
    return (this._onParentChanged ??= new ObservableEvent());
  }

  get children(): readonly Unit[] {
    return this._children;
  }

  /**
   * The engine this unit is bound to. Typed non-null for ergonomics: every
   * live unit has one, and tick/lifecycle code is the intended call site.
   * Reading it on a treeless/detached unit returns null at runtime; doing
   * so is a bug in the caller. (Check `isLive` if genuinely unsure.)
   */
  get engine(): Engine {
    return this._engine as Engine;
  }

  /** Whether the unit is currently in the live tree (bound to an engine). */
  get isLive(): boolean {
    return this._engine !== null;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  /** The top of this unit's tree (walks up `parent`). */
  get root(): Unit {
    let u: Unit = this;
    while (u._parent) u = u._parent;
    return u;
  }

  /**
   * Attach `child` under this unit. Reparents if `child` already has a parent.
   * Engine binding propagates into the child subtree, which may fire
   * `onTreeEnter`/`onTreeExit` as it enters or leaves the live tree.
   */
  addChild(child: Unit): void {
    if (child._destroyed) throw new Error("cannot add a destroyed unit");
    // Cycle guard: child must not be an ancestor of this (covers child === this).
    for (let p: Unit | null = this; p; p = p._parent) {
      if (p === child) throw new Error("addChild would create a cycle");
    }
    // Cross-engine guard: a bound subtree can never join a different engine.
    if (child._engine && this._engine && child._engine !== this._engine) {
      throw new Error("cannot move a unit across engines");
    }

    if (child._parent === this) return;
    // A same-engine reparent fires no enter/exit; report it as a move instead.
    const engine = this._engine;
    const isMove =
      child._parent !== null && engine !== null && child._engine === engine;
    if (child._parent) child._parent._unlink(child);

    child._parent = this;
    this._children.push(child);
    child.propagateEngine(this._engine);
    child._onParentChanged?.fire(this);
    if (isMove) engine.onUnitMoved.fire(child);
  }

  /** Detach `child` from the tree. Does not destroy it. */
  removeChild(child: Unit): void {
    if (child._parent !== this) return;
    this._unlink(child); // detach first so the live tree reflects the removal
    child.propagateEngine(null, this); // then fire exits, reporting the parent left
    child._onParentChanged?.fire(null);
  }

  private _unlink(child: Unit): void {
    const i = this._children.indexOf(child);
    if (i >= 0) this._children.splice(i, 1);
    child._parent = null;
  }

  /**
   * Set the engine binding for this unit and its subtree, firing lifecycle on the
   * transitions. Enter is top-down (self before children); exit is bottom-up.
   */
  protected propagateEngine(
    engine: Engine | null,
    exitParent: Unit | null = this._parent,
  ): void {
    if (this._engine === engine) return;

    if (engine) {
      // Entering the live tree: bind + notify self, then descend.
      this._engine = engine;
      this.onTreeEnter(this._parent);
      engine.onUnitEnter.fire(this);
      for (const c of this._children) c.propagateEngine(engine);
    } else {
      // Leaving: descend first (bottom-up), then notify + unbind self. The top
      // unit is already unlinked, so `exitParent` carries the parent it left.
      for (const c of this._children) c.propagateEngine(null);
      this.onTreeExit(exitParent);
      this._engine?.onUnitExit.fire(this);
      this._engine = null;
    }
  }

  /**
   * Remove from the tree and destroy this unit and all descendants, bottom-up:
   * children are destroyed first, then this unit's `onDestroy` fires.
   */
  destroy(): void {
    if (this._destroyed) return;

    for (const c of this._children.slice()) c.destroy();

    if (this._parent) {
      this._parent.removeChild(this); // fires onTreeExit while still linked
    } else if (this._engine) {
      this.propagateEngine(null); // live root/unparented: unbind to fire exit
    }

    this._destroyed = true;
    this.onDestroy();
  }

  // ── Lifecycle hooks (override in subclasses) ─────────────────────────────

  /** Fires every time the unit enters the live tree. `parent` is the unit joined. */
  onTreeEnter(_parent: Unit | null): void {}

  /** Fires every time the unit leaves the live tree. `parent` is the unit left. */
  onTreeExit(_parent: Unit | null): void {}

  /** Fires once, when the unit is destroyed for good. */
  onDestroy(): void {}

  // ── Tick hooks (override in subclasses; driven by the Engine) ─────────────

  /** Fixed-step simulation logic. `dt` in seconds. */
  tick(_dt: number): void {}

  /** Variable-step, render-aligned logic. `dt` in seconds. */
  deviceTick(_dt: number): void {}
}
