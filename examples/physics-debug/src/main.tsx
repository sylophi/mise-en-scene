import { Engine } from "@mise/core";
import { initPhysics } from "@mise/physics";
import { MiseProvider, useObservable } from "@mise/react";
import { createRoot } from "react-dom/client";
import type { CSSProperties, ReactNode } from "react";
import { COIN_COUNT, buildLevel, score$ } from "./game.tsx";

const hudStyle: CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  color: "#e8ecf4",
  fontSize: 14,
  lineHeight: 1.7,
  pointerEvents: "none",
  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
};

function Hud(): ReactNode {
  const score = useObservable(score$);
  return (
    <div style={hudStyle}>
      <div>
        coins {score}/{COIN_COUNT}
      </div>
      <div style={{ opacity: 0.7 }}>
        A/D move · Space jump · ` (tilde) toggle physics debug
      </div>
    </div>
  );
}

initPhysics().then(() => {
  const engine = new Engine();
  engine.changeScene(buildLevel());
  createRoot(document.getElementById("root")!).render(
    <MiseProvider engine={engine}>
      <Hud />
    </MiseProvider>,
  );
});
