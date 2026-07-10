import { describe, expect, it } from "vitest";
import { Engine } from "./engine.ts";
import { Unit } from "../unit/unit.ts";
import { Camera } from "../unit/camera.ts";
import { Vector } from "../primitives/vector.ts";

class Ticker extends Unit {
  ticks = 0;
  lastDt = 0;
  override tick(dt: number): void {
    this.ticks++;
    this.lastDt = dt;
  }
}

class DeviceTicker extends Unit {
  ticks = 0;
  dt = 0;
  override deviceTick(dt: number): void {
    this.ticks++;
    this.dt = dt;
  }
}

// fixedStep 0.25 and scales 0.5/2 keep the accumulator arithmetic exact in
// binary floating point, so step counts are deterministic.
const makeEngine = (): Engine =>
  new Engine({ autoStart: false, fixedStep: 0.25 });

describe("Engine.timeScale", () => {
  it("defaults to 1 and follows the x/x$ convention", () => {
    const e = makeEngine();
    expect(e.timeScale).toBe(1);
    let seen = -1;
    e.timeScale$.addListener((v) => (seen = v));
    e.timeScale = 0.5;
    expect(seen).toBe(0.5);
  });

  it("rejects negative and non-finite values", () => {
    const e = makeEngine();
    expect(() => (e.timeScale = -1)).toThrow(/>= 0/);
    expect(() => (e.timeScale = NaN)).toThrow(/finite/);
    expect(() => (e.timeScale = Infinity)).toThrow(/finite/);
    expect(e.timeScale).toBe(1); // unchanged after the throws
  });

  it("at 0.5 thins steps out: fixed dt is unchanged, step count halves", () => {
    const e = makeEngine();
    const t = new Ticker();
    e.root.addChild(t);
    e.timeScale = 0.5;
    e.advanceFixed(1); // 0.5s of game time = 2 steps of 0.25
    expect(t.ticks).toBe(2);
    expect(t.lastDt).toBe(0.25); // dt is never scaled
    expect(e.time).toBeCloseTo(0.5);
  });

  it("keeps the scaled remainder across calls", () => {
    const e = makeEngine();
    const t = new Ticker();
    e.root.addChild(t);
    e.timeScale = 0.5;
    e.advanceFixed(0.25); // 0.125 accrued: no step yet
    expect(t.ticks).toBe(0);
    e.advanceFixed(0.25); // 0.25 accrued: one step
    expect(t.ticks).toBe(1);
  });

  it("at 2 runs steps at double rate (still capped by maxCatchUp)", () => {
    const e = makeEngine();
    const t = new Ticker();
    e.root.addChild(t);
    e.timeScale = 2;
    e.advanceFixed(0.5); // 1s of game time = 4 steps
    expect(t.ticks).toBe(4);
    expect(e.time).toBeCloseTo(1);
    e.advanceFixed(10); // would be 80 steps; capped at the default 5, backlog dropped
    expect(t.ticks).toBe(9);
  });
});

describe("pause (timeScale 0)", () => {
  it("halts tick and time entirely", () => {
    const e = makeEngine();
    const t = new Ticker();
    e.root.addChild(t);
    e.advanceFixed(0.25);
    e.timeScale = 0;
    e.advanceFixed(3);
    expect(t.ticks).toBe(1);
    expect(e.time).toBeCloseTo(0.25);
  });

  it("resumes without a catch-up burst: paused real time leaves no backlog", () => {
    const e = makeEngine();
    const t = new Ticker();
    e.root.addChild(t);
    e.timeScale = 0;
    // 10 real seconds pass while paused (many loop iterations).
    for (let i = 0; i < 40; i++) e.advanceFixed(0.25);
    expect(t.ticks).toBe(0);
    e.timeScale = 1;
    e.advanceFixed(0.25); // exactly one fresh step, not maxCatchUp of them
    expect(t.ticks).toBe(1);
  });

  it("freezes engine timers and cooldowns, which resume where they left off", () => {
    const e = makeEngine();
    const u = new Unit();
    e.root.addChild(u);
    let fired = 0;
    u.after(0.5, () => fired++);
    const cd = u.cooldown(0.5);
    cd.start();
    e.advanceFixed(0.25); // halfway
    e.timeScale = 0;
    e.advanceFixed(60);
    expect(fired).toBe(0);
    expect(cd.ready).toBe(false);
    expect(cd.remaining).toBeCloseTo(0.25);
    e.timeScale = 1;
    e.advanceFixed(0.25); // the remaining half elapses
    expect(fired).toBe(1);
    expect(cd.ready).toBe(true);
  });

  it("freezes camera smoothing, which resumes on unpause", () => {
    const e = makeEngine();
    const cam = new Camera({ width: 100, height: 50, smoothing: 2 });
    e.root.addChild(cam);
    e.advanceFixed(0.25); // seed the smoothed view at the origin
    cam.position = new Vector(80, 0);
    e.timeScale = 0;
    e.advanceFixed(5);
    expect(cam.viewCenter.x).toBe(0); // never advanced toward the target
    e.timeScale = 1;
    e.advanceFixed(0.25);
    expect(cam.viewCenter.x).toBeGreaterThan(0);
    expect(cam.viewCenter.x).toBeLessThan(80);
  });

  it("keeps deviceTick running on real (unscaled) dt", () => {
    const e = makeEngine();
    const d = new DeviceTicker();
    e.root.addChild(d);
    e.timeScale = 0;
    e.advanceDevice(0.016);
    e.advanceDevice(0.016);
    expect(d.ticks).toBe(2);
    expect(d.dt).toBeCloseTo(0.016); // real dt, not scaled to 0
  });
});

describe("Engine.paused", () => {
  it("reflects timeScale === 0", () => {
    const e = makeEngine();
    expect(e.paused).toBe(false);
    e.timeScale = 0;
    expect(e.paused).toBe(true);
  });

  it("round-trips through the scale it paused at", () => {
    const e = makeEngine();
    e.timeScale = 0.5; // bullet time...
    e.paused = true; // ...then the pause menu opens
    expect(e.timeScale).toBe(0);
    e.paused = false;
    expect(e.timeScale).toBe(0.5); // back to bullet time, not full speed
  });

  it("restores 1 when paused via timeScale = 0 directly", () => {
    const e = makeEngine();
    e.timeScale = 0;
    e.paused = false;
    expect(e.timeScale).toBe(1);
  });

  it("is idempotent: re-pausing does not clobber the remembered scale", () => {
    const e = makeEngine();
    e.timeScale = 0.5;
    e.paused = true;
    e.paused = true; // no-op, must not remember 0
    e.paused = false;
    expect(e.timeScale).toBe(0.5);
  });
});
