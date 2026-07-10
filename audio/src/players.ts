import {
  clamp,
  ObservableValue,
  Unit,
  Unit2D,
  type ObservableEvent,
  type UnitProps,
  type Unit2DProps,
  type Vector,
} from "@mise/core";
import type { AudioSource } from "./context.ts";
import { AudioMixer } from "./mixer.ts";
import { Playback } from "./playback.ts";

/** Playback props shared by both player units. */
interface PlaybackProps {
  /** A URL to fetch and decode (cached per context), or a decoded buffer. */
  src: AudioSource;
  /** Play on every tree enter. Default true. */
  autoplay?: boolean;
  /** Loop until stopped. Default false. */
  loop?: boolean;
  /** Initial volume (0..1). Default 1. */
  volume?: number;
  /** Initial playback rate (1 = normal; doubles as a pitch control). Default 1. */
  playbackRate?: number;
}

export interface AudioPlayerProps extends UnitProps, PlaybackProps {}

/**
 * Non-positional sound: music, UI feedback. Plays through the nearest
 * `AudioMixer` ancestor (throws on tree enter without one). With `autoplay`
 * (the default) it plays on every tree enter; it always stops on tree exit,
 * so `changeScene` silences it like everything else.
 *
 * `play()` before the unit is live or before its buffer decodes records
 * intent (`playing$` fires now) and starts the source as soon as possible.
 */
export class AudioPlayer<
  P extends AudioPlayerProps = AudioPlayerProps,
> extends Unit<P> {
  protected readonly playback: Playback;
  private mixer: AudioMixer | null = null;

  /** Volume (0..1), multiplied under the mixer's master. Assignment fires `volume$`. */
  readonly volume$: ObservableValue<number>;
  get volume(): number {
    return this.volume$.get();
  }
  set volume(v: number) {
    this.volume$.set(v);
  }

  /** Whether the sound loops. Assignment fires `loop$` (applies mid-play). */
  readonly loop$: ObservableValue<boolean>;
  get loop(): boolean {
    return this.loop$.get();
  }
  set loop(v: boolean) {
    this.loop$.set(v);
  }

  /** Playback rate (resamples: 2 is an octave up). Assignment fires `playbackRate$`. */
  readonly playbackRate$: ObservableValue<number>;
  get playbackRate(): number {
    return this.playbackRate$.get();
  }
  set playbackRate(v: number) {
    this.playbackRate$.set(v);
  }

  /** Intent to be audible; flips off on `stop()`, tree exit, or natural end. */
  get playing$(): ObservableValue<boolean> {
    return this.playback.playing$;
  }
  get playing(): boolean {
    return this.playback.playing$.get();
  }

  /** Fires when a non-looping sound reaches its natural end. */
  get onFinished(): ObservableEvent<void> {
    return this.playback.onFinished;
  }

  /** The mixer this player is registered with, while live. */
  get audioMixer(): AudioMixer | null {
    return this.mixer;
  }

  constructor(props: NoInfer<P>) {
    super(props);
    this.playback = new Playback(false, props.src);
    this.volume$ = new ObservableValue(props.volume ?? 1);
    this.loop$ = new ObservableValue(props.loop ?? false);
    this.playbackRate$ = new ObservableValue(props.playbackRate ?? 1);
    this.volume$.addListener((v) => this.playback.setVolume(v));
    this.loop$.addListener((v) => this.playback.setLoop(v));
    this.playbackRate$.addListener((v) => this.playback.setRate(v));
    this.playback.setVolume(this.volume);
    this.playback.setLoop(this.loop);
    this.playback.setRate(this.playbackRate);
  }

  /** Start playback (restarts from the top if already playing). */
  play(): void {
    this.playback.play();
  }

  stop(): void {
    this.playback.stop();
  }

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    const mixer = this.findAncestor(AudioMixer);
    if (!mixer) {
      throw new Error(
        `${this.constructor.name} must be a descendant of an AudioMixer`,
      );
    }
    this.mixer = mixer;
    this.playback.attach(mixer);
    if (this.props.autoplay ?? true) this.play();
  }

  override onTreeExit(parent: Unit | null): void {
    this.playback.detach(); // stops, so playing$ flips false
    this.mixer = null;
    super.onTreeExit(parent);
  }
}

export interface AudioPlayer2DProps extends Unit2DProps, PlaybackProps {
  /**
   * Distance (world units) at which the sound becomes inaudible. Default 100.
   */
  maxDistance?: number;
  /**
   * Horizontal distance from the listener at which panning reaches full
   * left/right. Default `maxDistance / 2`.
   */
  panRange?: number;
  /**
   * Attenuation curve exponent: `(1 - d / maxDistance) ^ rolloff`. 1 is
   * linear (the default); higher falls off faster near the listener.
   */
  rolloff?: number;
}

/**
 * Positional sound: a `Unit2D` panned and attenuated against the mixer's
 * listener (an explicit `AudioListener2D`, else the active camera's view
 * center). The mixer recomputes both every fixed tick from world transforms,
 * so a player parented to a moving unit just sounds right.
 *
 * Same playback surface as `AudioPlayer`, plus read-only `pan$` and
 * `attenuation$` with the resolved spatial values (handy for debug UI and
 * "how close am I" gameplay).
 */
export class AudioPlayer2D<
  P extends AudioPlayer2DProps = AudioPlayer2DProps,
> extends Unit2D<P> {
  protected readonly playback: Playback;
  private mixer: AudioMixer | null = null;

  /** Horizontal distance for full pan; fixed at construction. */
  readonly panRange: number;
  /** Attenuation curve exponent; fixed at construction. */
  readonly rolloff: number;

  /** Base volume (0..1); distance attenuation multiplies on top. Assignment fires `volume$`. */
  readonly volume$: ObservableValue<number>;
  get volume(): number {
    return this.volume$.get();
  }
  set volume(v: number) {
    this.volume$.set(v);
  }

  /** Whether the sound loops. Assignment fires `loop$` (applies mid-play). */
  readonly loop$: ObservableValue<boolean>;
  get loop(): boolean {
    return this.loop$.get();
  }
  set loop(v: boolean) {
    this.loop$.set(v);
  }

  /** Playback rate (resamples: 2 is an octave up). Assignment fires `playbackRate$`. */
  readonly playbackRate$: ObservableValue<number>;
  get playbackRate(): number {
    return this.playbackRate$.get();
  }
  set playbackRate(v: number) {
    this.playbackRate$.set(v);
  }

  /** Audible range in world units. Assignment fires `maxDistance$`. */
  readonly maxDistance$: ObservableValue<number>;
  get maxDistance(): number {
    return this.maxDistance$.get();
  }
  set maxDistance(v: number) {
    this.maxDistance$.set(v);
  }

  /** Resolved stereo pan in [-1, 1], written by the mixer each fixed tick. */
  readonly pan$ = new ObservableValue(0);
  get pan(): number {
    return this.pan$.get();
  }

  /** Resolved distance attenuation in [0, 1], written each fixed tick. */
  readonly attenuation$ = new ObservableValue(1);
  get attenuation(): number {
    return this.attenuation$.get();
  }

  /** Intent to be audible; flips off on `stop()`, tree exit, or natural end. */
  get playing$(): ObservableValue<boolean> {
    return this.playback.playing$;
  }
  get playing(): boolean {
    return this.playback.playing$.get();
  }

  /** Fires when a non-looping sound reaches its natural end. */
  get onFinished(): ObservableEvent<void> {
    return this.playback.onFinished;
  }

  /** The mixer this player is registered with, while live. */
  get audioMixer(): AudioMixer | null {
    return this.mixer;
  }

  constructor(props: NoInfer<P>) {
    super(props);
    this.playback = new Playback(true, props.src);
    const maxDistance = props.maxDistance ?? 100;
    this.panRange = props.panRange ?? maxDistance / 2;
    this.rolloff = props.rolloff ?? 1;
    this.maxDistance$ = new ObservableValue(maxDistance);
    this.volume$ = new ObservableValue(props.volume ?? 1);
    this.loop$ = new ObservableValue(props.loop ?? false);
    this.playbackRate$ = new ObservableValue(props.playbackRate ?? 1);
    this.volume$.addListener((v) => this.playback.setVolume(v));
    this.loop$.addListener((v) => this.playback.setLoop(v));
    this.playbackRate$.addListener((v) => this.playback.setRate(v));
    this.playback.setVolume(this.volume);
    this.playback.setLoop(this.loop);
    this.playback.setRate(this.playbackRate);
  }

  /** Start playback (restarts from the top if already playing). */
  play(): void {
    this.playback.play();
  }

  stop(): void {
    this.playback.stop();
  }

  override onTreeEnter(parent: Unit | null): void {
    super.onTreeEnter(parent);
    const mixer = this.findAncestor(AudioMixer);
    if (!mixer) {
      throw new Error(
        `${this.constructor.name} must be a descendant of an AudioMixer`,
      );
    }
    this.mixer = mixer;
    this.playback.attach(mixer);
    mixer.register(this); // also spatializes immediately
    if (this.props.autoplay ?? true) this.play();
  }

  override onTreeExit(parent: Unit | null): void {
    this.mixer?.unregister(this);
    this.playback.detach(); // stops, so playing$ flips false
    this.mixer = null;
    super.onTreeExit(parent);
  }

  /**
   * @internal Recompute pan and attenuation against the listener position.
   * Called by the mixer each fixed tick (and once on registration).
   */
  updateSpatial(listener: Vector): void {
    const m = this.worldTransform;
    const dx = m.tx - listener.x;
    const dy = m.ty - listener.y;
    const distance = Math.hypot(dx, dy);
    const maxDistance = this.maxDistance;
    const t = maxDistance > 0 ? Math.min(distance / maxDistance, 1) : 1;
    const attenuation = (1 - t) ** this.rolloff;
    const pan = this.panRange > 0 ? clamp(dx / this.panRange, -1, 1) : 0;
    this.attenuation$.set(attenuation);
    this.pan$.set(pan);
    this.playback.setAttenuation(attenuation);
    this.playback.setPan(pan);
  }
}
