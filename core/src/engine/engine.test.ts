import { describe, expect, it } from "vitest";
import { Engine } from "./engine.ts";
import { Unit } from "../unit/unit.ts";

class Ticker extends Unit {
  ticks = 0;
  lastDt = 0;
  override tick(dt: number): void {
    this.ticks++;
    this.lastDt = dt;
  }
}

class Named extends Unit {
  constructor(
    readonly name: string,
    readonly order: string[],
  ) {
    super();
  }
  override tick(): void {
    this.order.push(this.name);
  }
}

describe("Engine fixed-step loop", () => {
  it("runs whole steps from the accumulator and advances time", () => {
    const e = new Engine({ autoStart: false, fixedStep: 0.1 });
    const t = new Ticker();
    e.root.addChild(t);
    e.advanceFixed(0.25); // 2 whole steps, 0.05 remainder
    expect(t.ticks).toBe(2);
    expect(t.lastDt).toBeCloseTo(0.1);
    expect(e.time).toBeCloseTo(0.2);
    e.advanceFixed(0.06); // remainder (~0.05) + 0.06 crosses 0.1 -> 1 more step
    expect(t.ticks).toBe(3);
  });

  it("caps catch-up to avoid the spiral of death and drops the backlog", () => {
    const e = new Engine({ autoStart: false, fixedStep: 0.1, maxCatchUp: 5 });
    const t = new Ticker();
    e.root.addChild(t);
    e.advanceFixed(10); // would be 100 steps; capped at 5
    expect(t.ticks).toBe(5);
    e.advanceFixed(0.1); // backlog was dropped, so this is a fresh single step
    expect(t.ticks).toBe(6);
  });

  it("walks the tree depth-first, top-down", () => {
    const e = new Engine({ autoStart: false, fixedStep: 0.1 });
    const order: string[] = [];
    const a = new Named("a", order);
    const b = new Named("b", order);
    const c = new Named("c", order);
    a.addChild(b);
    a.addChild(c);
    e.root.addChild(a);
    e.advanceFixed(0.1);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("deviceTick passes the raw variable dt", () => {
    const e = new Engine({ autoStart: false });
    class DeviceTicker extends Unit {
      dt = 0;
      override deviceTick(dt: number): void {
        this.dt = dt;
      }
    }
    const d = new DeviceTicker();
    e.root.addChild(d);
    e.advanceDevice(0.016);
    expect(d.dt).toBeCloseTo(0.016);
  });
});

describe("Engine.changeScene", () => {
  it("destroys the previous scene by default and mounts the new one", () => {
    const e = new Engine({ autoStart: false });
    const sceneA = new Unit();
    const sceneB = new Unit();
    e.changeScene(sceneA);
    expect(e.root.children).toEqual([sceneA]);
    e.changeScene(sceneB);
    expect(e.root.children).toEqual([sceneB]);
    expect(sceneA.destroyed).toBe(true);
  });

  it("can detach the previous scene for reuse", () => {
    const e = new Engine({ autoStart: false });
    const sceneA = new Unit();
    const sceneB = new Unit();
    e.changeScene(sceneA);
    e.changeScene(sceneB, { destroyPrevious: false });
    expect(sceneA.destroyed).toBe(false);
    expect(sceneA.engine).toBeNull();
  });
});
