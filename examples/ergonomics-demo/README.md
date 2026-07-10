# ergonomics-demo — Gem Rush

A tiny playable dodger/clicker showing the `@mise/core` reactive-state sugar
end to end:

- every unit declares state as `@observable accessor` one-liners instead of
  the manual channel/getter/setter trio;
- `@observable({ equals: structuralEquals }) accessor sector = Vector.zero`
  demonstrates the `ObservableValue` equality option: the field is rewritten
  with a fresh `Vector` every tick, but subscribers only hear about real
  changes;
- the HUD subscribes via `useObservable` through both typed-channel styles
  (`declare readonly hp$` and `channel(unit, "glow")`) and shows **render
  counters** for two identically-written sector fields — one with structural
  equality (a handful of renders), one with the default `===` (~60/s).

Move with WASD or the arrow keys. Grab gems (score), dodge the chaser (hp);
the chaser speeds up as your score grows, and the round resets at 0 hp.

## Run

From the repo root:

```sh
pnpm install
pnpm --filter ergonomics-demo dev      # http://localhost:5173
pnpm --filter ergonomics-demo build    # type-check + production build
```

Note: the app intentionally renders without `<StrictMode>` so the HUD's
render counters aren't inflated by React's dev-mode double rendering.
