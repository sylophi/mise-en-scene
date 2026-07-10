import { channel, type ObservableValue, type Vector } from "@mise/core";
import { useObservable } from "@mise/react";
import { useRef, type ReactNode } from "react";
import type { Player } from "./units.ts";

/**
 * Subscribes to one sector channel and counts its own renders. Both panels
 * receive identical writes (a fresh, usually-equal Vector every tick); only
 * the equality option decides how often React runs this component.
 */
function SectorPanel({
  title,
  note,
  ov,
}: {
  title: string;
  note: string;
  ov: ObservableValue<Vector>;
}): ReactNode {
  const sector = useObservable(ov);
  const renders = useRef(0);
  renders.current += 1;
  return (
    <div className="panel">
      <div className="panel-title">{title}</div>
      <div className="panel-value">
        sector {sector.x},{sector.y}
      </div>
      <div className="panel-renders">{renders.current} renders</div>
      <div className="panel-note">{note}</div>
    </div>
  );
}

export function Hud({ player }: { player: Player }): ReactNode {
  const hp = useObservable(player.hp$);
  const score = useObservable(player.score$);
  return (
    <div className="hud">
      <div className="hud-top">
        <div className="score">{score} 💎</div>
        <div className="hearts">
          {"♥".repeat(Math.max(hp, 0))}
          {"♡".repeat(Math.max(3 - hp, 0))}
        </div>
      </div>
      <div>
        <div className="hud-panels">
          <SectorPanel
            title="@observable({ equals: structuralEquals })"
            note="written every tick — re-renders only on a real cell change"
            ov={player.sector$}
          />
          <SectorPanel
            title="@observable (default ===)"
            note="the same writes — every fresh Vector counts as a change"
            ov={channel(player, "sectorNaive")}
          />
        </div>
        <div className="hud-help">
          WASD / arrows to move — grab gems, dodge the chaser
        </div>
      </div>
    </div>
  );
}
