import type { Engine } from "@mise/core";
import type { ReactNode } from "react";
import { EngineContext } from "./context.ts";
import { Compositor } from "./compositor.tsx";

export interface MiseProviderProps {
  /** The engine to view. You build, configure, and (self-)start it. */
  engine: Engine;
  /**
   * Optional overlay rendered on top of the compositor (HUD, menus, debug UI).
   * Can use `useEngine`/`useObservable`.
   */
  children?: ReactNode;
}

/**
 * Provides the engine via context and renders its world (the compositor).
 *
 * The engine runs independently of React: it is injected, not created here, and
 * controls its own start/stop. This component only observes and draws it.
 */
export function MiseProvider({
  engine,
  children,
}: MiseProviderProps): ReactNode {
  return (
    <EngineContext.Provider value={engine}>
      <Compositor />
      {children}
    </EngineContext.Provider>
  );
}
