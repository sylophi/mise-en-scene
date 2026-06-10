/**
 * Immutable 2-component vector. Shared for position and scale.
 * Every method returns a new `Vector`; instances are never mutated.
 */
export class Vector {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  /** Vector addition. */
  add(v: Vector): Vector {
    return new Vector(this.x + v.x, this.y + v.y);
  }

  /** Vector subtraction. */
  sub(v: Vector): Vector {
    return new Vector(this.x - v.x, this.y - v.y);
  }

  /** Multiply by a scalar. */
  scale(s: number): Vector {
    return new Vector(this.x * s, this.y * s);
  }

  /** Component-wise (Hadamard) product. Used to compose scale. */
  mul(v: Vector): Vector {
    return new Vector(this.x * v.x, this.y * v.y);
  }

  /** Rotate around the origin by `rad` radians. */
  rotate(rad: number): Vector {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    return new Vector(this.x * c - this.y * s, this.x * s + this.y * c);
  }

  /** Dot product → scalar. */
  dot(v: Vector): number {
    return this.x * v.x + this.y * v.y;
  }

  /** 2D cross product → scalar (`x*v.y - y*v.x`). */
  cross(v: Vector): number {
    return this.x * v.y - this.y * v.x;
  }

  /** Euclidean length. */
  length(): number {
    return Math.hypot(this.x, this.y);
  }

  /** Squared length: avoids the sqrt when only comparing magnitudes. */
  lengthSquared(): number {
    return this.x * this.x + this.y * this.y;
  }

  /** Unit vector in the same direction. The zero vector normalizes to zero. */
  normalize(): Vector {
    const len = this.length();
    return len === 0 ? Vector.zero : new Vector(this.x / len, this.y / len);
  }

  equals(v: Vector): boolean {
    return this.x === v.x && this.y === v.y;
  }

  toString(): string {
    return `Vector(${this.x}, ${this.y})`;
  }

  static readonly zero = new Vector(0, 0);
  static readonly one = new Vector(1, 1);
}
