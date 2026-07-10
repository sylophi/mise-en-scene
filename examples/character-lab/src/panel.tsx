import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useObservable } from "@mise/react";
import type { LabState } from "./lab-state.ts";
import { labelFor, type Player } from "./game.tsx";

const panelStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  left: 12,
  width: 260,
  padding: "12px 14px",
  background: "rgba(16, 18, 24, 0.88)",
  border: "1px solid #2e3340",
  borderRadius: 8,
  fontSize: 12,
  lineHeight: 1.5,
  userSelect: "none",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  margin: "6px 0",
};

const dimStyle: CSSProperties = { color: "#8b93a7" };

function Row({
  label,
  enabled,
  onToggle,
  value,
  min,
  max,
  step,
  format,
  onValue,
}: {
  label: string;
  enabled: boolean | null; // null = no checkbox (always on)
  onToggle?: (on: boolean) => void;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onValue: (v: number) => void;
}): ReactNode {
  const active = enabled ?? true;
  return (
    <label style={rowStyle}>
      {enabled !== null && (
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle?.(e.target.checked)}
        />
      )}
      <span style={{ width: 76 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={!active}
        onChange={(e) => onValue(Number(e.target.value))}
        style={{ flex: 1 }}
      />
      <span
        style={{ width: 44, textAlign: "right", ...(active ? {} : dimStyle) }}
      >
        {format(value)}
      </span>
    </label>
  );
}

export function Panel({
  player,
  lab,
}: {
  player: Player;
  lab: LabState;
}): ReactNode {
  const [autostepOn, setAutostepOn] = useState(false);
  const [stepHeight, setStepHeight] = useState(1.5);
  const [snapOn, setSnapOn] = useState(false);
  const [snapDist, setSnapDist] = useState(1.5);
  const [slopeDeg, setSlopeDeg] = useState(45);

  const onFloor = useObservable(lab.onFloor$);
  const groundHit = useObservable(lab.groundHit$);
  const inspected = useObservable(lab.inspected$);

  useEffect(() => {
    player.autostep = autostepOn ? stepHeight : null;
  }, [player, autostepOn, stepHeight]);
  useEffect(() => {
    player.snapToGround = snapOn ? snapDist : null;
  }, [player, snapOn, snapDist]);
  useEffect(() => {
    player.maxSlope = (slopeDeg * Math.PI) / 180;
  }, [player, slopeDeg]);

  return (
    <div style={panelStyle}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>character lab</div>
      <div style={dimStyle}>A/D move · Space jump · R respawn</div>
      <div style={{ ...dimStyle, marginBottom: 8 }}>
        click anything to inspect it
      </div>

      <Row
        label="autostep"
        enabled={autostepOn}
        onToggle={setAutostepOn}
        value={stepHeight}
        min={0.2}
        max={3}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onValue={setStepHeight}
      />
      <Row
        label="snap"
        enabled={snapOn}
        onToggle={setSnapOn}
        value={snapDist}
        min={0.2}
        max={4}
        step={0.1}
        format={(v) => v.toFixed(1)}
        onValue={setSnapDist}
      />
      <Row
        label="max slope"
        enabled={null}
        value={slopeDeg}
        min={10}
        max={85}
        step={1}
        format={(v) => `${v}°`}
        onValue={setSlopeDeg}
      />

      <div
        style={{ borderTop: "1px solid #2e3340", marginTop: 8, paddingTop: 8 }}
      >
        <div style={rowStyle}>
          <span style={{ width: 100 }}>on floor</span>
          <span style={{ color: onFloor ? "#7ee0a3" : "#e0967e" }}>
            {onFloor ? "yes" : "no"}
          </span>
        </div>
        <div style={rowStyle}>
          <span style={{ width: 100 }}>ground cast</span>
          <span>
            {groundHit
              ? `${groundHit.distance.toFixed(2)} → ${labelFor(groundHit.unit)}`
              : "no hit"}
          </span>
        </div>
        <div style={rowStyle}>
          <span style={{ width: 100 }}>under pointer</span>
          <span>{inspected.length > 0 ? inspected.join(", ") : "—"}</span>
        </div>
      </div>
    </div>
  );
}
