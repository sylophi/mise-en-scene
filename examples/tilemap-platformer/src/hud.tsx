import type { CSSProperties, ReactNode } from "react";
import { useObservable } from "@mise/react";
import { won$ } from "./game.tsx";

const hudStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  pointerEvents: "none",
  fontFamily: "system-ui, sans-serif",
  color: "white",
};

export function Hud({ onRestart }: { onRestart: () => void }): ReactNode {
  const won = useObservable(won$);
  return (
    <div style={hudStyle}>
      <div
        style={{
          position: "absolute",
          left: 14,
          bottom: 12,
          fontSize: 13,
          opacity: 0.75,
          textShadow: "0 1px 2px rgba(0,0,0,0.6)",
        }}
      >
        A/D or arrows to run, Space to jump. Reach the flag.
      </div>
      {won && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            background: "rgba(10, 12, 24, 0.55)",
            pointerEvents: "auto",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 34, marginBottom: 14 }}>
              You reached the flag!
            </div>
            <button
              onClick={onRestart}
              style={{
                font: "inherit",
                fontSize: 16,
                padding: "10px 22px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background: "#f0ba30",
                color: "#221a05",
              }}
            >
              Play again (R)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
