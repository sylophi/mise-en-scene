import { useObservable } from "@mise/react";
import { score$, shots$ } from "./game.tsx";

export function Hud() {
  const score = useObservable(score$);
  const shots = useObservable(shots$);
  return (
    <div className="hud">
      <div className="hud-row">
        <span className="hud-score">{score}</span>
        <span className="hud-shots">
          {shots} shot{shots === 1 ? "" : "s"}
        </span>
      </div>
      <div className="hud-help">drag to aim, release to fire — R resets</div>
    </div>
  );
}
