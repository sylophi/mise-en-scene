import { describe, expect, it } from "vitest";
import { Engine, mes, Unit, Vector } from "@mise/core";
import { CENTER, Chaser, Director, Gem, Player, WORLD } from "./units.ts";

const STEP = 1 / 60;

function makeGame() {
  const engine = new Engine({ autoStart: false });
  const player = mes(Player, { position: CENTER });
  const chaser = mes(Chaser, { player, position: new Vector(8, 8) });
  const gem = mes(Gem, { player, position: CENTER.add(new Vector(20, 0)) });
  engine.changeScene(
    mes(Unit, {}, [player, chaser, gem, mes(Director, { player, chaser })]),
  );
  return { engine, player, chaser, gem };
}

describe("Gem Rush (headless)", () => {
  it("moves the player with input, inside the world bounds", () => {
    const { engine, player } = makeGame();
    engine.input.feedKeyDown("d");
    const x0 = player.position.x;
    engine.advanceFixed(STEP);
    expect(player.position.x).toBeGreaterThan(x0);
    for (let i = 0; i < 600; i++) engine.advanceFixed(STEP);
    expect(player.position.x).toBeLessThanOrEqual(WORLD.w - 2);
  });

  it("collects a gem: score++ and the gem respawns elsewhere", () => {
    const { engine, player, gem } = makeGame();
    gem.position = player.position.add(new Vector(2, 0));
    engine.advanceFixed(STEP);
    expect(player.score).toBe(1);
    expect(gem.position.sub(player.position).length()).toBeGreaterThan(3.4);
  });

  it("sector updates only on cell change; sectorNaive fires every tick", () => {
    const { engine, player } = makeGame();
    let sectorFires = 0;
    let naiveFires = 0;
    player.sector$.addListener(() => sectorFires++);
    player.sectorNaive$.addListener(() => naiveFires++);
    for (let i = 0; i < 30; i++) engine.advanceFixed(STEP); // standing still
    expect(naiveFires).toBe(30);
    expect(sectorFires).toBeLessThanOrEqual(1); // at most the initial cell fix
  });

  it("chaser hits drain hp behind a mercy window", () => {
    const { engine, player, chaser } = makeGame();
    chaser.position = player.position.add(new Vector(2, 0));
    engine.advanceFixed(STEP);
    expect(player.hp).toBe(2);
    // Re-colliding does nothing while the mercy window runs; the player's
    // next tick reflects it as `shielded`.
    chaser.position = player.position.add(new Vector(2, 0));
    engine.advanceFixed(STEP);
    expect(player.hp).toBe(2);
    expect(player.shielded).toBe(true);
  });

  it("the Director resets the round at 0 hp", () => {
    const { engine, player, chaser } = makeGame();
    player.score = 5;
    player.hp = 1;
    chaser.position = player.position.add(new Vector(2, 0));
    engine.advanceFixed(STEP);
    expect(player.hp).toBe(3);
    expect(player.score).toBe(0);
    expect(player.position.equals(CENTER)).toBe(true);
    expect(chaser.position.equals(new Vector(8, 8))).toBe(true);
  });
});
