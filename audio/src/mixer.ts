import { ObservableValue, Unit, Vector, type UnitProps } from "@mise/core";
import {
  getSharedAudioContext,
  loadAudioBuffer,
  type AudioBufferLike,
  type AudioSource,
  type GainNodeLike,
  type MiseAudioContext,
} from "./context.ts";
import type { AudioListener2D } from "./listener.ts";
import type { AudioPlayer2D } from "./players.ts";

export interface AudioMixerProps extends UnitProps {
  /**
   * The audio context to play through. Omit for the process-wide shared
   * `AudioContext` (created lazily; `null` where Web Audio does not exist).
   * Pass a stub for tests, or `null` to force silent mode.
   */
  context?: MiseAudioContext | null;
  /** Initial master volume. Default 1. */
  volume?: number;
  /** Start muted. Default false. */
  muted?: boolean;
}

/** Gestures that satisfy browser autoplay policies and unlock the context. */
const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

/**
 * The audio system unit. Players and listeners register with their nearest
 * `AudioMixer` ancestor when they enter the tree — the `PhysicsWorld2D` idiom
 * — so a scene rooted in one tears all of its sound down on `changeScene`.
 * Put a mixer at the root of your scene for scene-scoped audio, or directly
 * under `engine.root` for sound that persists across scenes (music).
 *
 * Owns a master `GainNode` on its context (`volume` × `muted`), the listener
 * slot, and the spatialization pass: each fixed tick it re-pans and
 * re-attenuates every registered `AudioPlayer2D` against the listener
 * position. It ticks before its descendants (the engine walks parent-first),
 * so game logic always hears this frame's positions.
 *
 * The context is shared and never closed by the mixer; on destroy only the
 * master gain is disconnected. Browsers create contexts `suspended` until a
 * user gesture: a live mixer arms one-shot pointer/key listeners that call
 * `resume()` and then flips `unlocked$`. Sources scheduled while suspended
 * simply begin when the context resumes.
 */
export class AudioMixer<
  P extends AudioMixerProps = AudioMixerProps,
> extends Unit<P> {
  /** The context this mixer plays through; null in headless/silent mode. */
  readonly context: MiseAudioContext | null;
  /** Every player's chain ends here; an escape hatch for custom routing. */
  readonly masterGain: GainNodeLike | null;

  /** Master volume (0..1, applied on top of per-player volume). Assignment fires `volume$`. */
  readonly volume$: ObservableValue<number>;
  get volume(): number {
    return this.volume$.get();
  }
  set volume(v: number) {
    this.volume$.set(v);
  }

  /** Hard mute that preserves `volume`. Assignment fires `muted$`. */
  readonly muted$: ObservableValue<boolean>;
  get muted(): boolean {
    return this.muted$.get();
  }
  set muted(v: boolean) {
    this.muted$.set(v);
  }

  /**
   * Whether the context is allowed to make sound. False until the browser's
   * autoplay policy is satisfied by a user gesture (the mixer resumes the
   * context on the first one); UI can subscribe to show a "click to enable
   * sound" hint. Headless mixers report true: there is nothing to unlock.
   */
  readonly unlocked$: ObservableValue<boolean>;
  get unlocked(): boolean {
    return this.unlocked$.get();
  }

  private readonly positional = new Set<AudioPlayer2D>();
  private listener: AudioListener2D | null = null;
  private disarmUnlock: (() => void) | null = null;

  constructor(props?: NoInfer<P>) {
    super(props);
    this.context =
      props?.context === undefined ? getSharedAudioContext() : props.context;
    this.masterGain = this.context?.createGain() ?? null;
    if (this.context && this.masterGain) {
      this.masterGain.connect(this.context.destination);
    }
    this.volume$ = new ObservableValue(props?.volume ?? 1);
    this.muted$ = new ObservableValue(props?.muted ?? false);
    this.unlocked$ = new ObservableValue(
      this.context ? this.context.state === "running" : true,
    );
    const apply = (): void => this.applyMasterGain();
    this.volume$.addListener(apply);
    this.muted$.addListener(apply);
    this.applyMasterGain();
  }

  override tick(_dt: number): void {
    if (this.positional.size === 0) return;
    const at = this.listenerPosition;
    for (const player of this.positional) player.updateSpatial(at);
  }

  /**
   * Where positional sound is heard from, resolved fresh on every read: an
   * `AudioListener2D` registered with this mixer, else the active camera's
   * view center (what the player actually sees — smoothing, limits, and
   * shake resolved), else the world origin.
   */
  get listenerPosition(): Vector {
    if (this.listener) {
      const m = this.listener.worldTransform;
      return new Vector(m.tx, m.ty);
    }
    const camera = this.isLive ? this.engine.activeCamera : null;
    return camera ? camera.viewCenter : Vector.zero;
  }

  /**
   * Resolve `src` to a decoded buffer through the shared per-context cache.
   * The preloading hook: `await mixer.load(url)` before the sound matters.
   * Rejects in headless mode (there is no context to decode on).
   */
  load(src: AudioSource): Promise<AudioBufferLike> {
    if (typeof src !== "string") return Promise.resolve(src);
    if (!this.context) {
      return Promise.reject(
        new Error("cannot load audio without an AudioContext"),
      );
    }
    return loadAudioBuffer(this.context, src);
  }

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    this.armUnlock();
  }

  override onTreeExit(parent: Unit | null): void {
    this.disarmUnlock?.();
    super.onTreeExit(parent);
  }

  override onDestroy(): void {
    this.masterGain?.disconnect();
  }

  private applyMasterGain(): void {
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
    }
  }

  private armUnlock(): void {
    const ctx = this.context;
    if (!ctx || this.unlocked || this.disarmUnlock) return;
    if (ctx.state === "running") {
      this.unlocked$.set(true);
      return;
    }
    const target = globalThis as Partial<
      Pick<EventTarget, "addEventListener" | "removeEventListener">
    >;
    if (typeof target.addEventListener !== "function") return;
    const onGesture = (): void => {
      void ctx
        .resume()
        .then(() => {
          this.unlocked$.set(true);
          this.disarmUnlock?.();
        })
        .catch(() => {
          // The gesture did not qualify; stay armed for the next one.
        });
    };
    for (const type of UNLOCK_EVENTS) {
      target.addEventListener(type, onGesture);
    }
    this.disarmUnlock = () => {
      for (const type of UNLOCK_EVENTS) {
        target.removeEventListener?.(type, onGesture);
      }
      this.disarmUnlock = null;
    };
  }

  /** @internal Positional players register here on tree enter. */
  register(player: AudioPlayer2D): void {
    this.positional.add(player);
    player.updateSpatial(this.listenerPosition); // correct before first tick
  }

  /** @internal */
  unregister(player: AudioPlayer2D): void {
    this.positional.delete(player);
  }

  /** @internal The most recent listener to enter wins the slot. */
  setListener(listener: AudioListener2D): void {
    this.listener = listener;
  }

  /** @internal */
  clearListener(listener: AudioListener2D): void {
    if (this.listener === listener) this.listener = null;
  }
}
