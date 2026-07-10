import {
  Camera,
  type CameraProps,
  clamp,
  Engine,
  mes,
  ObservableValue,
  Unit,
  type UnitProps,
  Vector,
} from "@mise/core";
import { Renderable, type RenderableProps, useObservable } from "@mise/react";

export const ARENA_W = 100;
export const ARENA_H = 56.25;
const SLOWMO = 0.3;
const PLAYER_SPEED = 34;
const BULLET_SPEED = 17;
const PLAYER_RADIUS = 1.2;
const BULLET_RADIUS = 0.8;
const TURRET_TOGGLE_RADIUS = 6;

// ── Backdrop ──────────────────────────────────────────────────────────────────

/** The arena floor. A renderable like anything else, drawn from world (0, 0). */
class Backdrop extends Renderable {
  readonly component = () => <div className="arena" />;
}

// ── Player ────────────────────────────────────────────────────────────────────

class Player extends Renderable {
  /** Bumped on every hit; the view keys a flash animation off it. */
  readonly hits$ = new ObservableValue(0);

  private invuln = this.cooldown(1);

  override tick(dt: number): void {
    const input = this.engine.input;
    let dir = Vector.zero;
    if (input.isDown("a") || input.isDown("ArrowLeft")) {
      dir = dir.add(new Vector(-1, 0));
    }
    if (input.isDown("d") || input.isDown("ArrowRight")) {
      dir = dir.add(new Vector(1, 0));
    }
    if (input.isDown("w") || input.isDown("ArrowUp")) {
      dir = dir.add(new Vector(0, -1));
    }
    if (input.isDown("s") || input.isDown("ArrowDown")) {
      dir = dir.add(new Vector(0, 1));
    }
    if (dir.lengthSquared() > 0) {
      const next = this.position.add(dir.normalize().scale(PLAYER_SPEED * dt));
      this.position = new Vector(
        clamp(next.x, PLAYER_RADIUS, ARENA_W - PLAYER_RADIUS),
        clamp(next.y, PLAYER_RADIUS, ARENA_H - PLAYER_RADIUS),
      );
    }
  }

  /** Register a hit unless invulnerable. Returns whether it landed. */
  takeHit(): boolean {
    if (!this.invuln.ready) return false;
    this.invuln.start();
    this.hits$.set(this.hits$.get() + 1);
    return true;
  }

  readonly component = ({ unit }: { unit: Player }) => {
    const hits = useObservable(unit.hits$);
    // Remounting on each hit restarts the flash animation.
    return <div key={hits} className={hits ? "player flash" : "player"} />;
  };
}

// ── Bullets ───────────────────────────────────────────────────────────────────

interface BulletProps extends RenderableProps {
  velocity: Vector;
  player: Player;
  game: Game;
}

class Bullet extends Renderable<BulletProps> {
  override tick(dt: number): void {
    this.position = this.position.add(this.props.velocity.scale(dt));
    const { player, game } = this.props;
    if (
      this.position.sub(player.position).length() <
      PLAYER_RADIUS + BULLET_RADIUS
    ) {
      if (player.takeHit()) game.onPlayerHit();
      this.destroy();
      return;
    }
    const p = this.position;
    if (p.x < -4 || p.x > ARENA_W + 4 || p.y < -4 || p.y > ARENA_H + 4) {
      this.destroy();
    }
  }

  readonly component = () => <div className="bullet" />;
}

// ── Turrets ───────────────────────────────────────────────────────────────────

interface TurretProps extends RenderableProps {
  player: Player;
  game: Game;
}

/**
 * Tracks and shoots at the player. Click one to toggle `ticking`: frozen, its
 * aim and its `every()` firing timer stop dead, but bullets it already fired
 * keep flying (per-unit disable is unit-only, and bullets are siblings).
 */
export class Turret extends Renderable<TurretProps> {
  constructor(props: TurretProps) {
    super(props);
    this.every(1.1, () => this.fire());
  }

  override tick(): void {
    this.rotation = this.props.player.position.sub(this.position).angle();
  }

  private fire(): void {
    const dir = Vector.fromAngle(this.rotation);
    // Spawn as a sibling, not a child: a frozen turret must not freeze its
    // bullets mid-air.
    this.parent?.addChild(
      mes(Bullet, {
        position: this.position.add(dir.scale(3)),
        velocity: dir.scale(BULLET_SPEED),
        player: this.props.player,
        game: this.props.game,
      }),
    );
  }

  readonly component = ({ unit }: { unit: Turret }) => {
    const ticking = useObservable(unit.ticking$);
    return (
      <div className={ticking ? "turret" : "turret frozen"}>
        <div className="barrel" />
      </div>
    );
  };
}

// ── Game controller ───────────────────────────────────────────────────────────

interface GameProps extends UnitProps {
  player: Player;
}

/**
 * Invisible controller: scorekeeping on the fixed clock (freezes with the
 * game), time-scale control on events and the device clock (alive during
 * pause).
 */
export class Game extends Unit<GameProps> {
  /** Current run time in seconds, one decimal. HUD subscribes. */
  readonly survived$ = new ObservableValue(0);
  /** Best run time in seconds, one decimal. HUD subscribes. */
  readonly best$ = new ObservableValue(0);

  private runStart = 0;
  private slowmo = false;

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    this.runStart = this.engine.time;
    const input = this.engine.input;
    // Events, not polling: they fire on feed, so they work while paused
    // (`justPressed` rolls over on the fixed clock, which a pause freezes).
    this.observeUntilDestroyed(input.onKeyDown, ({ key }) => {
      if (key === "Escape") this.engine.paused = !this.engine.paused;
      if (key === "Shift") this.slowmo = true;
    });
    this.observeUntilDestroyed(input.onKeyUp, ({ key }) => {
      if (key === "Shift") this.slowmo = false;
    });
    this.observeUntilDestroyed(input.onPointerDown, ({ position }) => {
      this.toggleTurretAt(position);
    });
  }

  /** Fixed clock: scorekeeping freezes during pause and slows in bullet time. */
  override tick(): void {
    const t = this.engine.time - this.runStart;
    const rounded = Math.floor(t * 10) / 10;
    this.survived$.set(rounded);
    if (rounded > this.best$.get()) this.best$.set(rounded);
  }

  /**
   * Device clock: runs even at `timeScale` 0, so the scale self-heals — e.g.
   * releasing Shift while the pause menu is open still resumes at full speed.
   */
  override deviceTick(): void {
    const engine = this.engine;
    if (!engine.paused) engine.timeScale = this.slowmo ? SLOWMO : 1;
  }

  onPlayerHit(): void {
    this.runStart = this.engine.time; // the run is over; the clock restarts
    for (const sibling of this.parent?.children.slice() ?? []) {
      if (sibling instanceof Bullet) sibling.destroy(); // clean slate
    }
  }

  private toggleTurretAt(p: Vector): void {
    let nearest: Turret | null = null;
    let nearestD = TURRET_TOGGLE_RADIUS;
    for (const sibling of this.parent?.children ?? []) {
      if (!(sibling instanceof Turret)) continue;
      const d = sibling.position.sub(p).length();
      if (d < nearestD) {
        nearestD = d;
        nearest = sibling;
      }
    }
    if (nearest) nearest.ticking = !nearest.ticking;
  }
}

// ── Camera ────────────────────────────────────────────────────────────────────

interface GameCameraProps extends CameraProps {
  player: Player;
}

/** Follows the player; smoothing advances on the fixed clock, so it freezes with the game. */
class GameCamera extends Camera<GameCameraProps> {
  override tick(): void {
    this.position = this.props.player.position;
  }
}

// ── Scene ─────────────────────────────────────────────────────────────────────

export function createGame(): { engine: Engine; game: Game } {
  const engine = new Engine();
  const player = mes(Player, {
    position: new Vector(ARENA_W / 2, ARENA_H / 2),
    z: 2,
  });
  const game = mes(Game, { player });
  const turret = (x: number, y: number) =>
    mes(Turret, { position: new Vector(x, y), player, game, z: 1 });

  engine.changeScene(
    mes(Unit, {}, [
      mes(Backdrop, {}),
      player,
      turret(12, 10),
      turret(ARENA_W - 12, 10),
      turret(12, ARENA_H - 10),
      turret(ARENA_W - 12, ARENA_H - 10),
      turret(ARENA_W / 2, 6),
      game,
      mes(GameCamera, {
        player,
        width: 72,
        height: 40.5,
        smoothing: 4,
        limits: { left: 0, top: 0, right: ARENA_W, bottom: ARENA_H },
      }),
    ]),
  );
  return { engine, game };
}
