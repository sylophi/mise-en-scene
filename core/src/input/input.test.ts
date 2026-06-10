import { describe, expect, it } from "vitest";
import { Input } from "./input.ts";
import { Vector } from "../primitives/vector.ts";

describe("Input polling", () => {
  it("tracks key down state", () => {
    const input = new Input();
    expect(input.isDown("a")).toBe(false);
    input.feedKeyDown("a");
    expect(input.isDown("a")).toBe(true);
    input.feedKeyUp("a");
    expect(input.isDown("a")).toBe(false);
  });

  it("derives justPressed/justReleased across tick boundaries", () => {
    const input = new Input();
    input.feedKeyDown("Space");
    expect(input.justPressed("Space")).toBe(true);
    input.advanceTick();
    expect(input.justPressed("Space")).toBe(false);
    expect(input.isDown("Space")).toBe(true);
    input.feedKeyUp("Space");
    expect(input.justReleased("Space")).toBe(true);
    input.advanceTick();
    expect(input.justReleased("Space")).toBe(false);
  });

  it("ignores auto-repeat key-down", () => {
    const input = new Input();
    let fires = 0;
    input.onKeyDown.addListener(() => fires++);
    input.feedKeyDown("a");
    input.feedKeyDown("a");
    expect(fires).toBe(1);
  });
});

describe("key normalization", () => {
  it("treats a key and its shifted character as the same key", () => {
    const input = new Input();
    input.feedKeyDown("J");
    expect(input.isDown("j")).toBe(true);
    expect(input.isDown("J")).toBe(true);
    expect(input.justPressed("j")).toBe(true);
  });

  it("cannot get a key stuck down across a Shift press", () => {
    const input = new Input();
    input.feedKeyDown("j"); // pressed plain
    input.feedKeyUp("J"); // released while Shift is held
    expect(input.isDown("j")).toBe(false);
  });

  it("passes named keys through unchanged", () => {
    const input = new Input();
    input.feedKeyDown("ArrowUp");
    expect(input.isDown("ArrowUp")).toBe(true);
  });

  it("fires events with the normalized key", () => {
    const input = new Input();
    const keys: string[] = [];
    input.onKeyDown.addListener((e) => keys.push(e.key));
    input.feedKeyDown("J");
    expect(keys).toEqual(["j"]);
  });
});

describe("Input events & pointer", () => {
  it("fires key events with payloads", () => {
    const input = new Input();
    let key = "";
    input.onKeyDown.addListener((e) => (key = e.key));
    input.feedKeyDown("x");
    expect(key).toBe("x");
  });

  it("updates pointer position and fires move", () => {
    const input = new Input();
    let moved: Vector | null = null;
    input.onPointerMove.addListener((e) => (moved = e.position));
    input.feedPointerMove(new Vector(3, 4));
    expect(input.pointer.equals(new Vector(3, 4))).toBe(true);
    expect(moved!.equals(new Vector(3, 4))).toBe(true);
  });

  it("tracks pointer buttons", () => {
    const input = new Input();
    input.feedPointerDown(0, new Vector(1, 1));
    expect(input.isButtonDown(0)).toBe(true);
    input.feedPointerUp(0);
    expect(input.isButtonDown(0)).toBe(false);
  });
});
