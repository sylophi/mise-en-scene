import { useEngine, useObservable } from "@mise/react";
import type { Game } from "./game.tsx";

/**
 * Plain React over the world. Everything here keeps running while the engine
 * is paused: the overlay subscribes to `timeScale$` and drives the engine back
 * out of the pause it is rendered during.
 */
export function Hud({ game }: { game: Game }) {
  const engine = useEngine();
  const timeScale = useObservable(engine.timeScale$);
  const survived = useObservable(game.survived$);
  const best = useObservable(game.best$);
  const paused = timeScale === 0;

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-stat">
          survived <b>{survived.toFixed(1)}s</b>
        </div>
        <div
          className={
            paused
              ? "hud-scale paused"
              : timeScale < 1
                ? "hud-scale slowmo"
                : "hud-scale"
          }
        >
          {paused ? "PAUSED" : `${timeScale}x`}
        </div>
        <div className="hud-stat">
          best <b>{best.toFixed(1)}s</b>
        </div>
      </div>
      <div className="hud-help">
        WASD / arrows: move &middot; hold Shift: bullet time &middot; click a
        turret: freeze it &middot; Esc: pause
      </div>
      {paused && (
        <div className="pause-overlay">
          <h1>Paused</h1>
          <p>
            The fixed clock is at <code>timeScale = 0</code>: ticks, timers, and
            camera smoothing are frozen. This menu is plain React on the device
            clock, very much alive.
          </p>
          <button type="button" onClick={() => (engine.paused = false)}>
            Resume
          </button>
        </div>
      )}
    </div>
  );
}
