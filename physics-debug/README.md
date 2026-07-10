# @mise/physics-debug

Dev-mode physics visualization for [Mise en Scène](../README.md): every
collider, area, and recent raycast in a
[`@mise/physics`](../physics/README.md) world, drawn over the rendered game
by the [`@mise/react`](../react/README.md) compositor. Physics exposes the
data (`debugSnapshot`, `world.rayLog`); this package only draws it, keeping
`@mise/physics` free of React and `@mise/react` free of physics.

```tsx
import { PhysicsDebug2D } from "@mise/physics-debug";

engine.changeScene(
  mes(PhysicsWorld2D, {}, [
    // ...bodies, areas, the player...
    mes(PhysicsDebug2D, { startVisible: false }), // press ` (tilde) in game
  ]),
);
```

Runnable demo: [`examples/physics-debug`](../examples/physics-debug/README.md).

## `PhysicsDebug2D extends Renderable`

A drop-in unit, not a special overlay system: the compositor gives it camera
tracking, `--u` resolution independence, and z-ordering (default `z: 100`)
like any other renderable, and it is torn down with the scene. Place it as a
**direct child of the `PhysicsWorld2D`** and leave it untransformed — the
world is a plain `Unit`, so the transform chain resets there and the
overlay's SVG draws in world coordinates.

What you see:

- Collider outlines, color-coded by what the simulation says they are:
  green static, blue character (kinematic), orange dynamic, yellow areas.
  Capsule outlines are exact stadiums; strokes stay hairline at any zoom.
- Areas are translucent filled regions; bodies are outlines.
- Raycasts from the last second (`rayTtl`), fading with age: pink with a
  hit dot and surface normal where they hit, gray where they missed.

Props:

- `world`: the `PhysicsWorld2D` to draw. Default: nearest ancestor.
- `toggleKey`: key flipping visibility, default `` "`" `` (tilde). Pass
  `null` to disable and drive `visible` yourself.
- `startVisible`: default true.
- `rayTtl`: seconds a recorded ray stays drawn, default 1.

## Cost

Not mounted: zero. Mounted but hidden: one key check per tick, no DOM.
Visible: one snapshot + one SVG re-render per fixed tick — a dev tool budget,
spent only while you are looking at it. While in the tree it enables the
world's `rayLog` and restores the previous setting on exit, so ray recording
never outlives the thing displaying it.
