import { Unit2D, type Unit2DProps, ObservableValue } from "@sylophi/mise-core";
import type { ReactNode } from "react";

/** A view function for a renderable. Receives the unit instance as its only prop. */
// oxlint-disable-next-line no-explicit-any -- `any` keeps the self-referential
// `component: RenderableView<this>` valid for every props parameterization.
export type RenderableView<T extends Renderable<any>> = (props: {
  unit: T;
}) => ReactNode;

export interface RenderableProps extends Unit2DProps {
  /** Z layer (integer, default 0). Layers stack first; tree order breaks ties. */
  z?: number;
}

/**
 * A `Unit2D` that draws via a React component. The `component` is typed to the
 * subclass (via the polymorphic `this` type), so it gets a fully-typed `unit`.
 * It is position-agnostic; the compositor places it.
 */
export abstract class Renderable<
  P extends RenderableProps = RenderableProps,
> extends Unit2D<P> {
  /** The view. Defined by each subclass; receives `{ unit: this }`. */
  abstract readonly component: RenderableView<this>;

  /** Channel behind `z`. The compositor subscribes to this. */
  readonly z$: ObservableValue<number>;

  /** Z layer. Draw order sorts by layer first, tree order within a layer. */
  get z(): number {
    return this.z$.get();
  }
  set z(v: number) {
    this.z$.set(v);
  }

  constructor(props?: NoInfer<P>) {
    super(props);
    this.z$ = new ObservableValue(props?.z ?? 0);
  }
}
