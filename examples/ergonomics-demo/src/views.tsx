import { channel } from "@mise/core";
import { useObservable } from "@mise/react";
import type { ReactNode } from "react";
import type { Chaser, Gem, Player } from "./units.ts";

// Views are position-agnostic: the compositor places them, they draw
// appearance at the origin in camera units via var(--u). Each subscribes only
// to the channels it reads.

export function PlayerView({ unit }: { unit: Player }): ReactNode {
  const shielded = useObservable(unit.shielded$); // declared channel
  return <div className={shielded ? "player shielded" : "player"} />;
}

export function GemView({ unit }: { unit: Gem }): ReactNode {
  const glow = useObservable(channel(unit, "glow")); // channel() helper style
  return <div className={glow ? "gem glow" : "gem"} />;
}

export function ChaserView({ unit }: { unit: Chaser }): ReactNode {
  const enraged = useObservable(unit.enraged$);
  return <div className={enraged ? "chaser enraged" : "chaser"} />;
}
