import { useCallback, useSyncExternalStore } from "react";
import type { ObservableValue } from "@mise/core";
import { useFlusher } from "./frame-flusher.ts";

/**
 * Subscribe a component to a single `ObservableValue` and return its current
 * value. The component re-renders only when *that* value fires. Reads stay
 * tear-free via `useSyncExternalStore`.
 *
 * Under a `<MiseProvider>`, re-renders are batched: changes mark the component
 * dirty and one render flushes per device tick (see `FrameFlusher`), so a value
 * written every fixed tick costs one render per frame, with the latest value.
 * Outside a provider the hook falls back to per-change notification.
 *
 * `ObservableValue` only fires on a real change (it skips `===`-equal sets), so
 * the snapshot reference is stable between renders; no extra memoization needed.
 */
export function useObservable<T>(ov: ObservableValue<T>): T {
  const flusher = useFlusher();
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!flusher) return ov.addListener(onStoreChange);
      const unsub = ov.addListener(() => flusher.enqueue(onStoreChange));
      return () => {
        unsub();
        flusher.cancel(onStoreChange); // don't notify an unmounted subscriber
      };
    },
    [ov, flusher],
  );
  return useSyncExternalStore(
    subscribe,
    () => ov.get(),
    () => ov.get(),
  );
}
