import {
  Camera,
  ObservableValue,
  Unit,
  Vector,
  clamp,
  mes,
  type CameraProps,
  type Unit2DProps,
  type UnitProps,
} from "@mise/core";
import { Renderable } from "@mise/react";

// ── Tuning ───────────────────────────────────────────────────────────────────

/** World bounds, centered on the origin (camera units). */
export const ARENA = { w: 320, h: 180 };
const VIEW = { w: 160, h: 90 }; // the camera sees a quarter of the arena
const SPAWN_BATCH = 250;

const PLAYER_ACCEL = 320;
const PLAYER_SPEED = 90;
const PLAYER_FRICTION = 3;

const clampToArena = (p: Vector, margin: number): Vector =>
  new Vector(
    clamp(p.x, -ARENA.w / 2 + margin, ARENA.w / 2 - margin),
    clamp(p.y, -ARENA.h / 2 + margin, ARENA.h / 2 - margin),
  );

// ── Units ────────────────────────────────────────────────────────────────────

/** The ship you steer through the swarm. WASD / arrow keys. */
export class Player extends Renderable {
  private vel = Vector.zero;

  override tick(dt: number): void {
    const { input } = this.engine;
    const held = (a: string, b: string): number =>
      input.isDown(a) || input.isDown(b) ? 1 : 0;
    const dir = new Vector(
      held("d", "ArrowRight") - held("a", "ArrowLeft"),
      held("s", "ArrowDown") - held("w", "ArrowUp"),
    );
    if (dir.lengthSquared() > 0) {
      this.vel = this.vel.add(dir.normalize().scale(PLAYER_ACCEL * dt));
    }
    this.vel = this.vel.scale(Math.exp(-PLAYER_FRICTION * dt));
    const speed = this.vel.length();
    if (speed > PLAYER_SPEED) this.vel = this.vel.scale(PLAYER_SPEED / speed);
    this.position = clampToArena(this.position.add(this.vel.scale(dt)), 3);
    if (speed > 5) this.rotation = this.vel.angle();
  }

  readonly component = (_props: { unit: Player }) => <div className="player" />;
}

interface ChaserProps extends Unit2DProps {
  target: Player;
  seed: number;
}

/**
 * One swarm particle: seeks the player with a per-unit tangential swirl, so the
 * swarm orbits and folds instead of collapsing into a line. Every fixed tick it
 * writes `position` *and* `rotation` — two channel fires per unit per tick,
 * exactly the flood the batched flush and transform cache are for.
 */
export class Chaser extends Renderable<ChaserProps> {
  /** Stable per-unit style inputs, derived from the spawn seed. */
  readonly hue: number;
  readonly size: number;
  private readonly swirl: number;
  private readonly maxSpeed: number;
  private readonly spin: number;
  private vel = Vector.zero;

  constructor(props: ChaserProps) {
    super(props);
    const { seed } = props;
    this.hue = 160 + seed * 160; // teal → violet
    this.size = 1.2 + seed * 1.2;
    this.swirl = (seed - 0.5) * 1.6;
    this.maxSpeed = 26 + seed * 30;
    this.spin = (seed - 0.5) * 8;
  }

  /** External impulse (the shockwave). */
  kick(impulse: Vector): void {
    this.vel = this.vel.add(impulse);
  }

  override tick(dt: number): void {
    const to = this.props.target.position.sub(this.position);
    const dist = to.length();
    if (dist > 0.001) {
      const seek = to.scale(1 / dist);
      const swirl = new Vector(-seek.y, seek.x).scale(this.swirl);
      this.vel = this.vel.add(seek.add(swirl).scale(60 * dt));
      // Brush-off: the player plows through the swarm instead of being buried.
      if (dist < 6) this.vel = this.vel.sub(seek.scale(400 * dt));
    }
    const speed = this.vel.length();
    if (speed > this.maxSpeed) {
      this.vel = this.vel.scale(this.maxSpeed / speed);
    }
    this.position = clampToArena(this.position.add(this.vel.scale(dt)), 1);
    this.rotation += this.spin * dt;
  }

  readonly component = ({ unit }: { unit: Chaser }) => (
    <div
      className="chaser"
      style={{
        width: `calc(${unit.size} * var(--u))`,
        height: `calc(${unit.size} * var(--u))`,
        background: `hsl(${unit.hue} 85% 62%)`,
      }}
    />
  );
}

interface SwarmProps extends UnitProps {
  target: Player;
  initial: number;
}

/** Spawner and crowd control: E spawns, Q culls, Space shockwaves. */
export class Swarm extends Unit<SwarmProps> {
  /** Live chaser count, for the HUD. */
  readonly count$ = new ObservableValue(0);

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    if (this.children.length === 0) this.spawn(this.props.initial);
  }

  spawn(n: number): void {
    const { target } = this.props;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 60 + Math.random() * 110;
      this.addChild(
        new Chaser({
          target,
          seed: Math.random(),
          position: clampToArena(
            target.position.add(Vector.fromAngle(angle, radius)),
            2,
          ),
        }),
      );
    }
    this.count$.set(this.children.length);
  }

  despawn(n: number): void {
    for (const c of this.children.slice(-n)) c.destroy();
    this.count$.set(this.children.length);
  }

  override tick(_dt: number): void {
    const { input } = this.engine;
    if (input.justPressed("e")) this.spawn(SPAWN_BATCH);
    if (input.justPressed("q")) this.despawn(SPAWN_BATCH);
    if (input.justPressed(" ")) this.shockwave();
  }

  private shockwave(): void {
    const center = this.props.target.position;
    for (const c of this.children) {
      if (!(c instanceof Chaser)) continue;
      const away = c.position.sub(center);
      const falloff = Math.max(0, 1 - away.length() / 90);
      if (falloff > 0) c.kick(away.normalize().scale(200 * falloff));
    }
  }
}

/** Frame counter on the device clock, published ~4x/s to keep the HUD cheap. */
export class FpsMeter extends Unit {
  readonly fps$ = new ObservableValue(0);
  private frames = 0;
  private elapsed = 0;

  override deviceTick(dt: number): void {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= 0.25) {
      this.fps$.set(Math.round(this.frames / this.elapsed));
      this.frames = 0;
      this.elapsed = 0;
    }
  }
}

interface GameCameraProps extends CameraProps {
  target: Player;
}

/** Follows the player; smoothing and limits do the rest. */
class GameCamera extends Camera<GameCameraProps> {
  override tick(): void {
    this.position = this.props.target.position;
  }
}

/** The arena border, so the world's edges are visible. */
class Arena extends Renderable {
  readonly component = (_props: { unit: Arena }) => (
    <div
      className="arena"
      style={{
        width: `calc(${ARENA.w} * var(--u))`,
        height: `calc(${ARENA.h} * var(--u))`,
      }}
    />
  );
}

// ── Scene ────────────────────────────────────────────────────────────────────

export interface Level {
  scene: Unit;
  swarm: Swarm;
  fps: FpsMeter;
}

export function buildLevel(initial: number): Level {
  const player = mes(Player, { position: Vector.zero });
  const swarm = mes(Swarm, { target: player, initial });
  const fps = mes(FpsMeter, {});
  const scene = mes(Unit, {}, [
    mes(Arena, { z: -1 }),
    player,
    swarm,
    fps,
    mes(GameCamera, {
      target: player,
      width: VIEW.w,
      height: VIEW.h,
      smoothing: 4,
      limits: {
        left: -ARENA.w / 2,
        right: ARENA.w / 2,
        top: -ARENA.h / 2,
        bottom: ARENA.h / 2,
      },
    }),
  ]);
  return { scene, swarm, fps };
}
