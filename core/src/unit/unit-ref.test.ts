import { describe, expect, it } from "vitest";
import { unitRef } from "./unit-ref.ts";
import { Unit2D, type Unit2DProps } from "./unit2d.ts";
import { mes } from "../scene/mes.ts";

interface PlayerProps extends Unit2DProps {
  hp: number;
}

class Player extends Unit2D<PlayerProps> {
  get hp(): number {
    return this.props.hp;
  }
}

class Sword extends Unit2D {}

describe("UnitRef + mes options", () => {
  it("fills on placement and clears on destroy", () => {
    const ref = unitRef<Player>();
    expect(ref.current).toBeNull();
    const p = mes(Player, { hp: 100 }, { ref });
    expect(ref.current).toBe(p);
    p.destroy();
    expect(ref.current).toBeNull();
  });

  it("is observable: a HUD can watch spawn and death", () => {
    const ref = unitRef<Player>();
    const seen: Array<Player | null> = [];
    ref.current$.addListener((u) => seen.push(u));
    const p = mes(Player, { hp: 1 }, { ref });
    p.destroy();
    expect(seen).toEqual([p, null]);
  });

  it("last placement wins; a respawn is not clobbered by the old unit's death", () => {
    const ref = unitRef<Player>();
    const p1 = mes(Player, { hp: 1 }, { ref });
    const p2 = mes(Player, { hp: 2 }, { ref });
    expect(ref.current).toBe(p2);
    p1.destroy(); // identity check: must not null out p2
    expect(ref.current).toBe(p2);
  });

  it("accepts options and children together", () => {
    const ref = unitRef<Player>();
    const p = mes(Player, { hp: 5 }, { ref }, [mes(Sword, {})]);
    expect(ref.current).toBe(p);
    expect(p.children.length).toBe(1);
    expect(p.children[0]).toBeInstanceOf(Sword);
  });

  it("still accepts children as the third argument", () => {
    const p = mes(Player, { hp: 5 }, [mes(Sword, {})]);
    expect(p.children.length).toBe(1);
  });
});
