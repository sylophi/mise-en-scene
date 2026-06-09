import { ObservableEvent } from "../primitives/observable-event.ts";
import { ObservableValue } from "../primitives/observable-value.ts";
import { Input } from "../input/input.ts";
import { Unit } from "../unit/unit.ts";
import { Root } from "../unit/root.ts";
import type { Camera } from "../unit/camera.ts";

export interface EngineOptions {
  /** Fixed simulation step in seconds. Default 1/60. */
  fixedStep?: number;
  /** Max fixed steps run in one catch-up, to avoid the spiral of death. Default 5. */
  maxCatchUp?: number;
  /**
   * Max device-tick `dt` in seconds. Longer real gaps (e.g. resuming a hidden
   * tab, where rAF was paused) are clamped to this. Default 0.1.
   */
  maxDeviceDt?: number;
  /** Start the loops on construction. Default true. */
  autoStart?: boolean;
}

const now = (): number => performance.now();

/**
 * Owns the root unit and drives the simulation. Two loops:
 *
 * - `tick` — fixed-step (default 60Hz) via `setInterval`, real-time corrected with
 *   an accumulator and a catch-up cap. The canonical simulation clock.
 * - `deviceTick` — variable-step via `requestAnimationFrame` (when available),
 *   at the device refresh rate.
 *
 * Both walk the live tree depth-first, top-down, every cycle.
 */
export class Engine {
  readonly root: Root;
  readonly input = new Input();
  readonly activeCamera = new ObservableValue<Camera | null>(null);

  /** Fires when a unit enters the live tree (top-down). For retained renderers. */
  readonly onUnitEnter = new ObservableEvent<Unit>();
  /** Fires when a unit leaves the live tree (bottom-up). For retained renderers. */
  readonly onUnitExit = new ObservableEvent<Unit>();
  /**
   * Fires when a unit moves within the live tree (same-engine reparent), which
   * fires no enter/exit. The moved unit may be an invisible ancestor whose
   * whole subtree shifted with it; retained renderers refresh draw order here.
   */
  readonly onUnitMoved = new ObservableEvent<Unit>();

  readonly fixedStep: number;
  readonly maxCatchUp: number;
  readonly maxDeviceDt: number;

  private accumulator = 0;
  private _time = 0;
  private _running = false;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private rafId: number | null = null;
  private lastFixed = 0;
  private lastDevice = 0;
  private scene: Unit | null = null;

  constructor(options: EngineOptions = {}) {
    this.fixedStep = options.fixedStep ?? 1 / 60;
    this.maxCatchUp = options.maxCatchUp ?? 5;
    this.maxDeviceDt = options.maxDeviceDt ?? 0.1;

    this.root = new Root();
    this.root.setEngine(this);

    if (options.autoStart ?? true) this.start();
  }

  /** Total simulated time in seconds (advances in fixed steps). */
  get time(): number {
    return this._time;
  }

  get running(): boolean {
    return this._running;
  }

  // ── Scene mounting ────────────────────────────────────────────────────────

  /**
   * Swap the current scene under the root. By default the previous scene is
   * destroyed; pass `destroyPrevious: false` to detach it for reuse instead.
   *
   * Only manages scenes mounted through this method: units added directly under
   * the root (persistent managers, cameras) are left alone, and a previous scene
   * that was already detached or destroyed externally is not touched.
   */
  changeScene(unit: Unit, opts: { destroyPrevious?: boolean } = {}): void {
    const destroyPrevious = opts.destroyPrevious ?? true;
    const prev = this.scene;
    if (prev && prev.parent === this.root) {
      if (destroyPrevious) prev.destroy();
      else this.root.removeChild(prev);
    }
    this.scene = unit;
    this.root.addChild(unit);
  }

  // ── Loop control ──────────────────────────────────────────────────────────

  start(): void {
    if (this._running) return;
    this._running = true;

    this.lastFixed = now();
    this.intervalId = setInterval(() => {
      const t = now();
      this.advanceFixed((t - this.lastFixed) / 1000);
      this.lastFixed = t;
    }, this.fixedStep * 1000);

    const raf = globalThis.requestAnimationFrame;
    if (typeof raf === "function") {
      this.lastDevice = now();
      const loop = (t: number) => {
        if (!this._running) return;
        this.advanceDevice((t - this.lastDevice) / 1000);
        this.lastDevice = t;
        this.rafId = raf(loop);
      };
      this.rafId = raf(loop);
    }
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (
      this.rafId !== null &&
      typeof globalThis.cancelAnimationFrame === "function"
    ) {
      globalThis.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // ── Stepping (also callable manually for headless/testing) ────────────────

  /** Feed `realDt` seconds into the fixed-step accumulator and run due ticks. */
  advanceFixed(realDt: number): void {
    this.accumulator += realDt;
    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.maxCatchUp) {
      this.walk((u, dt) => u.tick(dt), this.fixedStep);
      this.input.advanceTick();
      this._time += this.fixedStep;
      this.accumulator -= this.fixedStep;
      steps++;
    }
    // Hit the catch-up cap with time to spare: drop the backlog (spiral guard).
    if (steps >= this.maxCatchUp && this.accumulator > this.fixedStep) {
      this.accumulator = 0;
    }
  }

  /**
   * Run one variable-step device tick over the tree. `realDt` is clamped to
   * `maxDeviceDt` so a long rAF gap (hidden tab) doesn't produce a giant step.
   */
  advanceDevice(realDt: number): void {
    this.walk((u, dt) => u.deviceTick(dt), Math.min(realDt, this.maxDeviceDt));
  }

  /** Depth-first, top-down walk of the live tree. */
  private walk(fn: (unit: Unit, dt: number) => void, dt: number): void {
    const visit = (u: Unit): void => {
      fn(u, dt);
      // snapshot: a tick may add/remove children mid-walk
      for (const c of u.children.slice()) visit(c);
    };
    visit(this.root);
  }
}
