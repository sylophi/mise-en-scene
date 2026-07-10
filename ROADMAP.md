# Roadmap

## 1. Performance debt

- **Batched per-frame flush** (`@mise/react`): collect dirty units and flush
  once per `deviceTick` instead of re-rendering per change.
- **Lazy-cached world transforms** (`@mise/core`): dirty propagation instead
  of recomputing on every read.

## 2. Missing pillars

- **`@mise/audio`**: sound as units. An audio player unit that plays on tree
  enter and stops on exit, a listener following the active camera for
  positional panning and volume, Web Audio underneath.
- **Pause and time scale** (`@mise/core`): a `timeScale` accessor on the
  engine (0 pauses) that scales the fixed clock; React UI keeps running.
- **`RigidBody2D`** (`@mise/physics`): dynamic bodies under gravity, forces,
  and impulses.

## 3. Content and workflow

- **Tilemaps**: a `TileMap2D` that stamps renderables and merged static
  colliders from a grid, with Tiled (`.tmj`) import as the authoring path.
- ~~**Asset preloading** (`@mise/react`)~~ — done: `preload([...urls])` with
  reactive progress and a per-url error policy (see react/README.md and
  docs/design/assets-and-sprites.md).
- ~~**Sprite animation helper** (`@mise/react`)~~ — done: `AnimatedSprite`
  component + `useSpriteAnimation` hook (sheet or multi-image, fps,
  play/loop/gotoFrame, onFinished) driven by engine time, so it pauses with
  the game. Demo: `examples/sprites-demo`.
- **Physics debug draw** (`@mise/physics`): dev-mode visualization of
  colliders, rays, and areas in the React layer.

## 4. Rounding out physics

- **Contact events on bodies** (v1 events are sensor overlaps via `Area2D`)
- **Shape casts and point queries** alongside `castRay`
- **Character presets**: autostep, snap-to-ground, max slope as props

## 5. Core ergonomics and later

- **Per-unit tick enable/disable** (`@mise/core`)
- **Decorator sugar** (`@mise/core`): `@observable accessor hp = 100` to
  collapse the accessor trio to one line
- **Structural equality option for `ObservableValue`** (v1 is `===`)
- **Canvas/WebGL escape-hatch layer** (`@mise/react`) for effects DOM is bad
  at (particles)
- **Build/publish step** (currently consumed as TypeScript source)
- **Multiple simultaneous scenes** (v1 `changeScene` swaps one child under
  root)
- **Serialization of the live tree**

## 6. Editor

- **GUI editor**: author scenes, place units, and tune properties visually;
  code is only for game logic. Built on live-tree serialization.
