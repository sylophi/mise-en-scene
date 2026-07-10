import { describe, expect, it } from "vitest";
import { Unit } from "./unit.ts";
import { Engine } from "../engine/engine.ts";

const makeEngine = (): Engine =>
  new Engine({ autoStart: false, fixedStep: 0.1 });

const step = (e: Engine, n = 1): void => {
  for (let i = 0; i < n; i++) e.advanceFixed(e.fixedStep);
};

class Ticker extends Unit {
  ticks = 0;
  deviceTicks = 0;
  override tick(): void {
    this.ticks++;
  }
  override deviceTick(): void {
    this.deviceTicks++;
  }
}

describe("Unit.ticking", () => {
  it("defaults to true and follows the x/x$ convention", () => {
    const u = new Ticker();
    expect(u.ticking).toBe(true);
    let seen: boolean | null = null;
    u.ticking$.addListener((v) => (seen = v));
    u.ticking = false;
    expect(seen).toBe(false);
  });

  it("skips tick and deviceTick while false, and resumes mid-flight", () => {
    const e = makeEngine();
    const u = new Ticker();
    e.root.addChild(u);
    step(e, 2);
    e.advanceDevice(0.016);
    expect(u.ticks).toBe(2);
    expect(u.deviceTicks).toBe(1);

    u.ticking = false;
    step(e, 5);
    e.advanceDevice(0.016);
    expect(u.ticks).toBe(2);
    expect(u.deviceTicks).toBe(1);

    u.ticking = true; // re-enable mid-flight
    step(e, 1);
    e.advanceDevice(0.016);
    expect(u.ticks).toBe(3);
    expect(u.deviceTicks).toBe(2);
  });

  it("is unit-only: children of a disabled unit keep ticking", () => {
    const e = makeEngine();
    const parent = new Ticker();
    const child = new Ticker();
    parent.addChild(child);
    e.root.addChild(parent);
    parent.ticking = false;
    step(e, 3);
    expect(parent.ticks).toBe(0);
    expect(child.ticks).toBe(3);
  });

  it("freezes timers mid-flight; the remainder elapses after re-enable", () => {
    const e = makeEngine();
    const u = new Unit();
    e.root.addChild(u);
    let fired = 0;
    u.after(0.2, () => fired++);
    step(e, 1); // 0.1 of 0.2 elapsed
    u.ticking = false;
    step(e, 20); // frozen
    expect(fired).toBe(0);
    u.ticking = true;
    step(e, 1); // the remaining 0.1 elapses
    expect(fired).toBe(1);
  });

  it("freezes every() and cooldowns while false", () => {
    const e = makeEngine();
    const u = new Unit();
    e.root.addChild(u);
    let fired = 0;
    u.every(0.1, () => fired++);
    const cd = u.cooldown(0.3);
    cd.start();
    step(e, 1);
    expect(fired).toBe(1);
    u.ticking = false;
    step(e, 10);
    expect(fired).toBe(1);
    expect(cd.remaining).toBeCloseTo(0.2);
    u.ticking = true;
    step(e, 2);
    expect(fired).toBe(3);
    expect(cd.ready).toBe(true);
  });

  it("does not affect lifecycle: enter/exit/destroy fire while disabled", () => {
    const e = makeEngine();
    const log: string[] = [];
    const u = new (class extends Unit {
      override onTreeEnter(): void {
        log.push("enter");
      }
      override onTreeExit(): void {
        log.push("exit");
      }
      override onDestroy(): void {
        log.push("destroy");
      }
    })();
    u.ticking = false;
    e.root.addChild(u);
    e.root.removeChild(u);
    e.root.addChild(u);
    u.destroy();
    expect(log).toEqual(["enter", "exit", "enter", "exit", "destroy"]);
    expect(u.isLive).toBe(false);
  });

  it("survives detach/reattach (the flag is unit state, not tree state)", () => {
    const e = makeEngine();
    const u = new Ticker();
    u.ticking = false;
    e.root.addChild(u);
    e.root.removeChild(u);
    e.root.addChild(u);
    step(e, 2);
    expect(u.ticks).toBe(0);
    expect(u.ticking).toBe(false);
  });
});
