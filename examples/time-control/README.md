# Chrono Arena — time control example

A small dodge-the-projectiles game showing off Mise en Scène's time control:

- **Bullet time**: hold `Shift` — `engine.timeScale = 0.3`. Everything on the
  fixed clock (movement, bullets, turret fire timers, camera smoothing, the
  survival clock) runs at 30%; each step's `dt` is unchanged.
- **Pause**: press `Esc` — `engine.paused = true` (`timeScale` 0). The world
  freezes dead, while the pause menu — plain React on the device clock —
  stays fully alive. Resuming restores the scale you paused at.
- **Per-unit freeze**: click a turret — `turret.ticking = false`. Its aim and
  its `every()` firing timer stop, but it stays rendered (iced over), and
  bullets it already fired keep flying: per-unit disable is unit-only.

Survive the turrets. Getting hit resets your run clock; your best run sticks.

## Run

From the repo root:

```sh
pnpm install
pnpm --filter @mise-examples/time-control dev
```

Then open the printed URL (default http://localhost:5173).

`pnpm --filter @mise-examples/time-control build` type-checks and bundles.

## Controls

| Input | Effect |
| --- | --- |
| `WASD` / arrows | Move |
| Hold `Shift` | Bullet time (`timeScale` 0.3) |
| `Esc` | Pause / resume (`engine.paused`) |
| Click a turret | Toggle its `ticking` |

## Where to look

- `src/game.tsx` — the whole game: units, timers, the `Game` controller that
  drives `timeScale` from input events and `deviceTick` (both keep working
  while paused; `justPressed` polling would not).
- `src/hud.tsx` — React overlay subscribing to `engine.timeScale$` and the
  game's score channels.
