import { createRoot } from "react-dom/client";
import { MiseProvider } from "@mise/react";
import { initPhysics } from "@mise/physics";
import { createGame } from "./game.tsx";
import { Panel } from "./panel.tsx";

async function main(): Promise<void> {
  await initPhysics();
  const { engine, player, lab } = createGame();
  createRoot(document.getElementById("root")!).render(
    <MiseProvider engine={engine}>
      <Panel player={player} lab={lab} />
    </MiseProvider>,
  );
}

void main();
