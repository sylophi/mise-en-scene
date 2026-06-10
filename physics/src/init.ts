import { init } from "@dimforge/rapier2d-compat";

let ready = false;
let pending: Promise<void> | null = null;

/**
 * Load the Rapier WASM module. Await this once, before building any scene
 * that contains physics units (typically right before `new Engine()`).
 * Idempotent: concurrent and repeat calls share the same load.
 */
export function initPhysics(): Promise<void> {
  pending ??= init().then(() => {
    ready = true;
  });
  return pending;
}

/** Throws if {@link initPhysics} has not resolved yet. */
export function assertPhysicsReady(): void {
  if (!ready) {
    throw new Error(
      "physics is not initialized: await initPhysics() before building physics units",
    );
  }
}
