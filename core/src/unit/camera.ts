import { ObservableValue } from "../primitives/observable-value.ts";
import { Unit2D, type Unit2DProps } from "./unit2d.ts";

export interface CameraProps extends Unit2DProps {
  /** Logical viewport width in camera units (a design resolution). */
  width: number;
  /** Logical viewport height in camera units. */
  height: number;
}

/**
 * Defines the logical coordinate space the world is viewed through. A `Unit2D`,
 * so it can be parented, moved, and animated like anything else.
 *
 * Rendering applies the inverse of the camera's world transform to the scene,
 * then normalizes by `width`/`height`. The render surface locks to this aspect
 * ratio. Coordinate space is origin top-left, y-down.
 *
 * Only one camera is active at a time; the active one is held by the engine.
 */
export class Camera extends Unit2D {
  /** Logical viewport width in camera units. Assignment fires `width$`. */
  readonly width$: ObservableValue<number>;
  get width(): number {
    return this.width$.get();
  }
  set width(v: number) {
    this.width$.set(v);
  }

  /** Logical viewport height in camera units. Assignment fires `height$`. */
  readonly height$: ObservableValue<number>;
  get height(): number {
    return this.height$.get();
  }
  set height(v: number) {
    this.height$.set(v);
  }

  constructor(props: CameraProps) {
    super(props);
    this.width$ = new ObservableValue(props.width);
    this.height$ = new ObservableValue(props.height);
  }

  /** Aspect ratio (width / height) the render surface should lock to. */
  get aspect(): number {
    return this.width / this.height;
  }
}
