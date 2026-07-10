import { createRoot } from "react-dom/client";
import { Engine } from "@mise/core";
import { MiseProvider } from "@mise/react";
import { createGame } from "./game.tsx";
import { Hud } from "./hud.tsx";
import { makeSfx } from "./sfx.ts";
import "./styles.css";

async function main(): Promise<void> {
  // Every sound in the game is rendered offline from oscillators: no files.
  const sfx = await makeSfx();

  const engine = new Engine();
  const { scene, state } = createGame(sfx);
  engine.changeScene(scene);

  createRoot(document.getElementById("root")!).render(
    <MiseProvider engine={engine}>
      <Hud state={state} />
    </MiseProvider>,
  );
}

void main();
