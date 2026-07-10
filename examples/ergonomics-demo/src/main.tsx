import { Camera, Engine, mes, Unit, Vector } from "@mise/core";
import { MiseProvider } from "@mise/react";
import { createRoot } from "react-dom/client";
import { Chaser, Director, Gem, Player, CENTER, WORLD } from "./units.ts";
import { Hud } from "./hud.tsx";
import "./style.css";

function level(): { scene: Unit; player: Player } {
  const player = mes(Player, { position: CENTER });
  const chaser = mes(Chaser, { player, position: new Vector(8, 8) });
  const scene = mes(Unit, {}, [
    player,
    chaser,
    mes(Gem, { player, position: Gem.randomSpot() }),
    mes(Gem, { player, position: Gem.randomSpot() }),
    mes(Gem, { player, position: Gem.randomSpot() }),
    mes(Director, { player, chaser }),
    mes(Camera, {
      width: WORLD.w,
      height: WORLD.h,
      position: new Vector(WORLD.w / 2, WORLD.h / 2),
    }),
  ]);
  return { scene, player };
}

const engine = new Engine();
const { scene, player } = level();
engine.changeScene(scene);

// No StrictMode on purpose: its dev-mode double renders would inflate the
// HUD's render counters, which are the point of the demo.
createRoot(document.getElementById("root")!).render(
  <div className="app">
    <MiseProvider engine={engine}>
      <Hud player={player} />
    </MiseProvider>
  </div>,
);
