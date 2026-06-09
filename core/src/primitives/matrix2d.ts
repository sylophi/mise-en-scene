import { Vector } from "./vector.ts";

/**
 * Immutable 2x3 affine matrix, in CSS `matrix(a, b, c, d, tx, ty)` order:
 *
 *     x' = a*x + c*y + tx
 *     y' = b*x + d*y + ty
 *
 * The world-transform representation. Unlike a position/rotation/scale triple,
 * a matrix composes exactly: non-uniform scale under rotation produces shear,
 * which only a matrix can hold.
 */
export class Matrix2D {
  constructor(
    readonly a: number,
    readonly b: number,
    readonly c: number,
    readonly d: number,
    readonly tx: number,
    readonly ty: number,
  ) {}

  /** Build translate · rotate · scale from TRS components. */
  static fromTRS(position: Vector, rotation: number, scale: Vector): Matrix2D {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return new Matrix2D(
      cos * scale.x,
      sin * scale.x,
      -sin * scale.y,
      cos * scale.y,
      position.x,
      position.y,
    );
  }

  /** Compose: `this · m` (apply `m` to a point first, then `this`). */
  multiply(m: Matrix2D): Matrix2D {
    return new Matrix2D(
      this.a * m.a + this.c * m.b,
      this.b * m.a + this.d * m.b,
      this.a * m.c + this.c * m.d,
      this.b * m.c + this.d * m.d,
      this.a * m.tx + this.c * m.ty + this.tx,
      this.b * m.tx + this.d * m.ty + this.ty,
    );
  }

  /** Inverse transform. Undefined behavior at zero determinant (zero scale). */
  invert(): Matrix2D {
    const det = this.a * this.d - this.b * this.c;
    const ia = this.d / det;
    const ib = -this.b / det;
    const ic = -this.c / det;
    const id = this.a / det;
    return new Matrix2D(
      ia,
      ib,
      ic,
      id,
      -(ia * this.tx + ic * this.ty),
      -(ib * this.tx + id * this.ty),
    );
  }

  /** Transform a point. */
  apply(v: Vector): Vector {
    return new Vector(
      this.a * v.x + this.c * v.y + this.tx,
      this.b * v.x + this.d * v.y + this.ty,
    );
  }

  toString(): string {
    return `Matrix2D(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.tx}, ${this.ty})`;
  }

  static readonly identity = new Matrix2D(1, 0, 0, 1, 0, 0);
}
