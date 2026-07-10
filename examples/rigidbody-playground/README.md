# RigidBody2D Playground

Knock-the-stack: drag anywhere to aim (a dotted arc previews the flight),
release to fling a ball at the crate pyramid. Crates flash and score on
contact — direct ball hits are worth more than chain slams. Press **R** to
reset.

Everything physical is a `RigidBody2D` from `@mise/physics`: balls and
crates fall under the world's gravity, launch with an initial velocity,
bounce with restitution, and report hits through `onContactStarted` events.

## Run

From the repository root:

```sh
pnpm install
pnpm --filter rigidbody-playground dev
```

then open the printed URL. `pnpm --filter rigidbody-playground build`
produces a production build.
