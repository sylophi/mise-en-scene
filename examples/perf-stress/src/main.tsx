import { createRoot } from "react-dom/client";
import { Engine } from "@mise/core";
import { MiseProvider } from "@mise/react";
import { buildLevel } from "./game.tsx";
import { Hud } from "./hud.tsx";
import "./style.css";

// The engine runs on its own; React is just a viewer.
const engine = new Engine();
const { scene, swarm, fps } = buildLevel(400);
engine.changeScene(scene);

createRoot(document.getElementById("root")!).render(
  <MiseProvider engine={engine}>
    <Hud swarm={swarm} fps={fps} />
  </MiseProvider>,
);
