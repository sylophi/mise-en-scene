import { ObservableEvent } from "../primitives/observable-event.ts";
import { ObservableValue } from "../primitives/observable-value.ts";
import { Vector } from "../primitives/vector.ts";

/** Neutral key payload (not a DOM event; doesn't shadow DOM types). */
export interface KeyInput {
  key: string;
}

/**
 * Keys identify the physical key, not the produced character: single-character
 * keys are lowercased so `"j"` and Shift's `"J"` are the same key (and a key
 * held across a Shift press/release can't get stuck down). Named keys
 * (`"ArrowUp"`, `"Enter"`) pass through unchanged.
 */
const normalizeKey = (key: string): string =>
  key.length === 1 ? key.toLowerCase() : key;

/** Neutral pointer payload (not a DOM event). Position is in world coords. */
export interface PointerInput {
  position: Vector;
  button?: number;
}

/**
 * Headless input manager, exposed as `engine.input`. Offers both event
 * (`ObservableEvent`) and polling styles. A renderer/adapter feeds it real device
 * events via the `feed*` methods; game code reads it. No DOM here.
 */
export class Input {
  // Events
  readonly onKeyDown = new ObservableEvent<KeyInput>();
  readonly onKeyUp = new ObservableEvent<KeyInput>();
  readonly onPointerDown = new ObservableEvent<PointerInput>();
  readonly onPointerUp = new ObservableEvent<PointerInput>();
  readonly onPointerMove = new ObservableEvent<PointerInput>();

  /** Channel behind `pointer`. Subscribe to this. */
  readonly pointer$ = new ObservableValue<Vector>(Vector.zero);

  /** Pointer position in world coordinates. Fed by the adapter, so read-only. */
  get pointer(): Vector {
    return this.pointer$.get();
  }

  private down = new Set<string>();
  private prevDown = new Set<string>();
  private buttons = new Set<number>();

  // ── Polling ──────────────────────────────────────────────────────────────

  isDown(key: string): boolean {
    return this.down.has(normalizeKey(key));
  }

  /** True only on the tick the key transitioned to down. */
  justPressed(key: string): boolean {
    const k = normalizeKey(key);
    return this.down.has(k) && !this.prevDown.has(k);
  }

  /** True only on the tick the key transitioned to up. */
  justReleased(key: string): boolean {
    const k = normalizeKey(key);
    return !this.down.has(k) && this.prevDown.has(k);
  }

  isButtonDown(button: number): boolean {
    return this.buttons.has(button);
  }

  // ── Feed API (called by the adapter, not game code) ───────────────────────

  feedKeyDown(key: string): void {
    const k = normalizeKey(key);
    if (this.down.has(k)) return; // ignore auto-repeat
    this.down.add(k);
    this.onKeyDown.fire({ key: k });
  }

  feedKeyUp(key: string): void {
    const k = normalizeKey(key);
    if (!this.down.has(k)) return;
    this.down.delete(k);
    this.onKeyUp.fire({ key: k });
  }

  feedPointerMove(position: Vector): void {
    this.pointer$.set(position);
    this.onPointerMove.fire({ position });
  }

  feedPointerDown(button: number, position?: Vector): void {
    this.buttons.add(button);
    this.onPointerDown.fire({ position: position ?? this.pointer, button });
  }

  feedPointerUp(button: number, position?: Vector): void {
    this.buttons.delete(button);
    this.onPointerUp.fire({ position: position ?? this.pointer, button });
  }

  /** Called by the engine at each tick boundary to roll over just-pressed state. */
  advanceTick(): void {
    this.prevDown = new Set(this.down);
  }
}
