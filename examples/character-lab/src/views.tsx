import { ObservableValue, Vector } from "@mise/core";
import { Renderable, useObservable, type RenderableProps } from "@mise/react";
import type { CSSProperties } from "react";
import type { LabState } from "./lab-state.ts";

/** World units → CSS length (the compositor provides `--u` px per unit). */
export const u = (n: number): string => `calc(${n} * var(--u))`;

export interface BoxProps extends RenderableProps {
  w: number;
  h: number;
  color: string;
  rounded?: number;
}

/** A `w`×`h` world-unit rectangle centered on the unit. Flashes on inspect. */
export class Box extends Renderable<BoxProps> {
  readonly w: number;
  readonly h: number;
  readonly color: string;
  readonly rounded: number;
  readonly flash$ = new ObservableValue(0);

  constructor(props: BoxProps) {
    super(props);
    this.w = props.w;
    this.h = props.h;
    this.color = props.color;
    this.rounded = props.rounded ?? 0;
  }

  flash(): void {
    this.flash$.set(this.flash$.get() + 1);
  }

  readonly component = ({ unit }: { unit: Box }) => {
    const flash = useObservable(unit.flash$);
    const style: CSSProperties = {
      width: u(unit.w),
      height: u(unit.h),
      transform: "translate(-50%, -50%)",
      background: unit.color,
      borderRadius: u(unit.rounded),
      animation: flash > 0 ? "lab-flash 0.6s ease-out" : undefined,
    };
    return <div key={flash} style={style} />;
  };
}

const OFFSCREEN = new Vector(-1000, -1000);

export interface GroundMarkerProps extends RenderableProps {
  lab: LabState;
}

/** Sits at the witness point of the player's ground-check shape cast. */
export class GroundMarker extends Renderable<GroundMarkerProps> {
  private readonly lab: LabState;

  constructor(props: GroundMarkerProps) {
    super(props);
    this.lab = props.lab;
  }

  override tick(): void {
    const hit = this.lab.groundHit$.get();
    this.position = hit ? hit.point : OFFSCREEN;
  }

  readonly component = ({ unit: _unit }: { unit: GroundMarker }) => (
    <div
      style={{
        width: u(2),
        height: u(2),
        transform: "translate(-50%, -50%)",
        borderRadius: "50%",
        border: `${u(0.35)} solid #ffd166`,
        background: "rgba(255, 209, 102, 0.25)",
      }}
    />
  );
}
