import { Unit2D, type Unit2DProps, ObservableValue } from "@mise/core";
import type { ReactNode } from "react";

/** A view function for a renderable. Receives the unit instance as its only prop. */
export type RenderableView<T extends Renderable> = (props: {
  unit: T;
}) => ReactNode;

export interface RenderableProps extends Unit2DProps {
  /** Z layer (integer, default 0). Layers stack first; tree order breaks ties. */
  z?: number;
}

/**
 * A `Unit2D` that draws via a React component. The `component` is typed to the
 * subclass (via the polymorphic `this` type), so it gets a fully-typed `unit`.
 * It is position-agnostic — the compositor places it.
 */
export abstract class Renderable extends Unit2D {
  /** The view. Defined by each subclass; receives `{ unit: this }`. */
  abstract readonly component: RenderableView<this>;

  /** Z layer. Draw order sorts by layer first, tree order within a layer. */
  readonly z: ObservableValue<number>;

  constructor(props: RenderableProps = {}) {
    super(props);
    this.z = new ObservableValue(props.z ?? 0);
  }
}
