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
import { entityTransformCss } from "./coords.ts";

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

const wrapperOf = (u: Unit): HTMLElement | null =>
  document.querySelector(`[data-unit-id="${u.id}"]`);

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

  it("picks up renderables that enter the tree after mount", async () => {
    const engine = makeEngine();
    render(<MiseProvider engine={engine} />);
    expect(screen.queryByTestId("box")).toBeNull();
    // async: re-collects coalesce into a microtask
    await act(async () => engine.root.addChild(mes(Box, {})));
    expect(screen.getByTestId("box")).toBeTruthy();
  });

  it("tracks the ancestor chain across reparenting", async () => {
    const a = new Unit2D({ position: new Vector(10, 0) });
    const b = new Unit2D({ position: new Vector(20, 0) });
    const box = mes(Box, {});
    a.addChild(box);
    const scene = mes(Unit2D, {}, [a, b]);
    const engine = makeEngine(scene);
    render(<MiseProvider engine={engine} />);
    const wrapper = screen.getByTestId("box").parentElement;
    expect(wrapper?.style.transform).toContain("calc(10 * var(--u))");
    await act(async () => b.addChild(box)); // reparent a → b
    expect(wrapper?.style.transform).toContain("calc(20 * var(--u))");
    act(() => b.position.set(new Vector(30, 0))); // new chain stays subscribed
    expect(wrapper?.style.transform).toContain("calc(30 * var(--u))");
  });

  it("stacks z layers above tree order", () => {
    const a = mes(Box, {});
    const b = mes(Box, { z: 1 });
    const c = mes(Box, {}); // later in tree order than b, but in layer 0
    const scene = mes(Unit2D, {}, [a, b, c]);
    render(<MiseProvider engine={makeEngine(scene)} />);
    const zOf = (u: Unit): number => Number(wrapperOf(u)?.style.zIndex);
    expect(zOf(b)).toBeGreaterThan(zOf(c)); // z=1 beats every layer-0 unit
    expect(zOf(c)).toBeGreaterThan(zOf(a)); // tree order breaks ties in a layer
  });

  it("renders shear: non-uniform ancestor scale over a rotated unit", () => {
    const frame = new Unit2D({ scale: new Vector(2, 1) });
    const box = mes(Box, { rotation: Math.PI / 2 });
    frame.addChild(box);
    render(<MiseProvider engine={makeEngine(frame)} />);
    const wrapper = screen.getByTestId("box").parentElement;
    // S·R maps the x-basis to (0,1) and the y-basis to (-2,0) — a sheared
    // frame no translate/rotate/scale string can express.
    expect(wrapper?.style.transform).toBe(
      entityTransformCss(box.worldTransform),
    );
    expect(wrapper?.style.transform).toContain(", -2,");
  });

  it("updates draw order when a renderable is reparented", async () => {
    const boxA = mes(Box, {});
    const boxB = mes(Box, {});
    const scene = mes(Unit2D, {}, [boxA, boxB]);
    render(<MiseProvider engine={makeEngine(scene)} />);
    expect(wrapperOf(boxA)?.style.zIndex).toBe("0");
    expect(wrapperOf(boxB)?.style.zIndex).toBe("1");
    await act(async () => boxB.addChild(boxA)); // children draw above parents
    expect(wrapperOf(boxB)?.style.zIndex).toBe("0");
    expect(wrapperOf(boxA)?.style.zIndex).toBe("1");
  });

  it("removes renderables that leave the tree", async () => {
    const box = mes(Box, {});
    const engine = makeEngine(box);
    render(<MiseProvider engine={engine} />);
    expect(screen.getByTestId("box")).toBeTruthy();
    await act(async () => box.destroy());
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
