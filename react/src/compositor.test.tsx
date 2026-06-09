// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  Camera,
  Engine,
  ObservableValue,
  Unit,
  Unit2D,
  Vector,
  mes,
} from "@mise/core";
import { MiseProvider } from "./mise-provider.tsx";
import { Renderable } from "./renderable.ts";
import { useObservable } from "./use-observable.ts";

class Box extends Renderable {
  readonly component = (_props: { unit: Box }) => (
    <div data-testid="box">box</div>
  );
}

class Counter extends Renderable {
  readonly count = new ObservableValue(0);
  readonly component = ({ unit }: { unit: Counter }) => {
    const c = useObservable(unit.count);
    return <div data-testid="count">{c}</div>;
  };
}

function makeEngine(scene?: Unit): Engine {
  const engine = new Engine({ autoStart: false });
  const camera = new Camera({ width: 100, height: 100 });
  engine.root.addChild(camera);
  engine.activeCamera.set(camera);
  if (scene) engine.changeScene(scene);
  return engine;
}

afterEach(() => cleanup());

describe("compositor", () => {
  it("renders a renderable's component", () => {
    const engine = makeEngine(mes(Box, { position: new Vector(50, 50) }));
    render(<MiseProvider engine={engine} />);
    expect(screen.getByTestId("box").textContent).toBe("box");
  });

  it("wraps content in a positioned element carrying the unit id", () => {
    const box = mes(Box, { position: new Vector(50, 25) });
    render(<MiseProvider engine={makeEngine(box)} />);
    const wrapper = screen.getByTestId("box").parentElement;
    expect(wrapper?.getAttribute("data-unit-id")).toBe(box.id);
    expect(wrapper?.style.position).toBe("absolute");
  });

  it("re-renders a component when its observed value changes", () => {
    const counter = mes(Counter, {});
    render(<MiseProvider engine={makeEngine(counter)} />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    act(() => counter.count.set(5));
    expect(screen.getByTestId("count").textContent).toBe("5");
  });

  it("picks up renderables that enter the tree after mount", () => {
    const engine = makeEngine();
    render(<MiseProvider engine={engine} />);
    expect(screen.queryByTestId("box")).toBeNull();
    act(() => engine.root.addChild(mes(Box, {})));
    expect(screen.getByTestId("box")).toBeTruthy();
  });

  it("tracks the ancestor chain across reparenting", () => {
    const a = new Unit2D({ position: new Vector(10, 0) });
    const b = new Unit2D({ position: new Vector(20, 0) });
    const box = mes(Box, {});
    a.addChild(box);
    const scene = mes(Unit2D, {}, [a, b]);
    const engine = makeEngine(scene);
    render(<MiseProvider engine={engine} />);
    const wrapper = screen.getByTestId("box").parentElement;
    expect(wrapper?.style.transform).toContain("calc(10 * var(--u))");
    act(() => b.addChild(box)); // reparent a → b
    expect(wrapper?.style.transform).toContain("calc(20 * var(--u))");
    act(() => b.position.set(new Vector(30, 0))); // new chain stays subscribed
    expect(wrapper?.style.transform).toContain("calc(30 * var(--u))");
  });

  it("removes renderables that leave the tree", () => {
    const box = mes(Box, {});
    const engine = makeEngine(box);
    render(<MiseProvider engine={engine} />);
    expect(screen.getByTestId("box")).toBeTruthy();
    act(() => box.destroy());
    expect(screen.queryByTestId("box")).toBeNull();
  });
});

describe("input adapter", () => {
  it("feeds keyboard events to engine.input", () => {
    const engine = makeEngine(mes(Box, {}));
    render(<MiseProvider engine={engine} />);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })));
    expect(engine.input.isDown("a")).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" })));
    expect(engine.input.isDown("a")).toBe(false);
  });
});
