import type { ReactNode } from "react";
import { useObservable } from "@mise/react";
import type { GameState } from "./game.tsx";

export function Hud({ state }: { state: GameState }): ReactNode {
  const found = useObservable(state.found$);
  const won = useObservable(state.won$);
  const muted = useObservable(state.mixer.muted$);
  const volume = useObservable(state.mixer.volume$);
  const unlocked = useObservable(state.mixer.unlocked$);

  return (
    <div className="hud">
      <div className="hud-bar">
        <span className="hud-score">
          🐦 {found} / {state.total}
        </span>
        <span className="hud-help">
          walk with WASD / arrows — follow the chirps
        </span>
        <span className="hud-audio">
          <button
            type="button"
            className="hud-mute"
            onClick={() => (state.mixer.muted = !muted)}
            aria-label={muted ? "unmute" : "mute"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => (state.mixer.volume = Number(e.target.value))}
            aria-label="volume"
          />
        </span>
      </div>
      {!unlocked && (
        <div className="hud-notice">Click or press any key to enable sound</div>
      )}
      {won && <div className="hud-banner">All birds found! 🎉</div>}
    </div>
  );
}
