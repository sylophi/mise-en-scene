import { describe, expect, it } from "vitest";
import { channel, observable } from "./observable.ts";
import { ObservableValue, structuralEquals } from "./observable-value.ts";
import { Vector } from "./vector.ts";

class Player {
  @observable accessor hp = 100;
  @observable accessor name = "hero";
  @observable({ equals: structuralEquals }) accessor pos = Vector.zero;

  // The decorator defines these at runtime; declare them for typed access.
  declare readonly hp$: ObservableValue<number>;
  declare readonly pos$: ObservableValue<Vector>;
}

describe("@observable accessor", () => {
  it("exposes a working accessor with the initial value", () => {
    const p = new Player();
    expect(p.hp).toBe(100);
    p.hp = 42;
    expect(p.hp).toBe(42);
    p.hp += 8; // compound assignment through get+set
    expect(p.hp).toBe(50);
  });

  it("defines the $ channel on the instance, seeded with the initial value", () => {
    const p = new Player();
    expect(p.hp$).toBeInstanceOf(ObservableValue);
    expect(p.hp$.get()).toBe(100);
    expect((p as unknown as Record<string, unknown>)["name$"]).toBeInstanceOf(
      ObservableValue,
    );
  });

  it("keeps accessor and channel in lockstep, both directions", () => {
    const p = new Player();
    const seen: number[] = [];
    p.hp$.addListener((v) => seen.push(v));
    p.hp = 75; // accessor write fires the channel
    p.hp$.set(50); // channel write is visible through the accessor
    expect(seen).toEqual([75, 50]);
    expect(p.hp).toBe(50);
  });

  it("does not fire on a === no-op set", () => {
    const p = new Player();
    let count = 0;
    p.hp$.addListener(() => count++);
    p.hp = 100;
    expect(count).toBe(0);
  });

  it("keeps multiple fields independent", () => {
    const p = new Player();
    let hpFired = 0;
    let nameFired = 0;
    p.hp$.addListener(() => hpFired++);
    channel(p, "name").addListener(() => nameFired++);
    p.hp = 1;
    expect(hpFired).toBe(1);
    expect(nameFired).toBe(0);
    p.name = "villain";
    expect(nameFired).toBe(1);
    expect(hpFired).toBe(1);
  });

  it("keeps instances independent", () => {
    const a = new Player();
    const b = new Player();
    expect(a.hp$).not.toBe(b.hp$);
    let bFired = 0;
    b.hp$.addListener(() => bFired++);
    a.hp = 1;
    expect(a.hp).toBe(1);
    expect(b.hp).toBe(100);
    expect(bFired).toBe(0);
  });

  it("threads options into the channel (structural equality)", () => {
    const p = new Player();
    let count = 0;
    p.pos$.addListener(() => count++);
    p.pos = new Vector(0, 0); // fresh but structurally equal: suppressed
    expect(count).toBe(0);
    p.pos = new Vector(3, 4);
    expect(count).toBe(1);
    p.pos = new Vector(3, 4); // equal again
    expect(count).toBe(1);
    expect(p.pos).toEqual(new Vector(3, 4));
  });

  it("makes the channel read-only on the instance", () => {
    const p = new Player();
    expect(() => {
      (p as unknown as Record<string, unknown>)["hp$"] = null;
    }).toThrow(TypeError);
  });

  it("keeps the accessor pair on the prototype (tween-library protocol)", () => {
    // gsap.to(unit, { hp: 0 }) walks the prototype chain for a setter.
    const desc = Object.getOwnPropertyDescriptor(Player.prototype, "hp");
    expect(typeof desc?.get).toBe("function");
    expect(typeof desc?.set).toBe("function");
  });

  it("seeds per instance, so constructor props can override the initializer", () => {
    class Enemy {
      @observable accessor hp = 10;
      declare readonly hp$: ObservableValue<number>;
      constructor(hp?: number) {
        if (hp !== undefined) this.hp = hp;
      }
    }
    expect(new Enemy().hp).toBe(10);
    expect(new Enemy(3).hp$.get()).toBe(3);
  });

  it("works in subclasses of a decorated class", () => {
    class Boss extends Player {
      @observable accessor rage = 0;
      declare readonly rage$: ObservableValue<number>;
    }
    const b = new Boss();
    const seen: number[] = [];
    b.rage$.addListener((v) => seen.push(v));
    b.hp = 7;
    b.rage = 1;
    expect(b.hp$.get()).toBe(7);
    expect(seen).toEqual([1]);
  });

  it("rejects static and private accessors", () => {
    expect(() => {
      class Bad {
        @observable static accessor n = 0;
        alive = true; // appease no-extraneous-class; the decorator throws first
      }
      void Bad;
    }).toThrow(/public, string-named instance accessor/);
    expect(() => {
      class Bad {
        @observable accessor #n = 0;
        unused(): number {
          return this.#n;
        }
      }
      void Bad;
    }).toThrow(/public, string-named instance accessor/);
  });
});

describe("channel()", () => {
  it("returns the typed channel behind a decorated accessor", () => {
    const p = new Player();
    const hp = channel(p, "hp"); // ObservableValue<number>
    expect(hp).toBe(p.hp$);
    const seen: number[] = [];
    hp.addListener((v) => seen.push(v));
    p.hp = 9;
    expect(seen).toEqual([9]);
  });

  it("finds manual trio channels too (same naming convention)", () => {
    class Manual {
      readonly hp$ = new ObservableValue(5);
      get hp(): number {
        return this.hp$.get();
      }
      set hp(v: number) {
        this.hp$.set(v);
      }
    }
    const m = new Manual();
    expect(channel(m, "hp")).toBe(m.hp$);
  });

  it("throws when the field has no channel", () => {
    const plain = { hp: 1 };
    expect(() => channel(plain, "hp")).toThrow(/no ObservableValue at "hp\$"/);
  });
});
