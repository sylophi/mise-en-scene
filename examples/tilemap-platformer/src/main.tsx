import { createRoot } from "react-dom/client";
import { Engine } from "@mise/core";
import { MiseProvider } from "@mise/react";
import { initPhysics } from "@mise/physics";
import { Level, won$ } from "./game.tsx";
import { Hud } from "./hud.tsx";

async function main(): Promise<void> {
  await initPhysics(); // once, before any physics unit is constructed

  const engine = new Engine();
  engine.changeScene(Level());

  const restart = (): void => engine.changeScene(Level());
  engine.input.onKeyDown.addListener(({ key }) => {
    if (key === "r" && won$.get()) restart();
  });

  createRoot(document.getElementById("root")!).render(
    <MiseProvider engine={engine}>
      <Hud onRestart={restart} />
    </MiseProvider>,
  );
}

void main();
