import { ObservableEvent, ObservableValue } from "@mise/core";
import {
  loadAudioBuffer,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioNodeLike,
  type AudioSource,
  type GainNodeLike,
  type StereoPannerNodeLike,
} from "./context.ts";
import type { AudioMixer } from "./mixer.ts";

/**
 * @internal The playback core shared by `AudioPlayer` and `AudioPlayer2D`
 * (which cannot share a base class: one is a `Unit`, the other a `Unit2D`).
 * Owns the node chain `source → gain → [panner] → mixer.masterGain` and the
 * play/stop/finished state machine.
 *
 * Degrades gracefully: with no context (headless) it tracks intent
 * (`playing$`) and skips node work; with no buffer yet it starts the source
 * once the decode lands.
 */
export class Playback {
  /** Intent to be audible: true from `play()` until `stop()` or natural end. */
  readonly playing$ = new ObservableValue(false);
  /** Fires when a non-looping source reaches its natural end. */
  readonly onFinished = new ObservableEvent<void>();

  private mixer: AudioMixer | null = null;
  private gain: GainNodeLike | null = null;
  private panner: StereoPannerNodeLike | null = null;
  private source: AudioBufferSourceNodeLike | null = null;
  private buffer: AudioBufferLike | null = null;

  private volume = 1;
  private rate = 1;
  private loop = false;
  private attenuation = 1;
  private pan = 0;

  constructor(
    private readonly positional: boolean,
    private readonly src: AudioSource,
  ) {
    if (typeof src !== "string") this.buffer = src;
  }

  /** Wire into `mixer`'s graph and kick off the buffer decode. Tree enter. */
  attach(mixer: AudioMixer): void {
    this.mixer = mixer;
    const ctx = mixer.context;
    const master = mixer.masterGain;
    if (ctx && master) {
      this.gain = ctx.createGain();
      let tail: AudioNodeLike = this.gain;
      if (this.positional) {
        this.panner = ctx.createStereoPanner();
        this.panner.pan.value = this.pan;
        tail.connect(this.panner);
        tail = this.panner;
      }
      tail.connect(master);
      this.applyGain();
    }
    if (this.buffer) {
      if (this.playing$.get()) this.startSource();
    } else if (ctx && typeof this.src === "string") {
      const url = this.src;
      loadAudioBuffer(ctx, url)
        .then((buffer) => {
          if (this.mixer !== mixer || this.buffer) return; // detached or raced
          this.buffer = buffer;
          if (this.playing$.get()) this.startSource();
        })
        .catch((err: unknown) => {
          console.warn(`[@mise/audio] failed to load "${url}"`, err);
        });
    }
  }

  /** Stop and unplug from the mixer graph. Tree exit. */
  detach(): void {
    this.stop();
    this.gain?.disconnect();
    this.panner?.disconnect();
    this.gain = null;
    this.panner = null;
    this.mixer = null;
  }

  /**
   * Start (or restart from the top). Off-tree or mid-decode this records
   * intent; the source starts as soon as both the mixer and buffer exist.
   */
  play(): void {
    this.playing$.set(true);
    if (this.mixer && this.buffer) this.startSource();
  }

  stop(): void {
    this.playing$.set(false);
    this.stopSource();
  }

  private startSource(): void {
    this.stopSource();
    const ctx = this.mixer?.context;
    if (!ctx || !this.gain || !this.buffer) return; // headless: intent only
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.loop = this.loop;
    source.playbackRate.value = this.rate;
    source.connect(this.gain);
    // The structural context interface exposes only `onended` (keeps test
    // stubs trivial); exactly one handler per source is the point (stopSource).
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    source.onended = () => {
      if (this.source !== source) return; // superseded by a restart
      this.source = null;
      this.playing$.set(false);
      this.onFinished.fire();
    };
    this.source = source;
    source.start();
  }

  private stopSource(): void {
    const source = this.source;
    if (!source) return;
    this.source = null;
    // Clearing the handler: a commanded stop is not a "finish".
    // oxlint-disable-next-line unicorn/prefer-add-event-listener
    source.onended = null;
    source.stop();
    source.disconnect();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.applyGain();
  }

  /** Distance attenuation factor in [0, 1]; the mixer drives this for 2D players. */
  setAttenuation(attenuation: number): void {
    this.attenuation = attenuation;
    this.applyGain();
  }

  setPan(pan: number): void {
    this.pan = pan;
    if (this.panner) this.panner.pan.value = pan;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
    if (this.source) this.source.loop = loop;
  }

  setRate(rate: number): void {
    this.rate = rate;
    if (this.source) this.source.playbackRate.value = rate;
  }

  private applyGain(): void {
    if (this.gain) this.gain.gain.value = this.volume * this.attenuation;
  }
}
