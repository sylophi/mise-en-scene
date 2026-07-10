import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Camera, Engine, Vector } from "@mise/core";
import { MiseProvider, preload, useObservable } from "@mise/react";
import { ASSET_URLS, HEART_URL } from "./assets.ts";
import {
  COIN_TOTAL,
  WORLD,
  buildLevel,
  playerRef,
  type Player,
} from "./level.tsx";

// The engine lives at module scope: it runs (and self-starts) independently
// of React, which also keeps StrictMode double-mounts from creating two.
const engine = new Engine();
// A camera's position is the *center* of its view: park it mid-world so the
// level's 0..width x 0..height space fills the stage.
const camera = new Camera({
  width: WORLD.width,
  height: WORLD.height,
  position: new Vector(WORLD.width / 2, WORLD.height / 2),
});
engine.root.addChild(camera);
engine.activeCamera = camera;

// Like the engine, the preload task is hoisted to module scope: it starts
// once, so StrictMode double-mounts can't re-issue loads.
const assets = preload(ASSET_URLS);

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "1rem",
  color: "#dce3ea",
  background: "#101418",
};

function LoadingScreen({ progress }: { progress: number }): ReactNode {
  return (
    <div style={overlayStyle}>
      <div style={{ fontSize: "1.1rem", letterSpacing: "0.1em" }}>LOADING</div>
      <div
        style={{
          width: "min(60vw, 24rem)",
          height: "0.9rem",
          border: "1px solid #3a4654",
          borderRadius: "0.45rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${progress * 100}%`,
            height: "100%",
            background: "#f5c542",
            transition: "width 120ms linear",
          }}
        />
      </div>
      <div style={{ opacity: 0.6 }}>{Math.round(progress * 100)}%</div>
    </div>
  );
}

function Score({ player }: { player: Player }): ReactNode {
  const score = useObservable(player.score$);
  const done = score >= COIN_TOTAL;
  return (
    <div
      style={{
        position: "fixed",
        top: "1rem",
        left: "1rem",
        color: "#f5c542",
        fontSize: "1.2rem",
        textShadow: "0 1px 2px #000",
      }}
    >
      Coins: {score} / {COIN_TOTAL}
      {done && (
        <span style={{ color: "#dce3ea" }}>
          {" — all collected! "}
          <img
            src={HEART_URL}
            alt="heart"
            style={{ height: "1em", imageRendering: "pixelated" }}
          />
        </span>
      )}
    </div>
  );
}

function Hud(): ReactNode {
  const player = useObservable(playerRef.current$);
  return (
    <>
      {player && <Score player={player} />}
      <div
        style={{
          position: "fixed",
          bottom: "1rem",
          left: "1rem",
          color: "#8b98a5",
        }}
      >
        WASD / arrows to move
      </div>
    </>
  );
}

export function App(): ReactNode {
  const progress = useObservable(assets.progress$);
  const done = useObservable(assets.done$);

  // Mount the level once everything is warm, exactly once.
  const started = useRef(false);
  useEffect(() => {
    if (!done || started.current) return;
    started.current = true;
    const errors = assets.errors$.get();
    if (errors.length > 0) {
      console.warn("some assets failed to preload:", errors);
    }
    engine.changeScene(buildLevel());
  }, [done]);

  return (
    <MiseProvider engine={engine}>
      {done ? <Hud /> : <LoadingScreen progress={progress} />}
    </MiseProvider>
  );
}
