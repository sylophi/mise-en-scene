import {
  clamp,
  observable,
  structuralEquals,
  Unit,
  Vector,
  type ObservableValue,
  type UnitProps,
} from "@mise/core";
import { Renderable, type RenderableProps } from "@mise/react";
import { ChaserView, GemView, PlayerView } from "./views.tsx";

/** Logical world = camera space: 100 x 56.25 camera units, y-down. */
export const WORLD = { w: 100, h: 56.25 } as const;
export const CENTER = new Vector(WORLD.w / 2, WORLD.h / 2);

/** The HUD's sector grid: 25-unit cells (4 x 3 sectors). */
export const SECTOR_SIZE = 25;

const PLAYER_SPEED = 42;
const MAX_HP = 3;

// ── Player ───────────────────────────────────────────────────────────────────

export class Player extends Renderable {
  @observable accessor hp = MAX_HP;
  @observable accessor score = 0;
  /** True during the post-hit mercy window (drawn translucent). */
  @observable accessor shielded = false;

  /**
   * The player's grid cell, rewritten with a *fresh* `Vector` every tick.
   * Structural equality turns those writes into no-ops until the player
   * actually crosses a cell border — the HUD proves it with a render counter.
   */
  @observable({ equals: structuralEquals }) accessor sector = Vector.zero;
  /** The same writes under the default `===`: every tick looks like a change. */
  @observable accessor sectorNaive = Vector.zero;

  // @observable creates the channels at runtime; declare them for typed use.
  declare readonly hp$: ObservableValue<number>;
  declare readonly score$: ObservableValue<number>;
  declare readonly shielded$: ObservableValue<boolean>;
  declare readonly sector$: ObservableValue<Vector>;
  declare readonly sectorNaive$: ObservableValue<Vector>;

  private readonly mercy = this.cooldown(1.2);

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
      const step = this.position.add(dir.normalize().scale(PLAYER_SPEED * dt));
      const next = new Vector(
        clamp(step.x, 2, WORLD.w - 2),
        clamp(step.y, 2, WORLD.h - 2),
      );
      // position$ is ===-compared, so skip writes that didn't move us.
      if (!next.equals(this.position)) this.position = next;
    }

    this.shielded = !this.mercy.ready;

    // One fresh Vector, two channels: `sector` melts the spam via
    // structuralEquals, `sectorNaive` fires ~60 times a second.
    const cell = new Vector(
      Math.floor(this.position.x / SECTOR_SIZE),
      Math.floor(this.position.y / SECTOR_SIZE),
    );
    this.sector = cell;
    this.sectorNaive = cell;
  }

  /** Take a hit unless the mercy window is still running. */
  hit(): void {
    if (!this.mercy.ready) return;
    this.mercy.start();
    this.hp -= 1;
  }

  respawn(): void {
    this.hp = MAX_HP;
    this.score = 0;
    this.position = CENTER;
  }

  readonly component = PlayerView;
}

// ── Gem ──────────────────────────────────────────────────────────────────────

export interface GemProps extends RenderableProps {
  player: Player;
}

export class Gem extends Renderable<GemProps> {
  /** Lights up when the player is close enough to tease the pickup. */
  @observable accessor glow = false;
  declare readonly glow$: ObservableValue<boolean>;

  override tick(): void {
    const dist = this.props.player.position.sub(this.position).length();
    this.glow = dist < 10;
    if (dist < 3.4) {
      this.props.player.score += 1;
      this.position = Gem.randomSpot();
    }
  }

  static randomSpot(): Vector {
    return new Vector(
      6 + Math.random() * (WORLD.w - 12),
      6 + Math.random() * (WORLD.h - 12),
    );
  }

  readonly component = GemView;
}

// ── Chaser ───────────────────────────────────────────────────────────────────

export interface ChaserProps extends RenderableProps {
  player: Player;
}

export class Chaser extends Renderable<ChaserProps> {
  /** Faster and redder when it smells blood. */
  @observable accessor enraged = false;
  declare readonly enraged$: ObservableValue<boolean>;

  override tick(dt: number): void {
    const player = this.props.player;
    const toPlayer = player.position.sub(this.position);
    const dist = toPlayer.length();
    if (dist <= 0.001) return;

    this.enraged = dist < 18;
    const speed =
      Math.min(11 + player.score * 1.25, 34) + (this.enraged ? 4 : 0);
    this.position = this.position.add(toPlayer.normalize().scale(speed * dt));

    if (dist < 3.4) {
      // Hop back first so one collision doesn't drain the whole hp bar —
      // and so a Director reset triggered by hit() has the last word.
      const back = this.position.sub(toPlayer.normalize().scale(20));
      this.position = new Vector(
        clamp(back.x, 3, WORLD.w - 3),
        clamp(back.y, 3, WORLD.h - 3),
      );
      player.hit();
    }
  }

  readonly component = ChaserView;
}

// ── Director (invisible logic unit) ──────────────────────────────────────────

export interface DirectorProps extends UnitProps {
  player: Player;
  chaser: Chaser;
}

/** Watches the player's hp channel and restarts the round on death. */
export class Director extends Unit<DirectorProps> {
  constructor(props: DirectorProps) {
    super(props);
    this.observeUntilDestroyed(props.player.hp$, (hp) => {
      if (hp <= 0) {
        props.player.respawn();
        props.chaser.position = new Vector(8, 8);
      }
    });
  }
}
