// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Camera, Engine, mes } from "@mise/core";
import { MiseProvider } from "./mise-provider.tsx";
import { Renderable, type RenderableProps } from "./renderable.ts";
import {
  frameAt,
  useSpriteAnimation,
  type SpriteAnimation,
  type SpriteAnimationOptions,
} from "./sprite-animation.ts";
import { AnimatedSprite } from "./animated-sprite.tsx";

describe("frameAt", () => {
  it("maps elapsed time to a frame index", () => {
    expect(frameAt(0, 4, 10, true).frame).toBe(0);
    expect(frameAt(0.05, 4, 10, true).frame).toBe(0);
    expect(frameAt(0.1, 4, 10, true).frame).toBe(1);
    expect(frameAt(0.35, 4, 10, true).frame).toBe(3);
  });

  it("wraps when looping and never finishes", () => {
    expect(frameAt(0.4, 4, 10, true)).toEqual({ frame: 0, finished: false });
    expect(frameAt(0.95, 4, 10, true)).toEqual({ frame: 1, finished: false });
  });

  it("clamps on the last frame and finishes after its full duration", () => {
    // Last frame starts at 0.3s and holds until 0.4s; only then finished.
    expect(frameAt(0.3, 4, 10, false)).toEqual({ frame: 3, finished: false });
    expect(frameAt(0.39, 4, 10, false)).toEqual({ frame: 3, finished: false });
    expect(frameAt(0.4, 4, 10, false)).toEqual({ frame: 3, finished: true });
    expect(frameAt(99, 4, 10, false)).toEqual({ frame: 3, finished: true });
  });

  it("holds frame 0 on degenerate input", () => {
    expect(frameAt(5, 0, 10, false)).toEqual({ frame: 0, finished: false });
    expect(frameAt(5, 4, 0, false)).toEqual({ frame: 0, finished: false });
    expect(frameAt(-1, 4, 10, false).frame).toBe(0);
  });
});

// ── Hook, driven by a manually-stepped engine ────────────────────────────────

/** Captures the hook's return so tests can call play/stop/gotoFrame. */
let anim!: SpriteAnimation;

interface SpriteProps extends RenderableProps {
  options: SpriteAnimationOptions;
}

class Sprite extends Renderable<SpriteProps> {
  readonly component = ({ unit }: { unit: Sprite }) => {
    anim = useSpriteAnimation(unit.props.options);
    return <div data-testid="frame">{anim.frame}</div>;
  };
}

/** Fixed step of one second, stepped manually; fps 1 → one frame per step. */
function makeEngine(): Engine {
  const engine = new Engine({
    autoStart: false,
    fixedStep: 1,
    maxCatchUp: 100,
  });
  const camera = new Camera({ width: 100, height: 100 });
  engine.root.addChild(camera);
  engine.activeCamera = camera;
  return engine;
}

function mountSprite(
  engine: Engine,
  options: SpriteAnimationOptions,
): ReturnType<typeof render> {
  engine.changeScene(mes(Sprite, { options }));
  return render(<MiseProvider engine={engine} />);
}

const frameText = (): string => screen.getByTestId("frame").textContent ?? "";
const step = (engine: Engine, seconds: number): void =>
  act(() => engine.advanceFixed(seconds));

afterEach(() => cleanup());

describe("useSpriteAnimation", () => {
  it("advances one frame per engine second at fps 1", async () => {
    const engine = makeEngine();
    mountSprite(engine, { frameCount: 4, fps: 1 });
    expect(frameText()).toBe("0");
    step(engine, 1);
    expect(frameText()).toBe("1");
    step(engine, 2);
    expect(frameText()).toBe("3");
  });

  it("does not advance when the engine does not (pause)", () => {
    const engine = makeEngine();
    mountSprite(engine, { frameCount: 4, fps: 1 });
    step(engine, 1);
    expect(frameText()).toBe("1");
    // No advanceFixed calls: engine.time is frozen, so is the animation.
    expect(frameText()).toBe("1");
    step(engine, 0); // feeding zero real time runs no fixed step
    expect(frameText()).toBe("1");
  });

  it("loops back to frame 0", () => {
    const engine = makeEngine();
    mountSprite(engine, { frameCount: 4, fps: 1, loop: true });
    step(engine, 4);
    expect(frameText()).toBe("0");
    step(engine, 1);
    expect(frameText()).toBe("1");
  });

  it("clamps, fires onFinished once, and stops when not looping", () => {
    const engine = makeEngine();
    const onFinished = vi.fn();
    mountSprite(engine, { frameCount: 4, fps: 1, loop: false, onFinished });
    step(engine, 3);
    expect(frameText()).toBe("3");
    expect(onFinished).not.toHaveBeenCalled(); // last frame still showing
    step(engine, 1);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(anim.playing).toBe(false);
    step(engine, 5);
    expect(frameText()).toBe("3"); // clamped
    expect(onFinished).toHaveBeenCalledTimes(1); // never re-fires
  });

  it("play() restarts a finished clip from frame 0", () => {
    const engine = makeEngine();
    mountSprite(engine, { frameCount: 3, fps: 1, loop: false });
    step(engine, 3);
    expect(frameText()).toBe("2");
    act(() => anim.play());
    expect(frameText()).toBe("0");
    expect(anim.playing).toBe(true);
    step(engine, 1);
    expect(frameText()).toBe("1");
  });

  it("stop() freezes the clip; play() resumes where it left off", () => {
    const engine = makeEngine();
    mountSprite(engine, { frameCount: 4, fps: 1 });
    step(engine, 1);
    act(() => anim.stop());
    step(engine, 2);
    expect(frameText()).toBe("1"); // engine advanced, clip did not
    act(() => anim.play());
    step(engine, 1);
    expect(frameText()).toBe("2");
  });

  it("gotoFrame() jumps immediately, even while stopped", () => {
    const engine = makeEngine();
    mountSprite(engine, { frameCount: 4, fps: 1, playing: false });
    expect(frameText()).toBe("0");
    act(() => anim.gotoFrame(2));
    expect(frameText()).toBe("2");
    act(() => anim.gotoFrame(99));
    expect(frameText()).toBe("3"); // clamped to the last frame
  });

  it("honors the declarative playing prop", () => {
    const engine = makeEngine();
    mountSprite(engine, { frameCount: 4, fps: 1, playing: false });
    step(engine, 2);
    expect(frameText()).toBe("0");
  });

  it("cleans up its driver unit on unmount", () => {
    const engine = makeEngine();
    engine.changeScene(mes(Sprite, { options: { frameCount: 4, fps: 1 } }));
    const before = engine.root.children.length;
    const view = render(<MiseProvider engine={engine} />);
    expect(engine.root.children.length).toBe(before + 1); // + the clip driver
    view.unmount();
    expect(engine.root.children.length).toBe(before);
  });
});

// ── AnimatedSprite component ─────────────────────────────────────────────────

class SheetSprite extends Renderable {
  readonly component = () => (
    <AnimatedSprite
      sheet={{ src: "/walk.png", columns: 3, rows: 2 }}
      fps={1}
      width={8}
      height={8}
    />
  );
}

class ImagesSprite extends Renderable {
  readonly component = () => (
    <AnimatedSprite
      images={["/f0.png", "/f1.png"]}
      fps={1}
      width={4}
      height={4}
    />
  );
}

describe("AnimatedSprite", () => {
  it("walks a sheet grid via background-position in camera units", () => {
    const engine = makeEngine();
    engine.changeScene(mes(SheetSprite, {}));
    render(<MiseProvider engine={engine} />);
    const el = document.querySelector<HTMLElement>(
      "[data-unit-id] > div:first-child",
    )!;
    expect(el.style.backgroundImage).toContain("/walk.png");
    expect(el.style.backgroundSize).toBe(
      "calc(24 * var(--u)) calc(16 * var(--u))",
    );
    expect(el.style.backgroundPosition).toBe(
      "calc(0 * var(--u)) calc(0 * var(--u))",
    );
    step(engine, 4); // frame 4 → column 1, row 1
    expect(el.style.backgroundPosition).toBe(
      "calc(-8 * var(--u)) calc(-8 * var(--u))",
    );
  });

  it("swaps img src per frame in multi-image mode", () => {
    const engine = makeEngine();
    engine.changeScene(mes(ImagesSprite, {}));
    render(<MiseProvider engine={engine} />);
    const img = document.querySelector<HTMLImageElement>("img")!;
    expect(img.getAttribute("src")).toBe("/f0.png");
    step(engine, 1);
    expect(img.getAttribute("src")).toBe("/f1.png");
    step(engine, 1); // loops
    expect(img.getAttribute("src")).toBe("/f0.png");
  });
});
