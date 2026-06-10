import { describe, expect, it } from "vitest";
import { Unit } from "./unit.ts";
import { Unit2D, type Unit2DProps } from "./unit2d.ts";
import { Engine } from "../engine/engine.ts";
import { ObservableEvent } from "../primitives/observable-event.ts";

describe("onDestroyed", () => {
  it("fires once, after the onDestroy hook", () => {
    const order: string[] = [];
    class Tracked extends Unit {
      override onDestroy(): void {
        order.push("hook");
      }
    }
    const u = new Tracked();
    u.onDestroyed.addListener(() => order.push("event"));
    u.destroy();
    u.destroy(); // idempotent
    expect(order).toEqual(["hook", "event"]);
  });

  it("fires bottom-up: children before parents", () => {
    const order: string[] = [];
    const parent = new Unit();
    const child = new Unit();
    parent.addChild(child);
    parent.onDestroyed.addListener(() => order.push("parent"));
    child.onDestroyed.addListener(() => order.push("child"));
    parent.destroy();
    expect(order).toEqual(["child", "parent"]);
  });
});

describe("observeUntilDestroyed", () => {
  it("receives events until the unit is destroyed", () => {
    const ev = new ObservableEvent<number>();
    const got: number[] = [];
    const u = new Unit();
    u.observeUntilDestroyed(ev, (n) => got.push(n));
    ev.fire(1);
    u.destroy();
    ev.fire(2);
    expect(got).toEqual([1]);
  });

  it("survives tree exit (destroy-scoped, like Godot signals)", () => {
    const engine = new Engine({ autoStart: false });
    const ev = new ObservableEvent<number>();
    const got: number[] = [];
    const u = new Unit();
    engine.root.addChild(u);
    u.observeUntilDestroyed(ev, (n) => got.push(n));
    engine.root.removeChild(u);
    ev.fire(1); // off-tree, still subscribed
    expect(got).toEqual([1]);
  });

  it("returns an unsubscribe for early opt-out", () => {
    const ev = new ObservableEvent<number>();
    const got: number[] = [];
    const u = new Unit();
    const unsub = u.observeUntilDestroyed(ev, (n) => got.push(n));
    unsub();
    ev.fire(1);
    expect(got).toEqual([]);
  });

  it("throws on a destroyed unit", () => {
    const u = new Unit();
    u.destroy();
    expect(() =>
      u.observeUntilDestroyed(new ObservableEvent(), () => {}),
    ).toThrow(/destroyed/);
  });
});

describe("retained props", () => {
  interface SignProps extends Unit2DProps {
    title: string;
  }
  class Sign extends Unit2D<SignProps> {
    get title(): string {
      return this.props.title; // typed, no constructor copying
    }
  }

  it("exposes constructor props to subclasses without copying", () => {
    const s = new Sign({ title: "exit stage left" });
    expect(s.title).toBe("exit stage left");
  });
});
