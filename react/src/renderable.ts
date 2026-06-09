import { Unit2D, type Unit2DProps, ObservableValue } from "@mise/core";
import type { ReactNode } from "react";

/** A view function for a renderable. Receives the unit instance as its only prop. */
export type RenderableView<T extends Renderable> = (props: {
  unit: T;
}) => ReactNode;

export interface RenderableProps extends Unit2DProps {
  /** Explicit z-order. Unset (default) uses tree order. */
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

  /** Explicit z-order override; null = use tree order. */
  readonly z = new ObservableValue<number | null>(null);

  constructor(props: RenderableProps = {}) {
    super(props);
    if (props.z !== undefined) this.z.set(props.z);
  }
}
