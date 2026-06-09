import { describe, expect, it } from "vitest";
import { ObservableEvent } from "./observable-event.ts";
import { ObservableValue } from "./observable-value.ts";

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
      ev.clear(); // remove during dispatch — must not throw
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
});
