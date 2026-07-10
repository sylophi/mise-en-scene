import { ObservableValue, Unit } from "@mise/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEngine } from "./context.ts";
import { useObservable } from "./use-observable.ts";

/**
 * Pure frame math: which frame a clip shows after `elapsed` seconds of engine
 * time. Non-looping clips clamp on the last frame and report `finished` once
 * that frame has been shown for its full `1/fps`. Degenerate inputs
 * (`frameCount <= 0`, `fps <= 0`) hold frame 0 forever.
 */
export function frameAt(
  elapsed: number,
  frameCount: number,
  fps: number,
  loop: boolean,
): { frame: number; finished: boolean } {
  if (frameCount <= 0 || fps <= 0) return { frame: 0, finished: false };
  const raw = Math.floor(Math.max(0, elapsed) * fps);
  if (loop) return { frame: raw % frameCount, finished: false };
  if (raw >= frameCount) return { frame: frameCount - 1, finished: true };
  return { frame: raw, finished: false };
}

interface ClipOptions {
  frameCount: number;
  fps: number;
  loop: boolean;
  onFinished: (() => void) | undefined;
}

/**
 * The clip state a `useSpriteAnimation` call owns. Lives in React state (so it
 * survives StrictMode remounts) and is advanced by a driver unit on the
 * engine's fixed clock.
 */
class SpriteClip {
  readonly frame$ = new ObservableValue(0);
  readonly playing$: ObservableValue<boolean>;
  readonly opts: ClipOptions;
  private elapsed = 0;
  private finished = false;

  constructor(opts: ClipOptions, playing: boolean) {
    this.opts = opts;
    this.playing$ = new ObservableValue(playing);
  }

  /** Advance by `dt` seconds of engine time. No-op while stopped/finished. */
  advance(dt: number): void {
    if (!this.playing$.get()) return;
    this.elapsed += dt;
    const { frameCount, fps, loop } = this.opts;
    const { frame, finished } = frameAt(this.elapsed, frameCount, fps, loop);
    this.frame$.set(frame);
    if (finished) {
      this.finished = true;
      this.playing$.set(false);
      this.opts.onFinished?.();
    }
  }

  /** Resume; a finished clip restarts from frame 0. */
  play(): void {
    if (this.finished) {
      this.elapsed = 0;
      this.finished = false;
      this.frame$.set(0);
    }
    this.playing$.set(true);
  }

  stop(): void {
    this.playing$.set(false);
  }

  /** Jump to `frame` (clamped) and rewind the clock there. Shows immediately. */
  gotoFrame(frame: number): void {
    const { frameCount, fps } = this.opts;
    const f =
      frameCount > 0
        ? Math.min(Math.max(0, Math.floor(frame)), frameCount - 1)
        : 0;
    this.elapsed = fps > 0 ? f / fps : 0;
    this.finished = false;
    this.frame$.set(f);
  }
}

/**
 * Invisible, non-renderable driver: advances its clip on the fixed tick, so
 * the animation runs on engine time and freezes whenever the engine does.
 */
class SpriteClipDriver extends Unit {
  constructor(private readonly clip: SpriteClip) {
    super();
  }
  override tick(dt: number): void {
    this.clip.advance(dt);
  }
}

export interface SpriteAnimationOptions {
  /** Number of frames in the clip. */
  frameCount: number;
  /** Frames per second of *engine* time. Default 10. */
  fps?: number;
  /** Loop (default) or clamp on the last frame. */
  loop?: boolean;
  /**
   * Declarative play/stop. Omit to control imperatively via `play()`/`stop()`
   * (the clip starts playing). Prop changes and imperative calls both write
   * the same state; last write wins.
   */
  playing?: boolean;
  /**
   * Fires once when a non-looping clip finishes (last frame shown for its
   * full `1/fps`). The clip stops; `play()` restarts it from frame 0.
   */
  onFinished?: () => void;
}

export interface SpriteAnimation {
  /** Current frame index. Reading it subscribes the component. */
  frame: number;
  /** Whether the clip is advancing. Reading it subscribes the component. */
  playing: boolean;
  play(): void;
  stop(): void;
  gotoFrame(frame: number): void;
}

/**
 * Drive a frame counter on the engine's fixed clock. The hook mounts an
 * invisible driver unit under `engine.root` (the "tween as invisible unit"
 * idiom), so frames advance exactly when `engine.time` does: pausing or
 * stepping the engine pauses or steps the animation, and wall-clock time
 * never leaks in. Usable in any component under `<MiseProvider>`; see
 * `<AnimatedSprite>` for the batteries-included version.
 */
export function useSpriteAnimation(
  options: SpriteAnimationOptions,
): SpriteAnimation {
  const engine = useEngine();
  const { frameCount, fps = 10, loop = true, playing, onFinished } = options;

  // Latest-callback ref so the clip never captures a stale `onFinished`.
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const [clip] = useState(
    () =>
      new SpriteClip(
        { frameCount, fps, loop, onFinished: () => onFinishedRef.current?.() },
        playing ?? true,
      ),
  );

  // Keep clip parameters in sync with the latest props.
  useEffect(() => {
    clip.opts.frameCount = frameCount;
    clip.opts.fps = fps;
    clip.opts.loop = loop;
  }, [clip, frameCount, fps, loop]);

  // Sync the declarative `playing` prop (when provided).
  useEffect(() => {
    if (playing === undefined) return;
    if (playing) clip.play();
    else clip.stop();
  }, [clip, playing]);

  // Mount the driver for the component's lifetime. Created inside the effect:
  // destroyed units cannot re-enter the tree, so StrictMode's
  // mount/unmount/mount gets a fresh driver each time while the clip persists.
  useEffect(() => {
    const driver = new SpriteClipDriver(clip);
    engine.root.addChild(driver);
    return () => driver.destroy();
  }, [engine, clip]);

  const frame = useObservable(clip.frame$);
  const isPlaying = useObservable(clip.playing$);
  const play = useCallback(() => clip.play(), [clip]);
  const stop = useCallback(() => clip.stop(), [clip]);
  const gotoFrame = useCallback((f: number) => clip.gotoFrame(f), [clip]);

  return { frame, playing: isPlaying, play, stop, gotoFrame };
}
