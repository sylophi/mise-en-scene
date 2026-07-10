import { ObservableValue, Vector, type Unit } from "@mise/core";
import {
  PhysicsWorld2D,
  debugSnapshot,
  type DebugRay,
  type DebugRole,
  type DebugShape,
} from "@mise/physics";
import { Renderable, useObservable, type RenderableProps } from "@mise/react";
import type { CSSProperties, ReactNode } from "react";

export interface PhysicsDebug2DProps extends RenderableProps {
  /** The world to draw. Default: the nearest `PhysicsWorld2D` ancestor. */
  world?: PhysicsWorld2D;
  /**
   * Key that toggles the overlay, matched with `input.justPressed`. Pass null
   * to disable the built-in toggle (drive `visible` yourself). Default `` "`" ``
   * (the tilde/backquote key).
   */
  toggleKey?: string | null;
  /** Whether the overlay starts visible. Default true. */
  startVisible?: boolean;
  /** How long a recorded ray stays drawn, fading out, in seconds. Default 1. */
  rayTtl?: number;
}

/**
 * Dev-mode physics visualization: a drop-in unit that draws every collider in
 * its `PhysicsWorld2D` (color-coded by role, areas filled, bodies outlined)
 * plus recent raycasts, over the rendered game.
 *
 * It is an ordinary `Renderable`, so the compositor gives it camera tracking
 * and resolution independence for free. Place it as a direct child of the
 * `PhysicsWorld2D` (the natural spot: the world is a plain `Unit`, so the
 * transform chain resets there and the overlay's local space is world space).
 * Keep it untransformed — the SVG draws in world coordinates.
 *
 * While in the tree it enables the world's `rayLog` (restored on exit). While
 * hidden it renders nothing and does no per-frame work beyond one key check,
 * so shipping it toggled off costs effectively nothing; not mounting it costs
 * exactly nothing.
 */
export class PhysicsDebug2D extends Renderable<PhysicsDebug2DProps> {
  /** Channel behind `visible`. The view subscribes to this. */
  readonly visible$: ObservableValue<boolean>;

  /** Whether the overlay is drawn. Toggled by `toggleKey`; assignable. */
  get visible(): boolean {
    return this.visible$.get();
  }
  set visible(v: boolean) {
    this.visible$.set(v);
  }

  /** Bumped each fixed tick while visible; the view re-reads the world on it. */
  readonly frame$ = new ObservableValue(0);

  private _world: PhysicsWorld2D | null = null;
  private hadRayLog = false;

  constructor(props?: PhysicsDebug2DProps) {
    // Draw over the game by default; an explicit z prop still wins.
    super({ ...props, z: props?.z ?? 100 });
    this.visible$ = new ObservableValue(props?.startVisible ?? true);
  }

  /** The world being drawn, while in the tree. */
  get world(): PhysicsWorld2D | null {
    return this._world;
  }

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    const world = this.props.world ?? this.findAncestor(PhysicsWorld2D);
    if (!world) {
      throw new Error(
        "PhysicsDebug2D needs a PhysicsWorld2D ancestor or a `world` prop",
      );
    }
    this._world = world;
    this.hadRayLog = world.rayLog.enabled;
    world.rayLog.enabled = true;
  }

  override onTreeExit(parent: Unit | null): void {
    if (this._world) {
      this._world.rayLog.enabled = this.hadRayLog;
      this._world = null;
    }
    super.onTreeExit(parent);
  }

  override tick(_dt: number): void {
    const key = this.props.toggleKey === undefined ? "`" : this.props.toggleKey;
    if (key !== null && this.engine.input.justPressed(key)) {
      this.visible = !this.visible;
    }
    if (this.visible) this.frame$.set(this.frame$.get() + 1);
  }

  readonly component = ({ unit }: { unit: PhysicsDebug2D }): ReactNode => {
    const visible = useObservable(unit.visible$);
    useObservable(unit.frame$); // re-render per fixed tick while visible
    const world = unit.world;
    if (!visible || !world) return null;

    const now = unit.engine.time;
    const ttl = unit.props.rayTtl ?? 1;
    const shapes = debugSnapshot(world);
    const rays = world.rayLog.list().filter((r) => now - r.time <= ttl);
    const bounds = boundsOf(shapes, rays);
    if (!bounds) return null;

    // Marker sizes (hit points, normals) scale with the drawn extent so the
    // overlay looks right at any world scale.
    const marker = Math.max(bounds.w, bounds.h) * 0.008;
    return (
      <svg
        data-physics-debug=""
        viewBox={`${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}`}
        style={svgStyle(bounds)}
      >
        {shapes.map((s) => (
          <ShapeOutline key={s.handle} s={s} />
        ))}
        {rays.map((r) => (
          <RayLine
            key={r.seq}
            ray={r}
            age={now - r.time}
            ttl={ttl}
            marker={marker}
          />
        ))}
      </svg>
    );
  };
}

// ── Drawing ──────────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<DebugRole, string> = {
  static: "#7be382", // green: immovable geometry
  character: "#5ec8f8", // blue: kinematic bodies
  dynamic: "#f8a25e", // orange: simulation-driven bodies (future RigidBody2D)
  area: "#f8d84a", // yellow: sensors
};
const RAY_HIT_COLOR = "#ff5c7a";
const RAY_MISS_COLOR = "#8b93a7";

/** How far an unbounded (or absurdly long) miss is drawn, in world units. */
const RAY_DRAW_CAP = 200;

const rayEnd = (ray: DebugRay): Vector =>
  ray.hit
    ? ray.hit.point
    : ray.origin.add(
        ray.direction.scale(Math.min(ray.maxDistance, RAY_DRAW_CAP)),
      );

function ShapeOutline({ s }: { s: DebugShape }): ReactNode {
  const color = ROLE_COLORS[s.role];
  const common = {
    "data-debug-role": s.role,
    transform: `translate(${s.position.x} ${s.position.y}) rotate(${
      (s.rotation * 180) / Math.PI
    })`,
    stroke: color,
    strokeWidth: 1.5,
    vectorEffect: "non-scaling-stroke" as const,
    // Areas are regions, bodies are surfaces: fill sensors, outline the rest.
    fill: s.role === "area" ? color : "none",
    fillOpacity: s.role === "area" ? 0.15 : undefined,
  };
  const shape = s.shape;
  switch (shape.kind) {
    case "rect":
      return (
        <rect
          x={-shape.width / 2}
          y={-shape.height / 2}
          width={shape.width}
          height={shape.height}
          {...common}
        />
      );
    case "circle":
      return <circle r={shape.radius} {...common} />;
    case "capsule": {
      // A rounded rect with corner radius = capsule radius is exactly a
      // stadium: flat sides over 2*halfHeight, semicircular caps along y.
      const r = shape.radius;
      const h = shape.halfHeight + r;
      return (
        <rect x={-r} y={-h} width={r * 2} height={h * 2} rx={r} {...common} />
      );
    }
  }
}

function RayLine({
  ray,
  age,
  ttl,
  marker,
}: {
  ray: DebugRay;
  age: number;
  ttl: number;
  marker: number;
}): ReactNode {
  const end = rayEnd(ray);
  const color = ray.hit ? RAY_HIT_COLOR : RAY_MISS_COLOR;
  const stroke = {
    stroke: color,
    strokeWidth: 1.5,
    vectorEffect: "non-scaling-stroke" as const,
  };
  return (
    <g
      data-debug-ray={ray.hit ? "hit" : "miss"}
      opacity={Math.max(0.15, 1 - age / ttl)}
    >
      <line
        x1={ray.origin.x}
        y1={ray.origin.y}
        x2={end.x}
        y2={end.y}
        {...stroke}
      />
      {ray.hit && (
        <>
          <circle cx={end.x} cy={end.y} r={marker} fill={color} />
          <line
            x1={end.x}
            y1={end.y}
            x2={end.x + ray.hit.normal.x * marker * 4}
            y2={end.y + ray.hit.normal.y * marker * 4}
            {...stroke}
            stroke="#ffffff"
          />
        </>
      )}
    </g>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────

interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Conservative radius of a shape around its center (rotation-proof). */
function extentOf(shape: DebugShape["shape"]): number {
  switch (shape.kind) {
    case "rect":
      return Math.hypot(shape.width, shape.height) / 2;
    case "circle":
      return shape.radius;
    case "capsule":
      return shape.halfHeight + shape.radius;
  }
}

/** World-space box around everything drawn, padded; null when there is nothing. */
function boundsOf(
  shapes: readonly DebugShape[],
  rays: readonly DebugRay[],
): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number, r = 0): void => {
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  };
  for (const s of shapes)
    include(s.position.x, s.position.y, extentOf(s.shape));
  for (const r of rays) {
    include(r.origin.x, r.origin.y);
    const end = rayEnd(r);
    include(end.x, end.y);
  }
  if (minX === Infinity) return null;
  const pad = Math.max(maxX - minX, maxY - minY) * 0.05 + 1;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/**
 * Position the SVG at its world-space box, in camera units via `--u` — the
 * same protocol every renderable's content uses, so resize is pure CSS.
 * The viewBox equals the box, so drawing coordinates are world coordinates.
 */
function svgStyle(b: Bounds): CSSProperties {
  return {
    position: "absolute",
    left: `calc(${b.x} * var(--u))`,
    top: `calc(${b.y} * var(--u))`,
    width: `calc(${b.w} * var(--u))`,
    height: `calc(${b.h} * var(--u))`,
    overflow: "visible",
    pointerEvents: "none",
  };
}
