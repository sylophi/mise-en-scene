import type { ReactNode } from "react";
import {
  Camera,
  ObservableValue,
  Unit,
  Unit2D,
  Vector,
  clamp,
  mes,
} from "@mise/core";
import { Renderable, useObservable, type RenderableProps } from "@mise/react";
import {
  AudioMixer,
  AudioPlayer,
  AudioPlayer2D,
  type AudioSource,
} from "@mise/audio";
import type { Sfx } from "./sfx.ts";

// World units. Origin at the field center, y down (the engine convention).
const FIELD = { width: 240, height: 140 };
const HALF_W = FIELD.width / 2;
const HALF_H = FIELD.height / 2;
const PLAYER_SPEED = 55;
const FIND_RADIUS = 8;

/** Hand-placed hideouts, spread so at most one chirper is loud at a time. */
const CHIRPER_SPOTS: Array<[number, number]> = [
  [-92, -48],
  [88, -52],
  [-70, 44],
  [102, 30],
  [-18, -58],
  [30, 58],
];

/** Background props so walking has a visible motion reference. */
const TUFT_SPOTS: Array<[number, number]> = [
  [-100, -20],
  [-60, -55],
  [-75, 10],
  [-35, 40],
  [-20, -25],
  [5, 15],
  [25, -45],
  [45, 35],
  [65, -10],
  [90, 55],
  [105, -35],
  [-105, 55],
  [60, 60],
  [-45, -10],
  [15, 50],
  [80, 12],
];

export interface GameState {
  mixer: AudioMixer;
  found$: ObservableValue<number>;
  won$: ObservableValue<boolean>;
  total: number;
}

/** Spawn a self-destroying one-shot sound under `parent`. */
function spawnOneShot(parent: Unit, src: AudioSource, position?: Vector): void {
  const player = position
    ? mes(AudioPlayer2D, { src, position, maxDistance: 160 })
    : mes(AudioPlayer, { src });
  player.onFinished.addListener(() => player.destroy());
  parent.addChild(player);
}

class Tuft extends Renderable {
  readonly component = ({ unit }: { unit: Tuft }): ReactNode => (
    <div className="tuft">{unit.id.charCodeAt(5) % 2 ? "🌾" : "🌿"}</div>
  );
}

class PlayerCharacter extends Renderable {
  override tick(dt: number): void {
    const input = this.engine.input;
    const held = (...keys: string[]): boolean =>
      keys.some((k) => input.isDown(k));
    const dir = new Vector(
      (held("d", "ArrowRight") ? 1 : 0) - (held("a", "ArrowLeft") ? 1 : 0),
      (held("s", "ArrowDown") ? 1 : 0) - (held("w", "ArrowUp") ? 1 : 0),
    );
    if (dir.equals(Vector.zero)) return;
    const step = dir.normalize().scale(PLAYER_SPEED * dt);
    this.position = new Vector(
      clamp(this.position.x + step.x, -HALF_W, HALF_W),
      clamp(this.position.y + step.y, -HALF_H, HALF_H),
    );
  }

  readonly component = (): ReactNode => <div className="player">🧭</div>;
}

interface ChirperProps extends RenderableProps {
  buffer: AudioBuffer;
  /** Per-bird pitch so their voices are distinguishable. */
  rate: number;
}

/**
 * A hidden bird. Its looping chirp is an `AudioPlayer2D` child, so panning
 * and loudness are the only clues — the sprite stays invisible until found,
 * except for a faint shimmer when you are nearly on top of it (driven by the
 * chirp's live `attenuation$`).
 */
class Chirper extends Renderable<ChirperProps> {
  readonly found$ = new ObservableValue(false);
  get found(): boolean {
    return this.found$.get();
  }

  readonly chirp: AudioPlayer2D;

  constructor(props: ChirperProps) {
    super(props);
    this.chirp = mes(AudioPlayer2D, {
      src: props.buffer,
      loop: true,
      playbackRate: props.rate,
      maxDistance: 95,
      rolloff: 1.5,
    });
    this.addChild(this.chirp);
  }

  reveal(): void {
    if (this.found) return;
    this.found$.set(true);
    this.chirp.destroy(); // the bird stops calling once found
  }

  readonly component = ({ unit }: { unit: Chirper }): ReactNode => {
    const found = useObservable(unit.found$);
    // attenuation$ outlives the destroyed chirp unit; it just stops updating.
    const closeness = useObservable(unit.chirp.attenuation$);
    const shimmer = Math.max(0, closeness - 0.8) * 5; // visible only very near
    return (
      <div
        className={found ? "chirper chirper-found" : "chirper"}
        style={found ? undefined : { opacity: shimmer }}
      >
        🐦
      </div>
    );
  };
}

interface DirectorProps {
  player: PlayerCharacter;
  chirpers: Chirper[];
  sfx: Sfx;
  found$: ObservableValue<number>;
  won$: ObservableValue<boolean>;
}

/** Invisible referee: checks proximity, scores finds, ends the game. */
class Director extends Unit {
  constructor(private readonly game: DirectorProps) {
    super();
  }

  override tick(_dt: number): void {
    const { player, chirpers, sfx, found$, won$ } = this.game;
    if (won$.get()) return;
    for (const chirper of chirpers) {
      if (chirper.found) continue;
      if (chirper.position.sub(player.position).length() > FIND_RADIUS) {
        continue;
      }
      chirper.reveal();
      found$.set(found$.get() + 1);
      spawnOneShot(this, sfx.pickup, chirper.position);
      if (found$.get() === chirpers.length) {
        won$.set(true);
        this.after(0.7, () => spawnOneShot(this, sfx.fanfare));
      }
    }
  }
}

class Meadow extends Renderable {
  readonly component = (): ReactNode => (
    <div
      className="meadow"
      style={{
        width: `calc(${FIELD.width} * var(--u))`,
        height: `calc(${FIELD.height} * var(--u))`,
      }}
    />
  );
}

/**
 * Build the whole game as one tree under an `AudioMixer`: swap it out with
 * `changeScene` and every sound in it — music included — stops with it.
 */
export function createGame(sfx: Sfx): { scene: Unit; state: GameState } {
  const found$ = new ObservableValue(0);
  const won$ = new ObservableValue(false);

  const player = mes(PlayerCharacter, { position: Vector.zero, z: 2 }, [
    mes(Camera, {
      width: 160,
      height: 90,
      smoothing: 5,
      limits: { left: -HALF_W, right: HALF_W, top: -HALF_H, bottom: HALF_H },
    }),
  ]);

  const chirpers = CHIRPER_SPOTS.map(([x, y], i) =>
    mes(Chirper, {
      position: new Vector(x, y),
      z: 1,
      buffer: sfx.chirp,
      rate: 0.85 + i * 0.11,
    }),
  );

  const world = mes(Unit2D, {}, [
    mes(Meadow, { position: Vector.zero, z: -1 }),
    ...TUFT_SPOTS.map(([x, y]) => mes(Tuft, { position: new Vector(x, y) })),
    ...chirpers,
    player,
  ]);

  const mixer = mes(AudioMixer, {}, [
    mes(AudioPlayer, { src: sfx.music, loop: true, volume: 0.3 }),
    world,
    mes(Director, { player, chirpers, sfx, found$, won$ }),
  ]);

  return {
    scene: mixer,
    state: { mixer, found$, won$, total: chirpers.length },
  };
}
