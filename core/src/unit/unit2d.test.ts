import { describe, expect, it } from "vitest";
import { Unit } from "./unit.ts";
import { Unit2D } from "./unit2d.ts";
import { Vector } from "../primitives/vector.ts";
import { Matrix2D } from "../primitives/matrix2d.ts";
import { Engine } from "../engine/engine.ts";

describe("Unit2D transform", () => {
  it("defaults to zero position, zero rotation, unit scale", () => {
    const u = new Unit2D();
    expect(u.position.equals(Vector.zero)).toBe(true);
    expect(u.rotation).toBe(0);
    expect(u.scale.equals(Vector.one)).toBe(true);
  });

  it("accessors write through to the channels", () => {
    const u = new Unit2D();
    const seen: number[] = [];
    u.rotation$.addListener((v) => seen.push(v));
    u.rotation += 0.5; // compound assignment fires the channel
    u.rotation += 0.5;
    const unchanged = u.rotation;
    u.rotation = unchanged; // === skip: no fire
    expect(seen).toEqual([0.5, 1]);
    u.position = u.position.add(new Vector(2, 0));
    expect(u.position.equals(new Vector(2, 0))).toBe(true);
  });

  it("composes world position by translation", () => {
    const parent = new Unit2D({ position: new Vector(10, 0) });
    const child = new Unit2D({ position: new Vector(5, 0) });
    parent.addChild(child);
    const origin = child.worldTransform.apply(Vector.zero);
    expect(origin.equals(new Vector(15, 0))).toBe(true);
  });

  it("applies parent rotation to child offset", () => {
    const parent = new Unit2D({
      position: new Vector(10, 0),
      rotation: Math.PI / 2,
    });
    const child = new Unit2D({ position: new Vector(5, 0) });
    parent.addChild(child);
    const w = child.worldTransform.apply(Vector.zero);
    expect(w.x).toBeCloseTo(10);
    expect(w.y).toBeCloseTo(5);
  });

  it("composes nested scale per-axis", () => {
    const parent = new Unit2D({ scale: new Vector(2, 3) });
    const child = new Unit2D({ scale: new Vector(4, 5) });
    parent.addChild(child);
    const p = child.worldTransform.apply(new Vector(1, 1));
    expect(p.x).toBeCloseTo(8);
    expect(p.y).toBeCloseTo(15);
  });

  it("keeps shear when non-uniform parent scale meets child rotation", () => {
    const parent = new Unit2D({ scale: new Vector(2, 1) });
    const child = new Unit2D({ rotation: Math.PI / 2 });
    parent.addChild(child);
    // (1,0) rotates 90° to (0,1); the parent stretches x only, so it stays
    // (0,1). The old TRS composition produced (0,2): scale leaked onto the
    // rotated axis.
    const p = child.worldTransform.apply(new Vector(1, 0));
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(1);
  });

  it("breaks inheritance at a non-Unit2D ancestor", () => {
    const top = new Unit2D({ position: new Vector(10, 0) });
    const plain = new Unit(); // non-Unit2D resets the origin
    const leaf = new Unit2D({ position: new Vector(5, 0) });
    top.addChild(plain);
    plain.addChild(leaf);
    // leaf's parent is a plain Unit, so its world == its local
    const origin = leaf.worldTransform.apply(Vector.zero);
    expect(origin.equals(new Vector(5, 0))).toBe(true);
  });
});

// Reference implementation: the uncached v1 recursion, recomputed on every
// call. The cache is correct exactly when it always agrees with this.
function uncachedWorld(u: Unit2D): Matrix2D {
  const local = Matrix2D.fromTRS(u.position, u.rotation, u.scale);
  return u.parent instanceof Unit2D
    ? uncachedWorld(u.parent).multiply(local)
    : local;
}

const expectSameMatrix = (m: Matrix2D, n: Matrix2D): void => {
  expect(m.a).toBeCloseTo(n.a, 12);
  expect(m.b).toBeCloseTo(n.b, 12);
  expect(m.c).toBeCloseTo(n.c, 12);
  expect(m.d).toBeCloseTo(n.d, 12);
  expect(m.tx).toBeCloseTo(n.tx, 12);
  expect(m.ty).toBeCloseTo(n.ty, 12);
};

/** A 4-deep chain with rotation, non-uniform scale, and translation mixed in. */
function makeChain(): [Unit2D, Unit2D, Unit2D, Unit2D] {
  const a = new Unit2D({ position: new Vector(10, -3), rotation: 0.7 });
  const b = new Unit2D({ scale: new Vector(2, 0.5), rotation: -0.2 });
  const c = new Unit2D({ position: new Vector(-4, 8), rotation: 1.9 });
  const d = new Unit2D({ position: new Vector(1, 1), scale: new Vector(3, 3) });
  a.addChild(b);
  b.addChild(c);
  c.addChild(d);
  return [a, b, c, d];
}

describe("Unit2D world transform caching", () => {
  it("returns the same instance between changes (memoized, immutable)", () => {
    const [, , , leaf] = makeChain();
    expect(leaf.worldTransform).toBe(leaf.worldTransform);
    expect(leaf.localMatrix).toBe(leaf.localMatrix);
  });

  it("always agrees with the uncached recursion across mixed mutations", () => {
    const [a, b, , d] = makeChain();
    expectSameMatrix(d.worldTransform, uncachedWorld(d));
    a.rotation += 0.31;
    b.scale = new Vector(1.5, 4);
    d.position = new Vector(-2, 6);
    for (const u of [a, b, d]) {
      expectSameMatrix(u.worldTransform, uncachedWorld(u));
    }
  });

  it("a local change invalidates the unit and every descendant", () => {
    const [a, b, c, d] = makeChain();
    const before = [a, b, c, d].map((u) => u.worldTransform); // fill all caches
    a.position = a.position.add(new Vector(0, 5));
    [a, b, c, d].forEach((u, i) => {
      expect(u.worldTransform).not.toBe(before[i]); // recomputed, not stale
      expectSameMatrix(u.worldTransform, uncachedWorld(u));
    });
  });

  it("a mid-chain change leaves ancestors cached but refreshes descendants", () => {
    const [a, , c, d] = makeChain();
    const aBefore = a.worldTransform;
    const dBefore = d.worldTransform;
    c.rotation += 0.5;
    expect(a.worldTransform).toBe(aBefore); // ancestor untouched
    expect(d.worldTransform).not.toBe(dBefore);
    expectSameMatrix(d.worldTransform, uncachedWorld(d));
  });

  it("invalidates the moved subtree on reparent", () => {
    const [a, b] = makeChain();
    const other = new Unit2D({ position: new Vector(100, 0), rotation: -1.1 });
    const bLeafBefore = (b.children[0] as Unit2D).worldTransform;
    void b.worldTransform; // fill
    other.addChild(b); // reparent a → other
    expectSameMatrix(b.worldTransform, uncachedWorld(b));
    const leaf = b.children[0] as Unit2D;
    expect(leaf.worldTransform).not.toBe(bLeafBefore); // descendants moved too
    expectSameMatrix(leaf.worldTransform, uncachedWorld(leaf));
    expect(a.children).not.toContain(b);
  });

  it("falls back to the local matrix on detach", () => {
    const [a, b] = makeChain();
    void b.worldTransform; // fill under a
    a.removeChild(b);
    expectSameMatrix(b.worldTransform, b.localMatrix);
  });

  it("re-invalidates children adopted while their new parent is dirty", () => {
    // `a` dirty (never read) adopting a clean `c` must still refresh `c`:
    // the prune-at-dirty shortcut only applies going *down* from a change.
    const a = new Unit2D({ position: new Vector(7, 0) });
    const c = new Unit2D({ position: new Vector(1, 0) });
    const cBefore = c.worldTransform; // clean, parentless: world == local
    a.addChild(c);
    expect(c.worldTransform).not.toBe(cBefore);
    expect(c.worldTransform.apply(Vector.zero).equals(new Vector(8, 0))).toBe(
      true,
    );
  });

  it("does not invalidate across a chain break (plain-Unit ancestor)", () => {
    const top = new Unit2D({ position: new Vector(10, 0) });
    const plain = new Unit();
    const leaf = new Unit2D({ position: new Vector(5, 0) });
    top.addChild(plain);
    plain.addChild(leaf);
    const before = leaf.worldTransform;
    top.position = new Vector(-50, 0); // above the break: leaf is unaffected
    expect(leaf.worldTransform).toBe(before); // cache survives, correctly
    expectSameMatrix(leaf.worldTransform, uncachedWorld(leaf));
  });

  it("moving a plain-Unit ancestor does not change a fresh subtree", () => {
    const [a] = makeChain();
    const plain = new Unit();
    const leaf = new Unit2D({ position: new Vector(5, 0) });
    plain.addChild(leaf);
    a.addChild(plain);
    const before = leaf.worldTransform;
    new Unit2D({ position: new Vector(9, 9) }).addChild(plain); // reparent
    expect(leaf.worldTransform).toBe(before); // chain still breaks at `plain`
  });

  it("channel listeners observe the already-invalidated transform", () => {
    const [a, , , d] = makeChain();
    void d.worldTransform; // fill
    let seen: Matrix2D | null = null;
    a.position$.addListener(() => (seen = d.worldTransform));
    a.position = new Vector(0, 0);
    expectSameMatrix(seen!, uncachedWorld(d));
  });

  it("onParentChanged listeners observe the already-invalidated transform", () => {
    const [a, b] = makeChain();
    void b.worldTransform; // fill under a's chain
    let seen: Matrix2D | null = null;
    b.onParentChanged.addListener(() => (seen = b.worldTransform));
    const other = new Unit2D({ position: new Vector(42, 0) });
    other.addChild(b);
    expectSameMatrix(seen!, uncachedWorld(b));
    expectSameMatrix(a.worldTransform, uncachedWorld(a)); // a still coherent
  });

  it("onTreeEnter observes the fresh transform after a re-attach", () => {
    const seen: Vector[] = [];
    class Probe extends Unit2D {
      override onTreeEnter(parent: Unit | null): void {
        super.onTreeEnter(parent);
        seen.push(this.worldTransform.apply(Vector.zero));
      }
    }
    const engine = new Engine({ autoStart: false });
    const near = new Unit2D({ position: new Vector(1, 0) });
    const far = new Unit2D({ position: new Vector(100, 0) });
    engine.root.addChild(near);
    engine.root.addChild(far);
    const probe = new Probe({ position: new Vector(0.5, 0) });
    near.addChild(probe);
    void probe.worldTransform; // fill the cache under `near`
    near.removeChild(probe);
    far.addChild(probe); // must not enter with the stale `near` pose
    expect(seen).toHaveLength(2);
    expect(seen[1]?.equals(new Vector(100.5, 0))).toBe(true);
  });
});
