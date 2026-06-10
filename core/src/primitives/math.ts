/** Clamp `v` into `[min, max]`. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Linear interpolation from `a` to `b` by `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Framerate-independent exponential approach from `a` toward `b`.
 *
 * `lambda` is the approach rate per second: higher is snappier (≈ the
 * reciprocal of the time constant). Equivalent to `lerp(a, b, k)` with
 * `k = 1 - e^(-lambda * dt)`, which converges identically regardless of how
 * `dt` is sliced.
 */
export function damp(a: number, b: number, lambda: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}
