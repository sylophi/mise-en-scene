import type { Engine } from "../engine/engine.ts";
import { Unit, type UnitProps } from "./unit.ts";

/**
 * The structural unit at the top of the tree and the origin of the engine binding.
 * Created and held by the {@link Engine}.
 *
 * It is a `Unit` (it lives in the tree and ticks like any other), but not a
 * `Unit2D` — it has no transform, so it naturally acts as a transform origin.
 */
export class Root extends Unit {
  constructor(props: UnitProps = {}) {
    super(props);
  }

  /** Bind this root (and its current subtree) to an engine. */
  setEngine(engine: Engine): void {
    this.propagateEngine(engine);
  }
}
