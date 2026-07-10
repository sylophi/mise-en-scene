import { beforeAll, describe, expect, it } from "vitest";
import { Engine, Vector } from "@mise/core";
import { initPhysics } from "@mise/physics";
import { Ball, buildScene, score$, shots$ } from "./game.tsx";

beforeAll(() => initPhysics());

const steps = (e: Engine, n: number): void => {
  for (let i = 0; i < n; i++) e.advanceFixed(e.fixedStep);
};

const balls = (e: Engine): Ball[] => {
  const out: Ball[] = [];
  const visit = (u: (typeof e)["root"]["children"][number]): void => {
    if (u instanceof Ball) out.push(u);
    for (const c of u.children) visit(c);
  };
  visit(e.root);
  return out;
};

describe("rigidbody playground", () => {
  it("flings a ball on drag release and scores on the crates", () => {
    const engine = new Engine({ autoStart: false });
    engine.changeScene(buildScene());
    steps(engine, 2);
    expect(score$.get()).toBe(0);

    // Drag: pull down-left of the anchor, then release — a strong flat shot.
    engine.input.feedPointerMove(new Vector(0, 80));
    engine.input.feedPointerDown(0, new Vector(0, 80));
    steps(engine, 3);
    engine.input.feedPointerUp(0);
    steps(engine, 1);

    expect(shots$.get()).toBe(1);
    const [ball] = balls(engine);
    expect(ball).toBeDefined();
    expect(ball!.linearVelocity.x).toBeGreaterThan(0); // flying at the stack

    steps(engine, 300); // flight, impact, chain slams
    expect(score$.get()).toBeGreaterThan(0);

    // R rebuilds the scene and clears the score.
    engine.input.feedKeyDown("r");
    steps(engine, 2);
    expect(score$.get()).toBe(0);
    expect(shots$.get()).toBe(0);
    expect(balls(engine)).toEqual([]);
  });
});
