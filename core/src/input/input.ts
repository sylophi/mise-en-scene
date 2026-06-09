import { Observable } from "../primitives/observable.ts";
import { ObservableValue } from "../primitives/observable-value.ts";
import { Vector } from "../primitives/vector.ts";

/** Neutral key event payload (not a DOM event). */
export interface KeyEvent {
  key: string;
}

/** Neutral pointer event payload (not a DOM event). Position is in camera coords. */
export interface PointerEvent {
  position: Vector;
  button?: number;
}

/**
 * Headless input manager, exposed as `engine.input`. Offers both event
 * (`Observable`) and polling styles. A renderer/adapter feeds it real device
 * events via the `feed*` methods; game code reads it. No DOM here.
 */
export class Input {
  // Events
  readonly onKeyDown = new Observable<KeyEvent>();
  readonly onKeyUp = new Observable<KeyEvent>();
  readonly onPointerDown = new Observable<PointerEvent>();
  readonly onPointerUp = new Observable<PointerEvent>();
  readonly onPointerMove = new Observable<PointerEvent>();

  /** Pointer position in camera coordinates. */
  readonly pointer = new ObservableValue<Vector>(Vector.zero);

  private down = new Set<string>();
  private prevDown = new Set<string>();
  private buttons = new Set<number>();

  // ── Polling ──────────────────────────────────────────────────────────────

  isDown(key: string): boolean {
    return this.down.has(key);
  }

  /** True only on the tick the key transitioned to down. */
  justPressed(key: string): boolean {
    return this.down.has(key) && !this.prevDown.has(key);
  }

  /** True only on the tick the key transitioned to up. */
  justReleased(key: string): boolean {
    return !this.down.has(key) && this.prevDown.has(key);
  }

  isButtonDown(button: number): boolean {
    return this.buttons.has(button);
  }

  // ── Feed API (called by the adapter, not game code) ───────────────────────

  feedKeyDown(key: string): void {
    if (this.down.has(key)) return; // ignore auto-repeat
    this.down.add(key);
    this.onKeyDown.fire({ key });
  }

  feedKeyUp(key: string): void {
    if (!this.down.has(key)) return;
    this.down.delete(key);
    this.onKeyUp.fire({ key });
  }

  feedPointerMove(position: Vector): void {
    this.pointer.set(position);
    this.onPointerMove.fire({ position });
  }

  feedPointerDown(button: number, position?: Vector): void {
    this.buttons.add(button);
    this.onPointerDown.fire({
      position: position ?? this.pointer.get(),
      button,
    });
  }

  feedPointerUp(button: number, position?: Vector): void {
    this.buttons.delete(button);
    this.onPointerUp.fire({ position: position ?? this.pointer.get(), button });
  }

  /** Called by the engine at each tick boundary to roll over just-pressed state. */
  advanceTick(): void {
    this.prevDown = new Set(this.down);
  }
}
