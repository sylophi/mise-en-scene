import { beforeAll, describe, expect, it } from "vitest";
import { Vector } from "@mise/core";
import { initPhysics } from "@mise/physics";
import { createGame } from "./game.tsx";

beforeAll(() => initPhysics());

describe("character lab (headless smoke test)", () => {
  it("boots, and autostep changes which terrain is reachable", () => {
    const { engine, player } = createGame();
    engine.stop(); // drive the fixed clock by hand instead
    const steps = (n: number): void => {
      for (let i = 0; i < n; i++) engine.advanceFixed(engine.fixedStep);
    };

    steps(60); // fall from spawn and settle on the ground
    expect(player.isOnFloor).toBe(true);
    const groundY = player.position.y;

    engine.input.feedKeyDown("d"); // walk right, into the stairs
    steps(300);
    expect(player.position.x).toBeLessThan(102); // blocked by the first step

    player.autostep = 1.5; // the panel's toggle does exactly this
    steps(90); // climbs the stairs onto the plateau
    engine.input.feedKeyUp("d");
    expect(player.position.x).toBeGreaterThan(135);
    expect(player.position.y).toBeLessThan(groundY - 5); // and gained height
  });

  it("feeds the ground cast and the click inspector", () => {
    const { engine, player, lab } = createGame();
    engine.stop();
    for (let i = 0; i < 60; i++) engine.advanceFixed(engine.fixedStep);

    // Grounded: the swept capsule touches the floor right under the player.
    expect(player.isOnFloor).toBe(true);
    const hit = lab.groundHit$.get();
    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeLessThan(0.2);

    // Click inside the plateau (x in [135, 165], y in [64, 70]).
    engine.input.feedPointerDown(0, new Vector(150, 68));
    expect(lab.inspected$.get()).toEqual(["plateau"]);
    engine.input.feedPointerDown(0, new Vector(80, 20)); // empty sky
    expect(lab.inspected$.get()).toEqual([]);
  });
});
