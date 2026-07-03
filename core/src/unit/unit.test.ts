import { describe, expect, it } from "vitest";
import { Unit } from "./unit.ts";
import { Engine } from "../engine/engine.ts";

class T extends Unit {
  constructor(
    readonly name: string,
    readonly log: string[],
  ) {
    super();
  }
  override onTreeEnter(): void {
    this.log.push(`enter:${this.name}`);
  }
  override onTreeExit(): void {
    this.log.push(`exit:${this.name}`);
  }
  override onDestroy(): void {
    this.log.push(`destroy:${this.name}`);
  }
}

const engine = () => new Engine({ autoStart: false });

describe("Unit tree", () => {
  it("links parent and children", () => {
    const log: string[] = [];
    const a = new T("a", log);
    const b = new T("b", log);
    a.addChild(b);
    expect(b.parent).toBe(a);
    expect(a.children).toEqual([b]);
  });

  it("prevents cycles (self and ancestor)", () => {
    const log: string[] = [];
    const a = new T("a", log);
    const b = new T("b", log);
    a.addChild(b);
    expect(() => a.addChild(a)).toThrow();
    expect(() => b.addChild(a)).toThrow();
  });

  it("onParentChanged fires on attach, reparent, and detach", () => {
    const log: string[] = [];
    const a = new T("a", log);
    const b = new T("b", log);
    const c = new T("c", log);
    const parents: (Unit | null)[] = [];
    c.onParentChanged.addListener((p) => parents.push(p));
    a.addChild(c);
    a.addChild(c); // no-op: already the parent
    b.addChild(c); // reparent
    b.removeChild(c); // detach
    expect(parents).toEqual([a, b, null]);
  });

  it("findAncestor returns the nearest instance of the class, or null", () => {
    class Zone extends Unit {}
    const outer = new Zone();
    const middle = new Unit();
    const inner = new Zone();
    const leaf = new Unit();
    outer.addChild(middle);
    middle.addChild(inner);
    inner.addChild(leaf);
    expect(leaf.findAncestor(Zone)).toBe(inner);
    expect(middle.findAncestor(Zone)).toBe(outer);
    expect(outer.findAncestor(Zone)).toBeNull();
    expect(inner.findAncestor(Zone)).toBe(outer); // self does not count
  });

  it("removeChild detaches without destroying", () => {
    const log: string[] = [];
    const a = new T("a", log);
    const b = new T("b", log);
    a.addChild(b);
    a.removeChild(b);
    expect(b.parent).toBeNull();
    expect(a.children).toEqual([]);
    expect(b.destroyed).toBe(false);
  });
});

describe("engine binding & lifecycle", () => {
  it("does not fire enter while building a treeless subtree", () => {
    const log: string[] = [];
    const a = new T("a", log);
    const b = new T("b", log);
    const c = new T("c", log);
    a.addChild(b);
    b.addChild(c);
    expect(log).toEqual([]);
    expect(a.isLive).toBe(false);
  });

  it("binds + fires onTreeEnter top-down when mounted under root", () => {
    const log: string[] = [];
    const e = engine();
    const a = new T("a", log);
    const b = new T("b", log);
    const c = new T("c", log);
    a.addChild(b);
    b.addChild(c);
    e.root.addChild(a);
    expect(log).toEqual(["enter:a", "enter:b", "enter:c"]);
    expect(a.engine).toBe(e);
    expect(c.engine).toBe(e);
    expect(a.isLive).toBe(true);
  });

  it("destroy fires exit + destroy bottom-up across the subtree", () => {
    const log: string[] = [];
    const e = engine();
    const a = new T("a", log);
    const b = new T("b", log);
    const c = new T("c", log);
    a.addChild(b);
    b.addChild(c);
    e.root.addChild(a);
    log.length = 0;
    a.destroy();
    expect(log).toEqual([
      "exit:c",
      "destroy:c",
      "exit:b",
      "destroy:b",
      "exit:a",
      "destroy:a",
    ]);
    expect(a.destroyed).toBe(true);
    expect(e.root.children).toEqual([]);
  });

  it("reparenting within the same engine does not re-fire enter/exit", () => {
    const log: string[] = [];
    const e = engine();
    const a = new T("a", log);
    const b = new T("b", log);
    const c = new T("c", log);
    a.addChild(b);
    a.addChild(c);
    e.root.addChild(a);
    log.length = 0;
    b.addChild(c); // move c from a to b, same engine
    expect(log).toEqual([]);
    expect(c.parent).toBe(b);
    expect(c.engine).toBe(e);
  });

  it("fires onUnitMoved only on same-engine reparents", () => {
    const log: string[] = [];
    const e = engine();
    const a = new T("a", log);
    const b = new T("b", log);
    const c = new T("c", log);
    a.addChild(b);
    a.addChild(c);
    e.root.addChild(a);
    const moved: Unit[] = [];
    e.onUnitMoved.addListener((u) => moved.push(u));
    b.addChild(c); // live reparent -> move
    expect(moved).toEqual([c]);
    const d = new T("d", log);
    a.addChild(d); // first mount: enter, not a move
    a.removeChild(d); // detach: exit, not a move
    const p = new T("p", log);
    const q = new T("q", log);
    p.addChild(q);
    a.addChild(q); // mounting from a detached parent: enter, not a move
    expect(moved).toEqual([c]);
  });

  it("leaving the tree (removeChild) fires exit bottom-up and unbinds", () => {
    const log: string[] = [];
    const e = engine();
    const a = new T("a", log);
    const b = new T("b", log);
    a.addChild(b);
    e.root.addChild(a);
    log.length = 0;
    e.root.removeChild(a);
    expect(log).toEqual(["exit:b", "exit:a"]);
    expect(a.engine).toBeNull();
    expect(b.isLive).toBe(false);
  });

  it("moving a live unit under a detached parent exits, reporting the parent left", () => {
    const log: string[] = [];
    const e = engine();
    const a = new T("a", log);
    e.root.addChild(a);

    const exits: (Unit | null)[] = [];
    class Reporting extends Unit {
      override onTreeExit(parent: Unit | null): void {
        exits.push(parent);
      }
    }
    const child = new Reporting();
    a.addChild(child);

    const detached = new T("detached", log);
    detached.addChild(child); // leaves the live tree
    expect(child.isLive).toBe(false);
    expect(child.parent).toBe(detached);
    expect(exits).toEqual([a]); // the parent it left, not the one it joined
  });

  it("throws when moving a bound unit across engines", () => {
    const log: string[] = [];
    const e1 = engine();
    const e2 = engine();
    const x = new T("x", log);
    e1.root.addChild(x);
    expect(() => e2.root.addChild(x)).toThrow();
    expect(x.engine).toBe(e1);
  });
});
