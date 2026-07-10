import { Camera, ObservableValue, Vector, mes, type Unit } from "@mise/core";
import {
  Area2D,
  CharacterBody2D,
  CollisionShape2D,
  PhysicsWorld2D,
  StaticBody2D,
  capsule,
  circle,
  rect,
  type CollisionObject2DProps,
} from "@mise/physics";
import { PhysicsDebug2D } from "@mise/physics-debug";
import { Renderable, useObservable, type RenderableProps } from "@mise/react";
import type { CSSProperties, ReactNode } from "react";

/** Coins collected. The HUD subscribes to this. */
export const score$ = new ObservableValue(0);
export const COIN_COUNT = 3;

// ── Appearance units (physics classes can't extend Renderable; use children) ──

interface BoxProps extends RenderableProps {
  width: number;
  height: number;
  color: string;
  /** Corner radius in camera units. */
  radius?: number;
}

/** A centered colored box sized in camera units, for platforms and props. */
class Box extends Renderable<BoxProps> {
  readonly component = ({ unit }: { unit: Box }): ReactNode => {
    const { width, height, color, radius } = unit.props;
    const style: CSSProperties = {
      width: `calc(${width} * var(--u))`,
      height: `calc(${height} * var(--u))`,
      background: color,
      borderRadius: radius ? `calc(${radius} * var(--u))` : undefined,
      transform: "translate(-50%, -50%)",
    };
    return <div style={style} />;
  };
}

/** The player's capsule look; tints while airborne. */
class PlayerSprite extends Renderable {
  readonly component = ({ unit }: { unit: PlayerSprite }): ReactNode => {
    const player = unit.findAncestor(Player);
    const grounded = useObservable(player!.grounded$);
    const style: CSSProperties = {
      width: "calc(4 * var(--u))",
      height: "calc(10 * var(--u))",
      background: grounded ? "#5ec8f8" : "#9fdcfb",
      borderRadius: "calc(2 * var(--u))",
      transform: "translate(-50%, -50%)",
    };
    return <div style={style} />;
  };
}

// ── Gameplay units ────────────────────────────────────────────────────────────

class Player extends CharacterBody2D {
  private vy = 0;

  /** Whether the last move ended on the ground. The sprite tints on this. */
  readonly grounded$ = new ObservableValue(false);

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    // A periodic line-of-sight ray toward the pointer: visible in the debug
    // overlay as a fading laser (hits are pink with a normal, misses gray).
    this.every(0.25, () => this.aimAtPointer());
  }

  override tick(dt: number): void {
    const input = this.engine.input;
    const x = (input.isDown("d") ? 1 : 0) - (input.isDown("a") ? 1 : 0);
    this.vy += 300 * dt; // gravity: y grows downward
    if (this.isOnFloor) {
      this.vy = input.isDown(" ") ? -150 : 0; // jump
    }
    this.moveAndSlide(new Vector(x * 60, this.vy), dt);
    this.grounded$.set(this.isOnFloor);
    // Ground probe under the feet, every tick (also shows in the overlay).
    this.physicsWorld?.castRay(this.position, new Vector(0, 1), 12, {
      exclude: this,
    });
  }

  private aimAtPointer(): void {
    const world = this.physicsWorld;
    const to = this.engine.input.pointer.sub(this.position);
    if (!world || to.length() < 1e-3) return;
    world.castRay(this.position, to, 120, { exclude: this });
  }
}

/** A pickup: an `Area2D` that scores and disappears when the player enters. */
class Coin extends Area2D {
  constructor(props?: CollisionObject2DProps) {
    super(props);
    this.onBodyEntered.addListener((body) => {
      if (!(body instanceof Player)) return;
      score$.set(score$.get() + 1);
      // Defer: the event fires inside the world's tick, mid event drain.
      this.after(0, () => this.destroy());
    });
  }
}

// ── Level ────────────────────────────────────────────────────────────────────

const platform = (
  x: number,
  y: number,
  w: number,
  h: number,
  rotation = 0,
): Unit =>
  mes(StaticBody2D, { position: new Vector(x, y), rotation }, [
    mes(CollisionShape2D, { shape: rect(w, h) }),
    mes(Box, { width: w, height: h, color: "#2c3444", radius: 0.75 }),
  ]);

const coin = (x: number, y: number): Unit =>
  mes(Coin, { position: new Vector(x, y) }, [
    mes(CollisionShape2D, { shape: circle(2.5) }),
    mes(Box, { width: 3, height: 3, color: "#f8d84a", radius: 1.5 }),
  ]);

export function buildLevel(): Unit {
  return mes(PhysicsWorld2D, {}, [
    mes(Camera, { width: 160, height: 90, position: new Vector(80, 45) }),
    // Ground and platforms.
    platform(80, 85, 170, 10),
    platform(30, 58, 36, 4),
    platform(130, 48, 30, 4),
    // A slope: a rotated static body, ramping from the floor up to the right.
    platform(100, 70, 50, 5, -0.35),
    // Pickups.
    coin(30, 50),
    coin(130, 40),
    coin(98, 56),
    // The player.
    mes(Player, { position: new Vector(15, 60) }, [
      mes(CollisionShape2D, { shape: capsule(3, 2) }),
      mes(PlayerSprite, {}),
    ]),
    // The debug overlay: hidden until ` (tilde) is pressed.
    mes(PhysicsDebug2D, { startVisible: false }),
  ]);
}
