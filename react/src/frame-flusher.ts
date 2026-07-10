import { useContext } from "react";
import type { Engine } from "@mise/core";
import { EngineContext } from "./context.ts";

/**
 * Per-engine notification batcher: the renderer's store subscriptions push
 * their React `onStoreChange` callbacks here instead of calling them per
 * change, and the whole set is flushed once per device tick (after the frame's
 * `deviceTick` walk, via `engine.onDeviceTick`). N transform writes across a
 * frame's fixed ticks become one React render pass instead of N.
 *
 * Only React work is coalesced: `ObservableValue` listeners in game code still
 * fire synchronously per change. Callbacks are deduped by identity, so a unit
 * changed five times in a frame re-renders once, with the final state (the
 * flush notifies; React then reads current snapshots — nothing is lost).
 */
export class FrameFlusher {
  /** Pending notifications, deduped: one re-render per subscriber per flush. */
  private readonly pending = new Set<() => void>();
  private microtaskArmed = false;

  constructor(private readonly engine: Engine) {
    // Never unsubscribed: the flusher lives exactly as long as its engine.
    engine.onDeviceTick.addListener(() => this.flush());
  }

  /**
   * Defer `notify` to the next flush. While the device loop runs, that is the
   * end of the next device tick; otherwise (stopped engine, no rAF: nothing
   * will ever tick) fall back to a microtask so external writes — tests, event
   * handlers on a paused game — still reach React, coalesced per task.
   */
  enqueue(notify: () => void): void {
    this.pending.add(notify);
    if (this.deviceLoopDriven || this.microtaskArmed) return;
    this.microtaskArmed = true;
    queueMicrotask(() => {
      this.microtaskArmed = false;
      // The loop may have started since; its device tick owns the flush then.
      if (!this.deviceLoopDriven) this.flush();
    });
  }

  /** Drop a pending notification (its subscriber unmounted before the flush). */
  cancel(notify: () => void): void {
    this.pending.delete(notify);
  }

  /** Notify everything pending, once each. Idempotent; empty flushes are free. */
  flush(): void {
    if (this.pending.size === 0) return;
    // Snapshot: a notified component may re-subscribe/enqueue during the flush.
    const batch = Array.from(this.pending);
    this.pending.clear();
    // One synchronous burst: React 18+ batches these into a single render pass.
    for (const notify of batch) notify();
  }

  private get deviceLoopDriven(): boolean {
    return (
      this.engine.running &&
      typeof globalThis.requestAnimationFrame === "function"
    );
  }
}

const flushers = new WeakMap<Engine, FrameFlusher>();

/** The flusher for `engine`, created lazily. One per engine, engine-lifetime. */
export function flusherFor(engine: Engine): FrameFlusher {
  let flusher = flushers.get(engine);
  if (!flusher) {
    flusher = new FrameFlusher(engine);
    flushers.set(engine, flusher);
  }
  return flusher;
}

/**
 * The current provider's flusher, or null outside a `<MiseProvider>` (where
 * subscriptions fall back to immediate, per-change notification).
 */
export function useFlusher(): FrameFlusher | null {
  const engine = useContext(EngineContext);
  return engine ? flusherFor(engine) : null;
}
