import { describe, expect, it } from "vitest";
import { Camera } from "./camera.ts";
import { Unit } from "./unit.ts";
import { Engine } from "../engine/engine.ts";
import { Vector } from "../primitives/vector.ts";
import { mes } from "../scene/mes.ts";

const makeEngine = (): Engine =>
  new Engine({ autoStart: false, fixedStep: 0.1 });

const step = (e: Engine, n = 1): void => {
  for (let i = 0; i < n; i++) e.advanceFixed(e.fixedStep);
};

const cam = (extra: Partial<ConstructorParameters<typeof Camera>[0]> = {}) =>
  new Camera({ width: 16, height: 9, ...extra });

describe("camera activation", () => {
  it("claims the active slot on tree enter when none is active", () => {
    const engine = makeEngine();
    const a = cam();
    engine.root.addChild(a);
    expect(engine.activeCamera).toBe(a);
  });

  it("does not steal the slot unless marked active", () => {
    const engine = makeEngine();
    const a = cam();
    const b = cam();
    const c = cam({ active: true });
    engine.root.addChild(a);
    engine.root.addChild(b);
    expect(engine.activeCamera).toBe(a);
    engine.root.addChild(c);
    expect(engine.activeCamera).toBe(c);
  });

  it("releases the slot on tree exit", () => {
    const engine = makeEngine();
    const a = cam();
    engine.root.addChild(a);
    engine.root.removeChild(a);
    expect(engine.activeCamera).toBeNull();
  });

  it("hands off across changeScene without explicit wiring", () => {
    const engine = makeEngine();
    const a = cam();
    const b = cam();
    engine.changeScene(mes(Unit, {}, [a]));
    expect(engine.activeCamera).toBe(a);
    engine.changeScene(mes(Unit, {}, [b]));
    expect(engine.activeCamera).toBe(b);
  });
});

describe("camera offset", () => {
  it("displaces the view without touching position", () => {
    const c = cam({ position: new Vector(10, 20) });
    c.offset = new Vector(1, -2);
    expect(c.viewTransform.tx).toBe(11);
    expect(c.viewTransform.ty).toBe(18);
    expect(c.position.equals(new Vector(10, 20))).toBe(true);
  });

  it("publishes viewCenter$ when written, no engine step needed", () => {
    const c = cam();
    const seen: Vector[] = [];
    c.viewCenter$.addListener((v) => seen.push(v));
    c.offset = new Vector(3, 0);
    expect(seen.length).toBe(1);
    expect(seen[0]!.x).toBe(3);
  });
});

describe("camera limits", () => {
  it("keeps the view rectangle inside the bounds", () => {
    const c = cam({
      width: 10,
      height: 10,
      limits: { left: 0, top: 0, right: 100, bottom: 100 },
    });
    c.position = new Vector(0, 50); // view would spill past the left edge
    expect(c.viewTransform.tx).toBe(5); // clamped to left + width/2
    expect(c.viewTransform.ty).toBe(50);
    c.position = new Vector(200, 200);
    expect(c.viewTransform.tx).toBe(95);
    expect(c.viewTransform.ty).toBe(95);
  });

  it("supports partial limits and centers on spans narrower than the view", () => {
    const c = cam({ width: 10, height: 10, limits: { left: 0, right: 6 } });
    c.position = new Vector(-50, -50);
    expect(c.viewTransform.tx).toBe(3); // span narrower than view: center on it
    expect(c.viewTransform.ty).toBe(-50); // vertical is unbounded
  });

  it("ignores offset: shake can push past the bounds", () => {
    const c = cam({
      width: 10,
      height: 10,
      limits: { left: 0, right: 100, top: 0, bottom: 100 },
      position: new Vector(5, 5),
    });
    c.offset = new Vector(-3, 0);
    expect(c.viewCenter.x).toBe(2); // clamp happened before offset
  });
});

describe("camera smoothing", () => {
  it("approaches the camera position on the fixed clock and snaps when converged", () => {
    const engine = makeEngine();
    const c = cam({ smoothing: 5, position: Vector.zero });
    engine.root.addChild(c);
    step(engine); // seed the smoothed view at the current position
    c.position = new Vector(10, 0);
    step(engine);
    const first = c.viewCenter.x;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(10);
    step(engine);
    expect(c.viewCenter.x).toBeGreaterThan(first);
    step(engine, 200);
    expect(c.viewCenter.x).toBe(10); // snapped exactly, channel quiet
  });

  it("tracks instantly when smoothing is off", () => {
    const engine = makeEngine();
    const c = cam();
    engine.root.addChild(c);
    c.position = new Vector(7, 7);
    expect(c.viewTransform.tx).toBe(7); // no advance needed
  });

  it("snaps (never lerps in) when entering the tree", () => {
    const engine = makeEngine();
    const c = cam({ smoothing: 5, position: new Vector(100, 100) });
    engine.root.addChild(c);
    step(engine);
    expect(c.viewCenter.x).toBe(100);
  });
});
