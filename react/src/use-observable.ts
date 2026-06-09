import { useCallback, useSyncExternalStore } from "react";
import type { ObservableValue } from "@mise/core";

/**
 * Subscribe a component to a single `ObservableValue` and return its current
 * value. The component re-renders only when *that* value fires. Reads stay
 * tear-free via `useSyncExternalStore`.
 *
 * `ObservableValue` only fires on a real change (it skips `===`-equal sets), so
 * the snapshot reference is stable between renders — no extra memoization needed.
 */
export function useObservable<T>(ov: ObservableValue<T>): T {
  const subscribe = useCallback(
    (onChange: () => void) => ov.addListener(onChange),
    [ov],
  );
  return useSyncExternalStore(
    subscribe,
    () => ov.get(),
    () => ov.get(),
  );
}
