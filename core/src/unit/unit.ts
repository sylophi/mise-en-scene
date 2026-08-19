import { ObservableEvent, type Unsub } from "../primitives/observable-event.ts";
import { Cooldown } from "./cooldown.ts";
import type { Engine } from "../engine/engine.ts";

export interface UnitProps {
  /** Stable id. Auto-generated if omitted. */
  id?: string;
}

/** Anything observable: `ObservableValue`, `ObservableEvent`, or compatible. */
interface ObservableLike<T> {
  addListener(cb: (value: T) => void): Unsub;
}

/** A scheduled callback created by `after`/`every`. */
interface ScheduledTimer {
  remaining: number;
  /** Repeat period in seconds; null for one-shots. */
  interval: number | null;
  cb: () => void;
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
export class Unit<P extends UnitProps = UnitProps> {
  readonly id: string;

  /**
   * The constructor props, retained verbatim. Subclasses that only pass values
   * through to their views can read these instead of copying fields:
   * `class Billboard extends Renderable<BillboardProps>` makes
   * `this.props.title` fully typed with no constructor at all.
   */
  protected readonly props: P;

  private _parent: Unit | null = null;
  // Allocated lazily: most units (bullets, timers, spawners) never have a
  // structural observer, and units are a per-frame spawn hot path.
  private _onParentChanged: ObservableEvent<Unit | null> | null = null;
  private _onDestroyed: ObservableEvent<void> | null = null;
  private _observations: Unsub[] | null = null;
  private _schedule: ScheduledTimer[] | null = null;
  private _cooldowns: Cooldown[] | null = null;
  private readonly _children: Unit[] = [];
  protected _engine: Engine | null = null;
  private _destroyed = false;
  // True while this unit's exit propagation is in flight. `_engine` must stay
  // readable inside `onTreeExit` (hooks deregister via `this.engine`), so it
  // cannot double as the reentrancy guard for exit.
  private _exiting = false;

  constructor(props?: NoInfer<P>) {
    this.props = props ?? ({} as P);
    this.id = this.props.id ?? `unit-${nextId++}`;
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

  /**
   * Fires once, after the unit is destroyed (children already destroyed,
   * `onDestroy` already run). The hook for external cleanup tied to this
   * unit's lifetime, e.g. `unit.onDestroyed.addListener(() => gsap.killTweensOf(unit))`.
   */
  get onDestroyed(): ObservableEvent<void> {
    return (this._onDestroyed ??= new ObservableEvent());
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
   * The nearest ancestor that is an instance of `Ctor`, or null. The idiom for
   * units that cooperate with a containing system, e.g. a physics body finding
   * its `PhysicsWorld2D` on tree enter.
   */
  findAncestor<T extends Unit>(
    Ctor: abstract new (...args: never[]) => T,
  ): T | null {
    for (let u = this._parent; u; u = u._parent) {
      if (u instanceof Ctor) return u;
    }
    return null;
  }

  /**
   * Attach `child` under this unit. Reparents if `child` already has a parent.
   * Engine binding propagates into the child subtree, which may fire
   * `onTreeEnter`/`onTreeExit` as it enters or leaves the live tree.
   */
  addChild(child: Unit): void {
    if (this._destroyed) throw new Error("cannot add to a destroyed unit");
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
    const prevParent = child._parent;
    const isMove =
      prevParent !== null && engine !== null && child._engine === engine;
    if (prevParent) prevParent._unlink(child);

    child._parent = this;
    this._children.push(child);
    // `prevParent` matters when a live child moves under a detached parent:
    // that path exits the tree, and onTreeExit must report the parent left.
    child.propagateEngine(this._engine, prevParent);
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
      // The hook may destroy or detach this unit; an unbound unit is no
      // longer entering, so don't announce it or descend.
      if (this._engine !== engine) return;
      engine.onUnitEnter.fire(this);
      if (this._engine !== engine) return; // a listener may do the same
      // Snapshot: hooks may mutate the children array mid-propagation. A
      // child that an earlier sibling's hook destroyed or reparented away
      // no longer enters with this subtree.
      for (const c of this._children.slice()) {
        if (c._parent === this) c.propagateEngine(engine);
      }
    } else {
      // Leaving: descend first (bottom-up), then notify + unbind self. The top
      // unit is already unlinked, so `exitParent` carries the parent it left.
      // A hook below may destroy/remove this very unit (which re-enters here
      // via removeChild); that inner call must not fire exit a second time.
      if (this._exiting) return;
      this._exiting = true;
      // Snapshot + membership check, as on enter: a hook may destroy a later
      // sibling (it exits itself via removeChild) or reparent it elsewhere in
      // the live tree (it must not exit at all).
      for (const c of this._children.slice()) {
        if (c._parent === this) c.propagateEngine(null);
      }
      this.onTreeExit(exitParent);
      this._engine?.onUnitExit.fire(this);
      this._engine = null;
      this._exiting = false;
    }
  }

  /**
   * Remove from the tree and destroy this unit and all descendants, bottom-up:
   * children are destroyed first, then this unit's `onDestroy` fires. All
   * subscriptions made via `observeUntilDestroyed` and all pending timers are
   * disposed.
   */
  destroy(): void {
    if (this._destroyed) return;
    // Mark first: a reentrant destroy from an exit hook below is a no-op.
    this._destroyed = true;

    for (const c of this._children.slice()) c.destroy();

    if (this._parent) {
      this._parent.removeChild(this); // fires onTreeExit while still linked
    } else if (this._engine) {
      this.propagateEngine(null); // live root/unparented: unbind to fire exit
    }

    this.onDestroy();
    this._onDestroyed?.fire();
    this._onDestroyed = null;
    if (this._observations) {
      for (const unsub of this._observations) unsub();
      this._observations = null;
    }
    this._schedule = null;
    this._cooldowns = null;
  }

  // ── Lifetime-scoped subscriptions ─────────────────────────────────────────

  /**
   * Subscribe to `observable` for this unit's lifetime: the subscription is
   * disposed automatically on `destroy`. Mirrors Godot, where freeing a node
   * severs its signal connections; removing the unit from the tree does *not*
   * unsubscribe (callbacks can fire while off-tree, where `engine` is null).
   *
   * Returns the unsubscribe function for early opt-out.
   */
  observeUntilDestroyed<T>(
    observable: ObservableLike<T>,
    cb: (value: T) => void,
  ): Unsub {
    if (this._destroyed) {
      throw new Error("cannot observe from a destroyed unit");
    }
    const unsub = observable.addListener(cb);
    (this._observations ??= []).push(unsub);
    return unsub;
  }

  // ── Timers (advance on the fixed tick; engine-driven) ─────────────────────

  /**
   * Run `cb` once after `delay` seconds of fixed-tick time. Frozen while the
   * unit is off-tree (timers advance only when the unit ticks); cancelled by
   * `destroy`. Returns a cancel function.
   */
  after(delay: number, cb: () => void): Unsub {
    return this._addTimer(delay, null, cb);
  }

  /**
   * Run `cb` every `interval` seconds of fixed-tick time, first fire after one
   * full interval. Frozen while the unit is off-tree; cancelled by `destroy`.
   * Returns a cancel function.
   */
  every(interval: number, cb: () => void): Unsub {
    if (!(interval > 0)) throw new Error("every() needs a positive interval");
    return this._addTimer(interval, interval, cb);
  }

  /**
   * Create a {@link Cooldown} advanced on this unit's fixed-tick clock.
   * `cooldown.ready` / `cooldown.start()` replace the hand-rolled
   * `cd -= dt; if (cd <= 0) ...` pattern.
   */
  cooldown(duration?: number): Cooldown {
    if (this._destroyed) {
      throw new Error("cannot create a cooldown on a destroyed unit");
    }
    const cd = new Cooldown(duration);
    (this._cooldowns ??= []).push(cd);
    return cd;
  }

  private _addTimer(
    delay: number,
    interval: number | null,
    cb: () => void,
  ): Unsub {
    if (this._destroyed) {
      throw new Error("cannot schedule a timer on a destroyed unit");
    }
    if (!(delay >= 0)) throw new Error("timer delay must be >= 0");
    const timer: ScheduledTimer = { remaining: delay, interval, cb };
    (this._schedule ??= []).push(timer);
    return () => {
      this._removeTimer(timer);
    };
  }

  private _removeTimer(timer: ScheduledTimer): void {
    if (!this._schedule) return;
    const i = this._schedule.indexOf(timer);
    if (i >= 0) this._schedule.splice(i, 1);
  }

  /** Advance timers and cooldowns by `dt`. Called by the engine; not game API. */
  advanceTimers(dt: number): void {
    if (this._cooldowns) {
      for (const cd of this._cooldowns) cd.advance(dt);
    }
    if (!this._schedule || this._schedule.length === 0) return;
    // Snapshot: callbacks may schedule or cancel timers (or destroy the unit).
    for (const timer of this._schedule.slice()) {
      if (!this._schedule?.includes(timer)) continue; // cancelled mid-step
      timer.remaining -= dt;
      if (timer.remaining > 0) continue;
      if (timer.interval === null) {
        this._removeTimer(timer); // remove first: cb may reschedule
        timer.cb();
      } else {
        // Catch up if dt overshot multiple periods; stop if cancelled/destroyed.
        let active = true;
        while (timer.remaining <= 0 && active) {
          timer.remaining += timer.interval;
          timer.cb();
          active = this._schedule?.includes(timer) ?? false;
        }
      }
    }
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
