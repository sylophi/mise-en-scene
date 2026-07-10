import { ObservableValue } from "@mise/core";
import type { ShapeCastHit } from "@mise/physics";

/** Observable bridge between the simulation and the React control panel. */
export class LabState {
  /** Last ground-check shape cast (player capsule swept down). */
  readonly groundHit$ = new ObservableValue<ShapeCastHit | null>(null);
  /** `isOnFloor` after the last moveAndSlide. */
  readonly onFloor$ = new ObservableValue(false);
  /** Labels of the objects under the last pointer click. */
  readonly inspected$ = new ObservableValue<readonly string[]>([]);
}
