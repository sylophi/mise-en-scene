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

describe("hooks that mutate the tree mid-propagation", () => {
  it("destroying self in onTreeExit does not recurse; exit fires once", () => {
    const log: string[] = [];
    const e = engine();
    class SelfDestruct extends T {
      override onTreeExit(): void {
        super.onTreeExit();
        this.destroy();
      }
    }
    const parent = new T("p", log);
    const u = new SelfDestruct("u", log);
    parent.addChild(u);
    e.root.addChild(parent);
    log.length = 0;
    e.root.removeChild(parent);
    expect(log).toEqual(["exit:u", "destroy:u", "exit:p"]);
    expect(u.destroyed).toBe(true);
    expect(u.parent).toBeNull();
    expect(u.isLive).toBe(false);
  });

  it("destroying an earlier sibling in onTreeEnter does not skip later siblings", () => {
    const log: string[] = [];
    const e = engine();
    const a = new T("a", log);
    class Assassin extends T {
      override onTreeEnter(): void {
        super.onTreeEnter();
        a.destroy();
      }
    }
    const parent = new T("p", log);
    const b = new Assassin("b", log);
    const c = new T("c", log);
    parent.addChild(a);
    parent.addChild(b);
    parent.addChild(c);
    e.root.addChild(parent);
    expect(log).toEqual([
      "enter:p",
      "enter:a",
      "enter:b",
      "exit:a",
      "destroy:a",
      "enter:c", // was the bug: c skipped, live-parented but unbound
    ]);
    expect(a.destroyed).toBe(true);
    expect(a.isLive).toBe(false);
    expect(c.isLive).toBe(true);
  });

  it("a sibling destroyed before its turn in onTreeEnter never enters or announces", () => {
    const log: string[] = [];
    const e = engine();
    const b = new T("b", log);
    class Assassin extends T {
      override onTreeEnter(): void {
        super.onTreeEnter();
        b.destroy();
      }
    }
    const parent = new T("p", log);
    const a = new Assassin("a", log);
    const c = new T("c", log);
    parent.addChild(a);
    parent.addChild(b);
    parent.addChild(c);
    const entered: Unit[] = [];
    e.onUnitEnter.addListener((u) => entered.push(u));
    e.root.addChild(parent);
    // b never entered, so no exit either: destroy is its only lifecycle event.
    expect(log).toEqual(["enter:p", "enter:a", "destroy:b", "enter:c"]);
    expect(b.destroyed).toBe(true);
    expect(b.isLive).toBe(false);
    expect(c.isLive).toBe(true);
    expect(entered).not.toContain(b);
    expect(entered).toContain(c);
  });

  it("destroying an earlier sibling in onTreeExit does not skip later siblings", () => {
    const log: string[] = [];
    const e = engine();
    const a = new T("a", log);
    class Assassin extends T {
      override onTreeExit(): void {
        super.onTreeExit();
        a.destroy();
      }
    }
    const parent = new T("p", log);
    const b = new Assassin("b", log);
    const c = new T("c", log);
    parent.addChild(a);
    parent.addChild(b);
    parent.addChild(c);
    e.root.addChild(parent);
    log.length = 0;
    e.root.removeChild(parent);
    // a already exited before b's hook runs, so destroying it fires no exit.
    expect(log).toEqual(["exit:a", "exit:b", "destroy:a", "exit:c", "exit:p"]);
    expect(a.destroyed).toBe(true);
    expect(a.parent).toBeNull();
    expect(c.isLive).toBe(false); // was the bug: c skipped, detached but still bound
    expect(c.parent).toBe(parent);
  });

  it("a sibling destroyed before its turn in onTreeExit still exits and unbinds", () => {
    const log: string[] = [];
    const e = engine();
    const b = new T("b", log);
    class Assassin extends T {
      override onTreeExit(): void {
        super.onTreeExit();
        b.destroy();
      }
    }
    const parent = new T("p", log);
    const a = new Assassin("a", log);
    const c = new T("c", log);
    parent.addChild(a);
    parent.addChild(b);
    parent.addChild(c);
    e.root.addChild(parent);
    log.length = 0;
    e.root.removeChild(parent);
    expect(log).toEqual(["exit:a", "exit:b", "destroy:b", "exit:c", "exit:p"]);
    expect(b.destroyed).toBe(true);
    expect(b.isLive).toBe(false);
    expect(c.isLive).toBe(false);
    expect(c.parent).toBe(parent);
  });

  it("does not announce onUnitEnter for a unit destroyed by its own enter hook", () => {
    const log: string[] = [];
    const e = engine();
    class Ephemeral extends T {
      override onTreeEnter(): void {
        super.onTreeEnter();
        this.destroy();
      }
    }
    const parent = new T("p", log);
    const a = new Ephemeral("a", log);
    const b = new T("b", log);
    parent.addChild(a);
    parent.addChild(b);
    const entered: Unit[] = [];
    e.onUnitEnter.addListener((u) => entered.push(u));
    e.root.addChild(parent);
    expect(entered).not.toContain(a);
    expect(a.destroyed).toBe(true);
    expect(a.isLive).toBe(false);
    expect(b.isLive).toBe(true);
    expect(entered).toContain(b);
  });
});
