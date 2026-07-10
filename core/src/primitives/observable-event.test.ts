import { describe, expect, it } from "vitest";
import { ObservableEvent } from "./observable-event.ts";
import { ObservableValue, structuralEquals } from "./observable-value.ts";
import { Vector } from "./vector.ts";

describe("ObservableEvent", () => {
  it("fires listeners with the payload", () => {
    const ev = new ObservableEvent<number>();
    const seen: number[] = [];
    ev.addListener((n) => seen.push(n));
    ev.fire(5);
    ev.fire(7);
    expect(seen).toEqual([5, 7]);
  });

  it("unsubscribe stops delivery", () => {
    const ev = new ObservableEvent<number>();
    const seen: number[] = [];
    const unsub = ev.addListener((n) => seen.push(n));
    ev.fire(1);
    unsub();
    ev.fire(2);
    expect(seen).toEqual([1]);
  });

  it("supports a void payload", () => {
    const ev = new ObservableEvent();
    let count = 0;
    ev.addListener(() => count++);
    ev.fire();
    expect(count).toBe(1);
  });

  it("tolerates listeners mutating the set during fire", () => {
    const ev = new ObservableEvent();
    let count = 0;
    ev.addListener(() => {
      count++;
      ev.clear(); // remove during dispatch; must not throw
    });
    expect(() => ev.fire()).not.toThrow();
    expect(count).toBe(1);
  });
});

describe("ObservableValue", () => {
  it("get returns the current value", () => {
    expect(new ObservableValue(3).get()).toBe(3);
  });

  it("set fires listeners with the new value", () => {
    const ov = new ObservableValue(0);
    const seen: number[] = [];
    ov.addListener((n) => seen.push(n));
    ov.set(1);
    ov.set(2);
    expect(seen).toEqual([1, 2]);
    expect(ov.get()).toBe(2);
  });

  it("skips firing when set to a === value", () => {
    const ov = new ObservableValue(1);
    let count = 0;
    ov.addListener(() => count++);
    ov.set(1);
    expect(count).toBe(0);
  });

  it("does not fire immediately on subscribe", () => {
    const ov = new ObservableValue(42);
    let count = 0;
    ov.addListener(() => count++);
    expect(count).toBe(0);
  });

  describe("equals option", () => {
    it("suppresses sets the comparator deems equal, keeping the old value", () => {
      const ov = new ObservableValue(new Vector(1, 2), {
        equals: (a, b) => a.equals(b),
      });
      const first = ov.get();
      let count = 0;
      ov.addListener(() => count++);
      ov.set(new Vector(1, 2)); // fresh but structurally equal instance
      expect(count).toBe(0);
      expect(ov.get()).toBe(first); // old reference kept
      ov.set(new Vector(3, 2));
      expect(count).toBe(1);
      expect(ov.get()).toEqual(new Vector(3, 2));
    });

    it("still treats === sets as a no-op without consulting the comparator", () => {
      let called = 0;
      const ov = new ObservableValue(7, {
        equals: () => {
          called++;
          return false;
        },
      });
      ov.set(7);
      expect(called).toBe(0);
    });

    it("defaults to === when no comparator is given", () => {
      const ov = new ObservableValue(new Vector(1, 2));
      let count = 0;
      ov.addListener(() => count++);
      ov.set(new Vector(1, 2)); // equal in value, different reference
      expect(count).toBe(1); // v1 behavior preserved
    });
  });
});

describe("structuralEquals", () => {
  it("matches identical references", () => {
    const v = new Vector(1, 1);
    expect(structuralEquals(v, v)).toBe(true);
    expect(structuralEquals(3, 3)).toBe(true);
  });

  it("delegates to a same-class equals method", () => {
    expect(structuralEquals(new Vector(1, 2), new Vector(1, 2))).toBe(true);
    expect(structuralEquals(new Vector(1, 2), new Vector(9, 2))).toBe(false);
  });

  it("rejects different classes and equals-less objects", () => {
    class Fake {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {}
      equals(): boolean {
        return true;
      }
    }
    expect(structuralEquals(new Fake(1, 2), new Vector(1, 2))).toBe(false);
    expect(structuralEquals({ x: 1 }, { x: 1 })).toBe(false);
    expect(structuralEquals(null, null)).toBe(true); // === short-circuit
    expect(structuralEquals(1, 2)).toBe(false);
  });
});
