import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Engine } from "@mise/core";
import { MiseProvider } from "@mise/react";
import { initPhysics } from "@mise/physics";
import { buildScene } from "./game.tsx";
import { Hud } from "./hud.tsx";
import "./style.css";

await initPhysics(); // load the Rapier WASM module before any physics unit

const engine = new Engine();
engine.changeScene(buildScene());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MiseProvider engine={engine}>
      <Hud />
    </MiseProvider>
  </StrictMode>,
);
