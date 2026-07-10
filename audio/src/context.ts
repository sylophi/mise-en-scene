/**
 * Structural slices of the Web Audio API: exactly the members this package
 * touches, nothing more. A real `AudioContext` satisfies `MiseAudioContext`
 * (asserted at compile time in the tests), and a test stub is a few dozen
 * lines with no jsdom. Everything downstream is typed against these, which is
 * what keeps the package headless-safe and injectable.
 */

export interface AudioParamLike {
  value: number;
}

export interface AudioNodeLike {
  connect(destination: AudioNodeLike): unknown;
  disconnect(): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface StereoPannerNodeLike extends AudioNodeLike {
  readonly pan: AudioParamLike;
}

/** The decoded-audio slice. A real `AudioBuffer` satisfies it. */
export interface AudioBufferLike {
  readonly duration: number;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  readonly playbackRate: AudioParamLike;
  onended: ((ev: Event) => unknown) | null;
  start(when?: number): void;
  stop(when?: number): void;
}

/**
 * The context slice. Inject one into `AudioMixer` via its `context` prop:
 * a real `AudioContext`, a stub (tests), or `null` (forced silent mode).
 */
export interface MiseAudioContext {
  /** `"suspended"` until the browser's autoplay policy is satisfied. */
  readonly state: string;
  readonly destination: AudioNodeLike;
  resume(): Promise<void>;
  createGain(): GainNodeLike;
  createStereoPanner(): StereoPannerNodeLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
}

/** What a player accepts as its sound: a URL to fetch and decode, or a decoded buffer (e.g. rendered procedurally with an `OfflineAudioContext`). */
export type AudioSource = string | AudioBufferLike;

let shared: MiseAudioContext | null | undefined;

/**
 * The process-wide default `AudioContext`, created lazily on first use, or
 * `null` where the Web Audio API does not exist (node, SSR). Shared because
 * browsers cap live contexts and autoplay unlock is per-context: every
 * `AudioMixer` without an explicit `context` prop uses this one.
 */
export function getSharedAudioContext(): MiseAudioContext | null {
  if (shared !== undefined) return shared;
  const Ctor = (globalThis as { AudioContext?: new () => MiseAudioContext })
    .AudioContext;
  shared = Ctor ? new Ctor() : null;
  return shared;
}

// One decode cache per context (buffers are bound to the context that decoded
// them), one entry per URL: many players sharing a `src` fetch/decode once.
const caches = new WeakMap<
  MiseAudioContext,
  Map<string, Promise<AudioBufferLike>>
>();

/**
 * Fetch and decode `url` on `ctx`, through the shared cache. Exposed to games
 * via `AudioMixer.load` (preloading); players call it internally.
 */
export function loadAudioBuffer(
  ctx: MiseAudioContext,
  url: string,
): Promise<AudioBufferLike> {
  let cache = caches.get(ctx);
  if (!cache) {
    cache = new Map();
    caches.set(ctx, cache);
  }
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data));
    // A failed load should be retryable, not cached forever.
    pending.catch(() => cache.delete(url));
    cache.set(url, pending);
  }
  return pending;
}
