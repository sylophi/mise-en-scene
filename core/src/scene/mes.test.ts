import { describe, expect, it } from "vitest";
import { mes } from "./mes.ts";
import { Unit2D, type Unit2DProps } from "../unit/unit2d.ts";
import { Engine } from "../engine/engine.ts";
import { Vector } from "../primitives/vector.ts";

interface PlayerProps extends Unit2DProps {
  hp: number;
}

class Player extends Unit2D {
  readonly hp: number;
  constructor(props: PlayerProps) {
    super(props);
    this.hp = props.hp;
  }
}

class Sword extends Unit2D {
  readonly damage: number;
  constructor(props: Unit2DProps & { damage: number }) {
    super(props);
    this.damage = props.damage;
  }
}

describe("mes", () => {
  it("instantiates with typed props and returns a live treeless unit", () => {
    const p = mes(Player, { hp: 100, position: new Vector(1, 2) });
    expect(p).toBeInstanceOf(Player);
    expect(p.hp).toBe(100);
    expect(p.position.get().equals(new Vector(1, 2))).toBe(true);
    expect(p.isLive).toBe(false); // treeless until mounted
  });

  it("attaches children passed in the trailing arg", () => {
    const p = mes(Player, { hp: 100 }, [mes(Sword, { damage: 5 })]);
    expect(p.children.length).toBe(1);
    expect(p.children[0]).toBeInstanceOf(Sword);
  });

  it("a scene is just a function; embedding = calling it", () => {
    const Hero = (props: { hp: number }) =>
      mes(Player, { hp: props.hp }, [mes(Sword, { damage: 5 })]);

    const tree = mes(Player, { hp: 1 }, [Hero({ hp: 100 }), Hero({ hp: 50 })]);
    expect(tree.children.length).toBe(2);
    expect((tree.children[0] as Player).hp).toBe(100);
    expect((tree.children[1] as Player).hp).toBe(50);
  });

  it("fires lifecycle only once mounted under the engine root", () => {
    const e = new Engine({ autoStart: false });
    const tree = mes(Player, { hp: 10 }, [mes(Sword, { damage: 1 })]);
    expect(tree.isLive).toBe(false);
    e.changeScene(tree);
    expect(tree.isLive).toBe(true);
    expect(tree.children[0]!.isLive).toBe(true);
  });
});
