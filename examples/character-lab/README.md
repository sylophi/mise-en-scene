# Character Lab

A playable playground for `@mise/physics`'s character presets and world
queries: stairs for **autostep**, ramps of two steepnesses for **maxSlope**,
descents that show off **snapToGround**, a ground-check **shape cast**
(the yellow marker under the player), and a click-to-inspect **point query**.

## Run

```sh
pnpm install          # once, from the repo root
pnpm --filter character-lab dev
```

Open the printed URL. `pnpm --filter character-lab build` builds for
production.

## Try this

- **A/D** move, **Space** jump, **R** respawn. Click anything to identify it
  (the panel lists what is under the pointer; the shape flashes).
- Walk right into the stairs: you stop dead. Toggle **autostep** and walk up
  them. Lower the height slider below 1.2 and you stop again.
- Walk left up the gentle ramp (24°): fine at the default 45° limit. The
  steep ramp (55°) refuses you until you raise **max slope** past it.
- Walk down either ramp fast and watch **on floor** flicker in the panel;
  enable **snap** and it stays green while you hug the descent.
- The yellow ring is a `castShape` of the player's own capsule swept
  downward: it marks where you would land, and its distance is in the panel.
