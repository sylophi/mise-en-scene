import { describe, expect, it } from "vitest";
import { Unit } from "./unit.ts";
import { Engine } from "../engine/engine.ts";

// fixedStep 0.1 keeps the arithmetic exact-ish and the step counts readable.
const makeEngine = (): Engine =>
  new Engine({ autoStart: false, fixedStep: 0.1 });

const step = (e: Engine, n = 1): void => {
  for (let i = 0; i < n; i++) e.advanceFixed(e.fixedStep);
};

/** Ticks without calling super: timers must still advance (engine-driven). */
class Rebel extends Unit {
  ticks = 0;
  override tick(): void {
    this.ticks++;
  }
}

describe("after", () => {
  it("fires once after the delay, on the fixed clock", () => {
    const engine = makeEngine();
    const u = new Rebel();
    engine.root.addChild(u);
    let fired = 0;
    u.after(0.3, () => fired++);
    step(engine, 2);
    expect(fired).toBe(0);
    step(engine, 1);
    expect(fired).toBe(1);
    step(engine, 5);
    expect(fired).toBe(1); // one-shot
    expect(u.ticks).toBe(8); // tick override ran; timers were unaffected
  });

  it("is cancellable", () => {
    const engine = makeEngine();
    const u = new Unit();
    engine.root.addChild(u);
    let fired = 0;
    const cancel = u.after(0.2, () => fired++);
    step(engine, 1);
    cancel();
    step(engine, 5);
    expect(fired).toBe(0);
  });

  it("freezes while the unit is off-tree", () => {
    const engine = makeEngine();
    const u = new Unit();
    engine.root.addChild(u);
    let fired = 0;
    u.after(0.2, () => fired++);
    step(engine, 1); // 0.1 elapsed
    engine.root.removeChild(u);
    step(engine, 10); // frozen
    expect(fired).toBe(0);
    engine.root.addChild(u);
    step(engine, 1); // remaining 0.1 elapses
    expect(fired).toBe(1);
  });

  it("is cancelled by destroy, even from inside another timer", () => {
    const engine = makeEngine();
    const u = new Unit();
    engine.root.addChild(u);
    let fired = 0;
    u.after(0.1, () => u.destroy());
    u.after(0.1, () => fired++); // same step; must not fire after destroy
    step(engine, 3);
    expect(fired).toBe(0);
    expect(u.destroyed).toBe(true);
  });

  it("throws on a destroyed unit and rejects negative delays", () => {
    const u = new Unit();
    expect(() => u.after(-1, () => {})).toThrow(/>= 0/);
    u.destroy();
    expect(() => u.after(0.1, () => {})).toThrow(/destroyed/);
  });
});

describe("every", () => {
  it("fires each interval, first after one full interval", () => {
    const engine = makeEngine();
    const u = new Unit();
    engine.root.addChild(u);
    let fired = 0;
    u.every(0.2, () => fired++);
    step(engine, 1);
    expect(fired).toBe(0);
    step(engine, 1);
    expect(fired).toBe(1);
    step(engine, 4);
    expect(fired).toBe(3);
  });

  it("is cancellable and rejects non-positive intervals", () => {
    const engine = makeEngine();
    const u = new Unit();
    engine.root.addChild(u);
    let fired = 0;
    const cancel = u.every(0.1, () => fired++);
    step(engine, 2);
    cancel();
    step(engine, 5);
    expect(fired).toBe(2);
    expect(() => u.every(0, () => {})).toThrow(/positive/);
  });
});

describe("cooldown", () => {
  it("starts ready, gates while running, advances on the fixed clock", () => {
    const engine = makeEngine();
    const u = new Rebel();
    engine.root.addChild(u);
    const cd = u.cooldown(0.25);
    expect(cd.ready).toBe(true);
    cd.start();
    expect(cd.ready).toBe(false);
    expect(cd.remaining).toBeCloseTo(0.25, 10);
    step(engine, 2);
    expect(cd.ready).toBe(false);
    step(engine, 1);
    expect(cd.ready).toBe(true);
    expect(cd.remaining).toBe(0);
  });

  it("supports one-off durations and reset", () => {
    const engine = makeEngine();
    const u = new Unit();
    engine.root.addChild(u);
    const cd = u.cooldown(1);
    cd.start(0.1);
    step(engine, 1);
    expect(cd.ready).toBe(true);
    cd.start(); // back to the default duration
    expect(cd.ready).toBe(false);
    cd.reset();
    expect(cd.ready).toBe(true);
  });
});
