// Reactive primitives
export { Vector } from "./primitives/vector.ts";
export { Matrix2D } from "./primitives/matrix2d.ts";
export { ObservableEvent, type Unsub } from "./primitives/observable-event.ts";
export {
  ObservableValue,
  structuralEquals,
  type ObservableValueOptions,
} from "./primitives/observable-value.ts";
export { observable, channel } from "./primitives/observable.ts";
export { clamp, lerp, damp } from "./primitives/math.ts";

// Units
export { Unit, type UnitProps } from "./unit/unit.ts";
export { Unit2D, type Unit2DProps, type Transform } from "./unit/unit2d.ts";
export { Camera, type CameraProps, type CameraLimits } from "./unit/camera.ts";
export { Root } from "./unit/root.ts";
export { UnitRef, unitRef } from "./unit/unit-ref.ts";
export { Cooldown } from "./unit/cooldown.ts";

// Engine
export { Engine, type EngineOptions } from "./engine/engine.ts";

// Input
export { Input, type KeyInput, type PointerInput } from "./input/input.ts";

// Scene composition
export { mes, type MesOptions } from "./scene/mes.ts";
