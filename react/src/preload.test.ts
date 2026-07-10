import { describe, expect, it } from "vitest";
import { preload } from "./preload.ts";

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value?: unknown) => void;
  reject: (error: unknown) => void;
}

function deferred(): Deferred {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A loader whose per-url completion the test controls. */
function stubLoader(urls: readonly string[]) {
  const gates = new Map<string, Deferred>(urls.map((u) => [u, deferred()]));
  const load = (url: string): Promise<unknown> => {
    const gate = gates.get(url);
    if (!gate) throw new Error(`unexpected url: ${url}`);
    return gate.promise;
  };
  return { gates, load };
}

/** Let queued promise reactions run. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("preload", () => {
  it("counts settled urls into progress$ and finishes at 1", async () => {
    const urls = ["a.png", "b.png", "c.json"];
    const { gates, load } = stubLoader(urls);
    const task = preload(urls, { load });

    expect(task.total).toBe(3);
    expect(task.progress$.get()).toBe(0);
    expect(task.done$.get()).toBe(false);

    gates.get("a.png")!.resolve();
    await flush();
    expect(task.progress$.get()).toBeCloseTo(1 / 3);
    expect(task.loaded).toBe(1);

    gates.get("b.png")!.resolve();
    gates.get("c.json")!.resolve();
    await flush();
    expect(task.progress$.get()).toBe(1);
    expect(task.done$.get()).toBe(true);
    expect((await task.promise).errors).toEqual([]);
  });

  it("records failures per url and keeps loading (promise resolves)", async () => {
    const urls = ["ok.png", "missing.png", "also-ok.png"];
    const { gates, load } = stubLoader(urls);
    const task = preload(urls, { load });

    const boom = new Error("404");
    gates.get("missing.png")!.reject(boom);
    await flush();
    // A failed url still counts toward progress.
    expect(task.progress$.get()).toBeCloseTo(1 / 3);
    expect(task.errors$.get()).toEqual([{ url: "missing.png", error: boom }]);
    expect(task.done$.get()).toBe(false);

    gates.get("ok.png")!.resolve();
    gates.get("also-ok.png")!.resolve();
    const result = await task.promise;
    expect(task.progress$.get()).toBe(1);
    expect(task.done$.get()).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.url).toBe("missing.png");
  });

  it("fires progress listeners as urls settle", async () => {
    const urls = ["a", "b"];
    const { gates, load } = stubLoader(urls);
    const task = preload(urls, { load });
    const seen: number[] = [];
    task.progress$.addListener((p) => seen.push(p));

    gates.get("a")!.resolve();
    await flush();
    gates.get("b")!.resolve();
    await flush();
    expect(seen).toEqual([0.5, 1]);
  });

  it("is immediately done for an empty url list", async () => {
    const task = preload([], { load: () => Promise.resolve() });
    expect(task.progress$.get()).toBe(1);
    expect(task.done$.get()).toBe(true);
    expect((await task.promise).errors).toEqual([]);
  });
});
