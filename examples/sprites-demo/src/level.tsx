import {
  ObservableValue,
  Unit2D,
  Vector,
  clamp,
  mes,
  unitRef,
  type Unit,
} from "@mise/core";
import {
  AnimatedSprite,
  Renderable,
  useObservable,
  type RenderableProps,
} from "@mise/react";
import {
  COIN_SHEET,
  GRASS_URL,
  IDLE_SHEET,
  TREE_URL,
  WALK_SHEET,
} from "./assets.ts";

// Camera space: 100 x 56.25 units, origin top-left.
export const WORLD = { width: 100, height: 56.25 };

/** Filled by `buildLevel`; the HUD reads the score through it. */
export const playerRef = unitRef<Player>();

const PLAYER_SPEED = 30;
const PICKUP_RADIUS = 3.5;

// ── Coin ─────────────────────────────────────────────────────────────────────

export class Coin extends Renderable {
  readonly component = () => (
    <AnimatedSprite
      sheet={COIN_SHEET}
      fps={12}
      width={4}
      height={4}
      style={{ transform: "translate(-50%, -50%)" }}
    />
  );
}

// ── Player ───────────────────────────────────────────────────────────────────

export class Player extends Renderable {
  readonly moving$ = new ObservableValue(false);
  /** 1 faces right, -1 faces left (the art faces right). */
  readonly facing$ = new ObservableValue(1);
  readonly score$ = new ObservableValue(0);

  override tick(dt: number): void {
    const { input } = this.engine;
    const held = (...keys: string[]): boolean =>
      keys.some((k) => input.isDown(k));
    const dx =
      (held("d", "ArrowRight") ? 1 : 0) - (held("a", "ArrowLeft") ? 1 : 0);
    const dy =
      (held("s", "ArrowDown") ? 1 : 0) - (held("w", "ArrowUp") ? 1 : 0);

    const moving = dx !== 0 || dy !== 0;
    this.moving$.set(moving);
    if (dx !== 0) this.facing$.set(dx);
    if (moving) {
      const step = new Vector(dx, dy).normalize().scale(PLAYER_SPEED * dt);
      const p = this.position.add(step);
      this.position = new Vector(
        clamp(p.x, 4, WORLD.width - 4),
        clamp(p.y, 9, WORLD.height - 2),
      );
    }

    // Collect any coin within reach (siblings in the level).
    for (const u of this.parent?.children ?? []) {
      if (
        u instanceof Coin &&
        !u.destroyed &&
        u.position.sub(this.position).length() < PICKUP_RADIUS
      ) {
        u.destroy();
        this.score$.set(this.score$.get() + 1);
      }
    }
  }

  readonly component = ({ unit }: { unit: Player }) => {
    const moving = useObservable(unit.moving$);
    const facing = useObservable(unit.facing$);
    return (
      // Feet on the unit origin; scaleX flips the art to face left.
      <div style={{ transform: `translate(-50%, -100%) scaleX(${facing})` }}>
        <AnimatedSprite
          sheet={moving ? WALK_SHEET : IDLE_SHEET}
          fps={moving ? 12 : 4}
          width={8}
          height={8}
        />
      </div>
    );
  };
}

// ── Decor ────────────────────────────────────────────────────────────────────

interface DecorProps extends RenderableProps {
  src: string;
  width: number;
  height: number;
}

/** A static image, feet on the origin, sized in camera units. */
class Decor extends Renderable<DecorProps> {
  readonly component = ({ unit }: { unit: Decor }) => (
    <img
      src={unit.props.src}
      alt=""
      draggable={false}
      style={{
        width: `calc(${unit.props.width} * var(--u))`,
        height: `calc(${unit.props.height} * var(--u))`,
        imageRendering: "pixelated",
        transform: "translate(-50%, -100%)",
      }}
    />
  );
}

// ── Level ────────────────────────────────────────────────────────────────────

const COIN_SPOTS: ReadonlyArray<[number, number]> = [
  [15, 14],
  [85, 12],
  [50, 20],
  [12, 44],
  [70, 48],
  [90, 34],
  [35, 38],
];

export const COIN_TOTAL = COIN_SPOTS.length;

export function buildLevel(): Unit {
  const decor: Unit[] = [];
  for (const [x, y, w, h] of [
    [8, 20, 9, 12],
    [78, 26, 9, 12],
    [42, 52, 9, 12],
  ] as const) {
    decor.push(
      mes(Decor, {
        src: TREE_URL,
        position: new Vector(x, y),
        width: w,
        height: h,
      }),
    );
  }
  for (let i = 0; i < 10; i++) {
    // Deterministic scatter, no RNG: stable between reloads.
    const x = 6 + ((i * 37) % 89);
    const y = 12 + ((i * 23) % 42);
    decor.push(
      mes(Decor, {
        src: GRASS_URL,
        position: new Vector(x, y),
        width: 4,
        height: 4,
      }),
    );
  }
  const coins = COIN_SPOTS.map(([x, y]) =>
    mes(Coin, { position: new Vector(x, y) }),
  );
  const player = mes(
    Player,
    { position: new Vector(50, 40) },
    { ref: playerRef },
  );
  return mes(Unit2D, {}, [...decor, ...coins, player]);
}
