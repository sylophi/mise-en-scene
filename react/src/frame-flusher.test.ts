import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine } from "@mise/core";
import { FrameFlusher, flusherFor } from "./frame-flusher.ts";

const microtasks = (): Promise<void> => Promise.resolve();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FrameFlusher", () => {
  it("dedupes a callback enqueued many times into one call per flush", () => {
    const engine = new Engine({ autoStart: false });
    const flusher = new FrameFlusher(engine);
    let calls = 0;
    const notify = (): void => {
      calls++;
    };
    for (let i = 0; i < 50; i++) flusher.enqueue(notify);
    flusher.flush();
    expect(calls).toBe(1);
    flusher.flush(); // drained: nothing left
    expect(calls).toBe(1);
  });

  it("flushes on the engine's device tick", () => {
    const engine = new Engine({ autoStart: false });
    const flusher = flusherFor(engine);
    let calls = 0;
    flusher.enqueue(() => calls++);
    engine.advanceDevice(1 / 60);
    expect(calls).toBe(1);
  });

  it("cancel drops a pending notification", () => {
    const engine = new Engine({ autoStart: false });
    const flusher = new FrameFlusher(engine);
    let calls = 0;
    const notify = (): void => {
      calls++;
    };
    flusher.enqueue(notify);
    flusher.cancel(notify); // e.g. the subscriber unmounted
    flusher.flush();
    expect(calls).toBe(0);
  });

  it("falls back to a microtask when no device loop is driving", async () => {
    const engine = new Engine({ autoStart: false });
    const flusher = new FrameFlusher(engine);
    let calls = 0;
    const notify = (): void => {
      calls++;
    };
    flusher.enqueue(notify);
    flusher.enqueue(notify); // second arm is a no-op
    expect(calls).toBe(0); // still deferred within the task
    await microtasks();
    expect(calls).toBe(1);
  });

  it("waits for the device tick while the device loop runs", async () => {
    // Simulate a driving device loop: rAF exists and the engine is running.
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const engine = new Engine({ autoStart: false });
    engine.start();
    try {
      const flusher = new FrameFlusher(engine);
      let calls = 0;
      flusher.enqueue(() => calls++);
      await microtasks();
      expect(calls).toBe(0); // no microtask fallback: the frame owns the flush
      engine.advanceDevice(1 / 60);
      expect(calls).toBe(1);
    } finally {
      engine.stop();
    }
  });

  it("hands an armed microtask over to a loop that started meanwhile", async () => {
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const engine = new Engine({ autoStart: false });
    const flusher = new FrameFlusher(engine);
    let calls = 0;
    flusher.enqueue(() => calls++); // arms the microtask (engine stopped)
    engine.start();
    try {
      await microtasks();
      expect(calls).toBe(0); // fallback stood down; the device tick flushes
      engine.advanceDevice(1 / 60);
      expect(calls).toBe(1);
    } finally {
      engine.stop();
    }
  });

  it("flusherFor returns one flusher per engine", () => {
    const a = new Engine({ autoStart: false });
    const b = new Engine({ autoStart: false });
    expect(flusherFor(a)).toBe(flusherFor(a));
    expect(flusherFor(a)).not.toBe(flusherFor(b));
  });
});
