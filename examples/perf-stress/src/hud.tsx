import { useObservable } from "@mise/react";
import type { FpsMeter, Swarm } from "./game.tsx";

/** Overlay: FPS, live unit count, and the controls. Plain React on top. */
export function Hud({ swarm, fps }: { swarm: Swarm; fps: FpsMeter }) {
  const count = useObservable(swarm.count$);
  const rate = useObservable(fps.fps$);
  return (
    <div className="hud">
      <div className="hud-stats">
        <span className="hud-fps">{rate} fps</span>
        <span>{count + 1} units</span>
      </div>
      <div className="hud-help">
        WASD / arrows steer · E spawn +250 · Q cull 250 · Space shockwave
      </div>
    </div>
  );
}
