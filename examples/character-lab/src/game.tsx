import { Camera, Engine, Unit, Vector, mes } from "@mise/core";
import {
  CharacterBody2D,
  CollisionShape2D,
  PhysicsWorld2D,
  StaticBody2D,
  capsule,
  rect,
  type CharacterBody2DProps,
  type CollisionObject2DProps,
} from "@mise/physics";
import { LabState } from "./lab-state.ts";
import { Box, GroundMarker } from "./views.tsx";

const GRAVITY = 220;
const SPEED = 38;
const JUMP = -95;
/** Downward press kept while grounded, so snap-to-ground can engage. */
const GROUND_PRESS = 15;
const SPAWN = new Vector(85, 55);

/** The player capsule, also swept downward as the ground check. */
const PLAYER_SHAPE = capsule(2, 1.5);
const DOWN = new Vector(0, 1);

// ── Units ─────────────────────────────────────────────────────────────────────

interface PlatformProps extends CollisionObject2DProps {
  label: string;
}

/** A static slab with a human-readable label for the click inspector. */
export class Platform extends StaticBody2D<PlatformProps> {
  readonly label: string;

  constructor(props: PlatformProps) {
    super(props);
    this.label = props.label;
  }
}

interface PlayerProps extends CharacterBody2DProps {
  lab: LabState;
}

export class Player extends CharacterBody2D<PlayerProps> {
  private readonly lab: LabState;
  private vy = 0;

  constructor(props: PlayerProps) {
    super(props);
    this.lab = props.lab;
  }

  override tick(dt: number): void {
    const input = this.engine.input;
    const dir =
      (input.isDown("d") || input.isDown("ArrowRight") ? 1 : 0) -
      (input.isDown("a") || input.isDown("ArrowLeft") ? 1 : 0);

    this.vy += GRAVITY * dt;
    if (this.isOnFloor) {
      const jump =
        input.justPressed(" ") ||
        input.justPressed("w") ||
        input.justPressed("ArrowUp");
      this.vy = jump ? JUMP : Math.min(this.vy, GROUND_PRESS);
    }
    this.moveAndSlide(new Vector(dir * SPEED, this.vy), dt);

    if (input.justPressed("r") || this.position.y > 140) {
      this.position = SPAWN;
      this.vy = 0;
    }

    // Publish panel state: grounded flag and a ground-check shape cast (the
    // player's own capsule swept straight down).
    this.lab.onFloor$.set(this.isOnFloor);
    const hit =
      this.physicsWorld?.castShape(PLAYER_SHAPE, this.position, 0, DOWN, 60, {
        exclude: this,
      }) ?? null;
    this.lab.groundHit$.set(hit);
  }
}

// ── Level ─────────────────────────────────────────────────────────────────────

const platform = (
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { rotation?: number; color?: string } = {},
): Unit =>
  mes(
    Platform,
    { label, position: new Vector(x, y), rotation: opts.rotation ?? 0 },
    [
      mes(CollisionShape2D, { shape: rect(w, h) }),
      mes(Box, { w, h, color: opts.color ?? "#3b4254" }),
    ],
  );

/**
 * A ramp rising to the left at `deg` degrees, whose top surface meets the
 * ground (y=70) at `footX`.
 */
const ramp = (deg: number, footX: number, len: number, color: string): Unit => {
  const a = (deg * Math.PI) / 180;
  const t = 6; // slab thickness
  // Surface center: half the length up-slope from the foot. Body center: half
  // the thickness into the slab, along its rotated +y axis.
  const sx = footX - (len / 2) * Math.cos(a);
  const sy = 70 - (len / 2) * Math.sin(a);
  return platform(
    `ramp (${deg}°)`,
    sx + (t / 2) * -Math.sin(a),
    sy + (t / 2) * Math.cos(a),
    len,
    t,
    { rotation: a, color },
  );
};

const buildLevel = (): Unit[] => {
  const units: Unit[] = [
    platform("ground", 80, 82, 400, 24, { color: "#2c3140" }),
    // Stairs up to the plateau: five 1.2-tall steps. Autostep material.
    ...[1, 2, 3, 4, 5].map((k) =>
      platform(`step ${k}`, 96.5 + 7 * k, 70 - 0.6 * k, 7, 1.2 * k, {
        color: "#46527a",
      }),
    ),
    platform("plateau", 150, 67, 30, 6, { color: "#3f4a6e" }),
    // Slopes: the gentle one walks at the default 45° limit, the steep one
    // needs the maxSlope slider (and snap makes descending it feel right).
    ramp(24, 70, 36, "#4a5568"),
    ramp(55, 34, 26, "#6b4a5a"),
  ];
  return units;
};

// ── Assembly ──────────────────────────────────────────────────────────────────

export interface Game {
  engine: Engine;
  player: Player;
  lab: LabState;
}

export const labelFor = (unit: Unit): string => {
  if (unit instanceof Platform) return unit.label;
  if (unit instanceof Player) return "player";
  return unit.constructor.name;
};

export function createGame(): Game {
  const lab = new LabState();
  const player = mes(Player, { lab, position: SPAWN }, [
    mes(CollisionShape2D, { shape: PLAYER_SHAPE }),
    mes(Box, { w: 3, h: 7, color: "#7ee0a3", rounded: 1.5, z: 1 }),
  ]);
  const world = mes(PhysicsWorld2D, {}, [
    ...buildLevel(),
    player,
    mes(GroundMarker, { lab, z: 2 }),
    mes(Camera, { width: 160, height: 90, position: new Vector(80, 45) }),
  ]);

  const engine = new Engine();
  engine.changeScene(world);

  // Point query: click to identify (and flash) whatever is under the pointer.
  engine.input.onPointerDown.addListener(({ position }) => {
    const hits = world.pointIntersections(position, { includeAreas: true });
    lab.inspected$.set(hits.map(labelFor));
    for (const hit of hits) {
      for (const child of hit.children) {
        if (child instanceof Box) child.flash();
      }
    }
  });

  return { engine, player, lab };
}
