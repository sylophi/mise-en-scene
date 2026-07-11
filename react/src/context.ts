import { createContext, useContext } from "react";
import type { Engine } from "@sylophi/mise-core";

export const EngineContext = createContext<Engine | null>(null);

/** Access the engine provided by the nearest `<MiseProvider>`. */
export function useEngine(): Engine {
  const engine = useContext(EngineContext);
  if (!engine) {
    throw new Error("useEngine must be used within a <MiseProvider>");
  }
  return engine;
}
