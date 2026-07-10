import {
  Camera,
  ObservableValue,
  Vector,
  mes,
  type CameraProps,
  type Unit,
  type Unit2D,
} from "@mise/core";
import { Renderable } from "@mise/react";
import {
  Area2D,
  CharacterBody2D,
  CollisionShape2D,
  PhysicsWorld2D,
  rect,
} from "@mise/physics";
import { TileMap2D, parseTmj } from "@mise/tilemap";
import tilesUrl from "./tiles.png";
import levelRaw from "./level.tmj?raw";

/** Set when the player touches the flag; the HUD observes it. */
export const won$ = new ObservableValue(false);

const SPAWN = new Vector(2.5, 10);
const FLAG_GID = 4;
const GRAVITY = 60;
const RUN_SPEED = 9;
const JUMP_SPEED = 24; // apex v²/2g = 4.8 tiles: clears the 4-tile climbs

class Player extends CharacterBody2D {
  private vy = 0;

  override tick(dt: number): void {
    const input = this.engine.input;
    const left = input.isDown("a") || input.isDown("ArrowLeft");
    const right = input.isDown("d") || input.isDown("ArrowRight");
    const jump =
      input.isDown(" ") || input.isDown("w") || input.isDown("ArrowUp");

    this.vy += GRAVITY * dt;
    if (this.isOnFloor) this.vy = jump ? -JUMP_SPEED : 0;
    const vx = (right ? 1 : 0) - (left ? 1 : 0);
    this.moveAndSlide(new Vector(vx * RUN_SPEED, this.vy), dt);

    // Fell into the pit: back to the start.
    if (this.position.y > 20) {
      this.position = SPAWN;
      this.vy = 0;
    }
  }
}

class PlayerSprite extends Renderable {
  readonly component = (_props: { unit: PlayerSprite }) => (
    <div
      style={{
        position: "absolute",
        left: "calc(-0.4 * var(--u))",
        top: "calc(-0.7 * var(--u))",
        width: "calc(0.8 * var(--u))",
        height: "calc(1.4 * var(--u))",
        borderRadius: "calc(0.25 * var(--u))",
        background: "linear-gradient(#ffb057, #e2542e)",
        boxShadow: "inset 0 calc(-0.12 * var(--u)) rgba(0, 0, 0, 0.3)",
      }}
    />
  );
}

interface FollowCameraProps extends CameraProps {
  target: Unit2D;
}

class FollowCamera extends Camera<FollowCameraProps> {
  override tick(): void {
    this.position = this.props.target.position;
  }
}

/** Build the whole level scene; call again to restart. */
export function Level(): Unit {
  won$.set(false);
  const map = parseTmj(levelRaw, { resolveImage: () => tilesUrl });
  const tilemap = mes(TileMap2D, { map, collisions: true });

  const player = mes(Player, { position: SPAWN }, [
    mes(CollisionShape2D, { shape: rect(0.8, 1.4) }),
    mes(PlayerSprite, {}),
  ]);

  // The flag tile is the goal: park a sensor on it.
  const terrain = map.layers[0]!;
  const flagIndex = terrain.tiles.indexOf(FLAG_GID);
  const goal = mes(
    Area2D,
    {
      position: tilemap.tileToLocal(
        flagIndex % map.width,
        Math.floor(flagIndex / map.width),
      ),
    },
    [mes(CollisionShape2D, { shape: rect(1, 1) })],
  );
  goal.onBodyEntered.addListener(() => won$.set(true));

  return mes(PhysicsWorld2D, {}, [
    tilemap,
    player,
    goal,
    mes(FollowCamera, {
      target: player,
      width: 24,
      height: 13.5,
      smoothing: 6,
      limits: {
        left: 0,
        top: 0,
        right: map.width * map.tileWidth,
        bottom: map.height * map.tileHeight,
      },
    }),
  ]);
}
