/**
 * A reusable "can I act again yet?" gate, created via `unit.cooldown(duration)`.
 *
 * Advances on the owning unit's fixed-tick clock (the engine drives it), so it
 * freezes while the unit is off-tree and in headless tests it steps exactly
 * with `advanceFixed`. Starts ready.
 */
export class Cooldown {
  private _remaining = 0;

  /** `duration` may be omitted when every `start(d)` passes its own. */
  constructor(private readonly duration = 0) {}

  /** True when the cooldown has fully elapsed (or was never started). */
  get ready(): boolean {
    return this._remaining <= 0;
  }

  /** Seconds left until ready. 0 when ready. */
  get remaining(): number {
    return this._remaining > 0 ? this._remaining : 0;
  }

  /** Restart the cooldown, optionally with a one-off duration. */
  start(duration = this.duration): void {
    this._remaining = duration;
  }

  /** Make the cooldown ready immediately. */
  reset(): void {
    this._remaining = 0;
  }

  /** Advance by `dt` seconds. Called by the owning unit; not game API. */
  advance(dt: number): void {
    if (this._remaining > 0) this._remaining -= dt;
  }
}
