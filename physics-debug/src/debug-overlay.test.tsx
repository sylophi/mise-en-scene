// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Camera, Engine, Vector, mes } from "@mise/core";
import {
  Area2D,
  CharacterBody2D,
  CollisionShape2D,
  PhysicsWorld2D,
  StaticBody2D,
  capsule,
  circle,
  initPhysics,
  rect,
} from "@mise/physics";
import { MiseProvider } from "@mise/react";
import { PhysicsDebug2D } from "./index.ts";

beforeAll(() => initPhysics());
afterEach(() => cleanup());

function setup(debugProps?: ConstructorParameters<typeof PhysicsDebug2D>[0]): {
  engine: Engine;
  world: PhysicsWorld2D;
  debug: PhysicsDebug2D;
} {
  const debug = mes(PhysicsDebug2D, debugProps);
  const world = mes(PhysicsWorld2D, {}, [
    mes(Camera, { width: 100, height: 100, position: new Vector(0, 0) }),
    mes(StaticBody2D, { position: new Vector(10, 5) }, [
      mes(CollisionShape2D, { shape: rect(4, 2) }),
    ]),
    mes(CharacterBody2D, { position: new Vector(-3, 0) }, [
      mes(CollisionShape2D, { shape: capsule(1.5, 1) }),
    ]),
    mes(Area2D, { position: new Vector(0, 8) }, [
      mes(CollisionShape2D, { shape: circle(3) }),
    ]),
    debug,
  ]);
  const engine = new Engine({ autoStart: false });
  engine.changeScene(world);
  return { engine, world, debug };
}

const step = (e: Engine): void => act(() => e.advanceFixed(e.fixedStep));
const svg = (): Element | null =>
  document.querySelector("[data-physics-debug]");
const roles = (role: string): NodeListOf<Element> =>
  document.querySelectorAll(`[data-debug-role="${role}"]`);

describe("PhysicsDebug2D", () => {
  it("draws each collider color-coded by role", () => {
    const { engine } = setup();
    render(<MiseProvider engine={engine} />);
    step(engine);
    expect(svg()).not.toBeNull();
    expect(roles("static")).toHaveLength(1);
    expect(roles("character")).toHaveLength(1);
    expect(roles("area")).toHaveLength(1);
    // Areas are filled regions; bodies are outlines.
    expect(roles("area")[0]!.getAttribute("fill")).not.toBe("none");
    expect(roles("static")[0]!.getAttribute("fill")).toBe("none");
  });

  it("toggles with the configured key and renders nothing while hidden", () => {
    const { engine } = setup();
    render(<MiseProvider engine={engine} />);
    step(engine);
    expect(svg()).not.toBeNull();

    act(() => engine.input.feedKeyDown("`"));
    step(engine);
    expect(svg()).toBeNull();

    act(() => engine.input.feedKeyUp("`"));
    step(engine); // a tick with the key up, so the next press is a transition
    act(() => engine.input.feedKeyDown("`"));
    step(engine);
    expect(svg()).not.toBeNull();
  });

  it("enables the world's ray log while mounted and restores it on exit", () => {
    const { engine, world, debug } = setup();
    expect(world.rayLog.enabled).toBe(true); // enabled on tree enter
    render(<MiseProvider engine={engine} />);
    step(engine);
    act(() => debug.destroy());
    expect(world.rayLog.enabled).toBe(false);
  });

  it("draws recorded rays with a hit marker", () => {
    const { engine, world } = setup();
    render(<MiseProvider engine={engine} />);
    step(engine);
    world.castRay(Vector.zero, new Vector(1, 0.5)); // hits the static box
    world.castRay(Vector.zero, new Vector(0, -1), 5); // misses
    step(engine);
    expect(document.querySelectorAll('[data-debug-ray="hit"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-debug-ray="miss"]')).toHaveLength(
      1,
    );
  });

  it("respects startVisible: false until toggled", () => {
    const { engine, debug } = setup({ startVisible: false });
    render(<MiseProvider engine={engine} />);
    step(engine);
    expect(svg()).toBeNull();
    act(() => {
      debug.visible = true;
    });
    expect(svg()).not.toBeNull();
  });
});
