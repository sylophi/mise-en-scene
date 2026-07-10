// Headless smoke test: drives the example game through the same engine API the
// browser build uses (manual stepping, fed input), no DOM required.
import { expect, it } from "vitest";
import { createGame, Turret } from "./game.tsx";

it("example game: bullet time, pause, and turret freeze all work headlessly", () => {
  const { engine, game } = createGame();
  engine.stop(); // drive manually
  const scene = engine.root.children[0]!;
  const turrets = scene.children.filter((u) => u instanceof Turret);
  expect(turrets.length).toBe(5);

  // Turrets fire after 1.1s; bullets appear as scene siblings.
  const countBullets = () =>
    scene.children.filter((u) => u.constructor.name === "Bullet").length;
  for (let i = 0; i < 80; i++) engine.advanceFixed(1 / 60);
  expect(countBullets()).toBeGreaterThan(0);
  expect(game.survived$.get()).toBeGreaterThan(1);

  // Pause via Escape (fed like the DOM adapter would).
  engine.input.feedKeyDown("Escape");
  engine.input.feedKeyUp("Escape");
  expect(engine.paused).toBe(true);
  const t = engine.time;
  for (let i = 0; i < 60; i++) engine.advanceFixed(1 / 60);
  expect(engine.time).toBe(t); // world frozen
  engine.input.feedKeyDown("Escape");
  engine.input.feedKeyUp("Escape");
  expect(engine.paused).toBe(false);

  // Bullet time via Shift, applied by the controller's deviceTick.
  engine.input.feedKeyDown("Shift");
  engine.advanceDevice(1 / 60);
  expect(engine.timeScale).toBe(0.3);
  engine.input.feedKeyUp("Shift");
  engine.advanceDevice(1 / 60);
  expect(engine.timeScale).toBe(1);

  // Click a turret to freeze it: its rotation stops tracking the player.
  const turret = turrets[0]!;
  engine.input.feedPointerDown(0, turret.position);
  expect(turret.ticking).toBe(false);
  engine.input.feedPointerDown(0, turret.position);
  expect(turret.ticking).toBe(true);
});
