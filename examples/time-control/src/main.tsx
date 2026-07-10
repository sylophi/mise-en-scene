import { createRoot } from "react-dom/client";
import { MiseProvider } from "@mise/react";
import { createGame } from "./game.tsx";
import { Hud } from "./hud.tsx";
import "./styles.css";

// The engine runs on its own; React is just a viewer (plus our HUD overlay).
const { engine, game } = createGame();

createRoot(document.getElementById("root")!).render(
  <MiseProvider engine={engine}>
    <Hud game={game} />
  </MiseProvider>,
);
