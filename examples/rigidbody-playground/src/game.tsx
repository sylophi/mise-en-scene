import { Camera, ObservableValue, Unit, Vector, mes, clamp } from "@mise/core";
import { Renderable, useObservable, type RenderableProps } from "@mise/react";
import {
  CollisionShape2D,
  PhysicsWorld2D,
  RigidBody2D,
  StaticBody2D,
  circle,
  rect,
  type Contact2D,
  type RigidBody2DProps,
} from "@mise/physics";

// World: 160×90 units, y down. Ground top at y=82, slingshot on the left,
// crate pyramid on the right.
export const GRAVITY = new Vector(0, 120);
const GROUND_TOP = 82;
const ANCHOR = new Vector(28, 64);
const BALL_RADIUS = 3;
const CRATE = 6;
const LAUNCH_POWER = 3;
const MAX_LAUNCH_SPEED = 150;

// ── Shared game state (observed by the HUD) ─────────────────────────────────

export const score$ = new ObservableValue(0);
export const shots$ = new ObservableValue(0);

// ── Plain colored boxes (ground, slingshot post) ────────────────────────────

interface BoxProps extends RenderableProps {
  width: number;
  height: number;
  className: string;
}

class Box extends Renderable<BoxProps> {
  readonly component = ({ unit }: { unit: Box }) => (
    <div
      className={`box ${unit.props.className}`}
      style={{
        width: `calc(${unit.props.width} * var(--u))`,
        height: `calc(${unit.props.height} * var(--u))`,
      }}
    />
  );
}

// ── The ball ─────────────────────────────────────────────────────────────────

class BallView extends Renderable {
  readonly component = () => <div className="ball" />;
}

export class Ball extends RigidBody2D {
  constructor(props: RigidBody2DProps) {
    super({
      density: 2,
      friction: 0.6,
      restitution: 0.35,
      linearDamping: 0.05,
      ccd: true, // fast enough to tunnel through a crate wall otherwise
      contactEvents: true, // so un-flagged peers still hear about the hit
      ...props,
    });
    this.after(9, () => this.destroy()); // spent balls clean themselves up
  }

  override tick(): void {
    const p = this.position;
    if (p.y > 200 || p.x < -60 || p.x > 260) this.destroy();
  }
}

export const ball = (position: Vector, linearVelocity: Vector): Ball =>
  mes(Ball, { position, linearVelocity }, [
    mes(BallView, {}),
    mes(CollisionShape2D, { shape: circle(BALL_RADIUS) }),
  ]);

// ── Crates: flash and score on contact ───────────────────────────────────────

class CrateView extends Renderable {
  readonly component = ({ unit }: { unit: CrateView }) => {
    const crate = unit.parent as Crate;
    const flash = useObservable(crate.flash$);
    // Re-keying restarts the CSS flash animation on every hit.
    return <div key={flash} className={flash > 0 ? "crate hit" : "crate"} />;
  };
}

export class Crate extends RigidBody2D {
  /** Bumped on every scoring hit; the view flashes when it changes. */
  readonly flash$ = new ObservableValue(0);
  private scored = false;

  constructor(props: RigidBody2DProps) {
    super({ density: 0.8, friction: 0.7, contactEvents: true, ...props });
    this.observeUntilDestroyed(this.onContactStarted, (c) => this.onHit(c));
  }

  private onHit({ other }: Contact2D): void {
    if (other instanceof Ball) {
      this.registerHit(100); // direct hit
    } else if (
      other instanceof RigidBody2D &&
      other.linearVelocity.sub(this.linearVelocity).length() > 20
    ) {
      this.registerHit(25); // slammed by another crate
    }
  }

  private registerHit(points: number): void {
    this.flash$.set(this.flash$.get() + 1);
    if (this.scored) return;
    this.scored = true;
    score$.set(score$.get() + points);
  }
}

const crate = (x: number, y: number): Crate =>
  mes(Crate, { position: new Vector(x, y) }, [
    mes(CrateView, {}),
    mes(CollisionShape2D, { shape: rect(CRATE, CRATE) }),
  ]);

/** A pyramid of crates standing on the ground. */
const pyramid = (centerX: number): Crate[] => {
  const out: Crate[] = [];
  const spacing = CRATE + 1;
  for (let row = 0; row < 4; row++) {
    const count = 4 - row;
    const y = GROUND_TOP - CRATE / 2 - row * CRATE;
    const left = centerX - ((count - 1) * spacing) / 2;
    for (let i = 0; i < count; i++) out.push(crate(left + i * spacing, y));
  }
  return out;
};

// ── Slingshot: drag to aim, release to fire ──────────────────────────────────

const launchVelocity = (pointer: Vector): Vector => {
  const pull = ANCHOR.sub(pointer).scale(LAUNCH_POWER);
  const speed = clamp(pull.length(), 0, MAX_LAUNCH_SPEED);
  return pull.normalize().scale(speed);
};

export class Slingshot extends Renderable {
  /** Launch velocity of the current drag, or null when idle. */
  readonly aim$ = new ObservableValue<Vector | null>(null);

  override tick(): void {
    const input = this.engine.input;
    if (input.isButtonDown(0)) {
      this.aim$.set(launchVelocity(input.pointer));
      return;
    }
    const velocity = this.aim$.get();
    if (!velocity) return;
    this.aim$.set(null);
    if (velocity.length() < 10) return; // a click, not a fling
    shots$.set(shots$.get() + 1);
    this.parent?.addChild(ball(this.position, velocity));
  }

  readonly component = ({ unit }: { unit: Slingshot }) => {
    const aim = useObservable(unit.aim$);
    // Preview the flight path: p(t) = v·t + ½g·t², relative to the anchor.
    const dots = aim
      ? Array.from({ length: 9 }, (_, i) => {
          const t = 0.09 * (i + 1);
          return aim.scale(t).add(GRAVITY.scale(0.5 * t * t));
        })
      : [];
    return (
      <>
        <div className="sling-post" />
        <div className={aim ? "sling-ball armed" : "sling-ball"} />
        {dots.map((p, i) => (
          <div
            // oxlint-disable-next-line no-array-index-key -- fixed positional preview
            key={i}
            className="aim-dot"
            style={{
              left: `calc(${p.x} * var(--u))`,
              top: `calc(${p.y} * var(--u))`,
              opacity: 1 - i / 12,
            }}
          />
        ))}
      </>
    );
  };
}

// ── Director: reset key ──────────────────────────────────────────────────────

class Director extends Unit {
  override tick(): void {
    if (this.engine.input.justPressed("r")) {
      this.engine.changeScene(buildScene());
    }
  }
}

// ── The scene ────────────────────────────────────────────────────────────────

export function buildScene(): Unit {
  score$.set(0);
  shots$.set(0);
  return mes(PhysicsWorld2D, { gravity: GRAVITY }, [
    mes(Camera, { width: 160, height: 90, position: new Vector(80, 45) }),
    mes(Director, {}),
    // Ground and walls keep everything on stage.
    mes(StaticBody2D, { position: new Vector(80, GROUND_TOP + 4) }, [
      mes(CollisionShape2D, { shape: rect(160, 8) }),
      mes(Box, { width: 160, height: 8, className: "ground" }),
    ]),
    mes(StaticBody2D, { position: new Vector(163, 45) }, [
      mes(CollisionShape2D, { shape: rect(6, 90) }),
    ]),
    mes(Slingshot, { position: ANCHOR }),
    ...pyramid(122),
  ]);
}
