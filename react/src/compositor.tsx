import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Unit,
  Unit2D,
  type Camera,
  type Engine,
  type Matrix2D,
} from "@mise/core";
import { Renderable } from "./renderable.ts";
import { useEngine } from "./context.ts";
import { useObservable } from "./use-observable.ts";
import {
  entityTransformCss,
  screenToWorld,
  viewportTransformCss,
} from "./coords.ts";

// ── Tree → renderable list ───────────────────────────────────────────────────

function collectRenderables(root: Unit): Renderable[] {
  const out: Renderable[] = [];
  const visit = (u: Unit): void => {
    if (u instanceof Renderable) out.push(u);
    for (const c of u.children) visit(c);
  };
  visit(root);
  return out;
}

/**
 * The live list of renderables in tree (draw) order. Crawls once, then stays in
 * sync via the engine's unit enter/exit events; never re-crawls per frame.
 */
function useRenderables(engine: Engine): Renderable[] {
  const [list, setList] = useState<Renderable[]>(() =>
    collectRenderables(engine.root),
  );
  useEffect(() => {
    setList(collectRenderables(engine.root)); // re-sync: tree may have changed before this effect
    // Coalesce event bursts (N spawns in one tick) into a single re-collect.
    let scheduled = false;
    let active = true;
    const update = (): void => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (active) setList(collectRenderables(engine.root));
      });
    };
    const onEnter = engine.onUnitEnter.addListener((u) => {
      if (u instanceof Renderable) update();
    });
    const onExit = engine.onUnitExit.addListener((u) => {
      if (u instanceof Renderable) update();
    });
    // No Renderable filter: a moved unit may be an invisible ancestor whose
    // renderable subtree shifted in draw order with it.
    const onMoved = engine.onUnitMoved.addListener(() => update());
    return () => {
      active = false;
      onEnter();
      onExit();
      onMoved();
    };
  }, [engine]);
  return list;
}

// ── World transform subscription ─────────────────────────────────────────────

/**
 * Recompute on read, re-rendering whenever this unit or any contiguous `Unit2D`
 * ancestor changes its transform (a parent move shifts the child's world pose).
 * Reparenting anywhere in the chain rebuilds the subscriptions, so the hook
 * tracks the unit's *current* ancestors, not the chain at mount time.
 */
function useWorldTransform(unit: Unit2D): Matrix2D {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const unsubscribeAll = (): void => {
      for (const f of unsubs) f();
      unsubs.length = 0;
    };
    const onChainChanged = (): void => {
      unsubscribeAll();
      subscribe();
      bump();
    };
    const subscribe = (): void => {
      for (let u: Unit | null = unit; u instanceof Unit2D; u = u.parent) {
        unsubs.push(u.position$.addListener(bump));
        unsubs.push(u.rotation$.addListener(bump));
        unsubs.push(u.scale$.addListener(bump));
        unsubs.push(u.onParentChanged.addListener(onChainChanged));
      }
    };
    subscribe();
    return unsubscribeAll;
  }, [unit]);
  return unit.worldTransform;
}

// ── Entity wrapper (positioning) + content (appearance) ──────────────────────

// Z layers stack first; tree order only breaks ties within a layer.
const Z_BAND = 100_000;

// Memoized so a Stage re-render (resize, list change) only re-renders the
// wrappers whose `order` actually changed.
const EntityView = memo(function EntityView({
  unit,
  order,
}: {
  unit: Renderable;
  order: number;
}): ReactNode {
  const transform = useWorldTransform(unit);
  const z = useObservable(unit.z$);
  // Memoize the view so transform-only re-renders of the wrapper don't re-run it.
  const View = useMemo(() => memo(unit.component), [unit.component]);

  const style: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    transformOrigin: "top left",
    transform: entityTransformCss(transform),
    zIndex: z * Z_BAND + order,
  };
  return (
    <div style={style} data-unit-id={unit.id}>
      <View unit={unit} />
    </div>
  );
});

// ── Camera viewport (applies the inverse camera transform once) ──────────────

function Viewport({
  camera,
  children,
}: {
  camera: Camera;
  children: ReactNode;
}): ReactNode {
  const transform = useWorldTransform(camera);
  const style: CSSProperties = {
    position: "absolute",
    // The camera's position is the center of the view, so the viewport origin
    // sits at the stage center and the inverse camera transform acts there.
    left: "50%",
    top: "50%",
    width: 0,
    height: 0,
    transformOrigin: "top left",
    transform: viewportTransformCss(transform),
  };
  return <div style={style}>{children}</div>;
}

// ── Stage (sizing, --u, input) ───────────────────────────────────────────────

const containerStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
};

function Stage({
  engine,
  camera,
}: {
  engine: Engine;
  camera: Camera;
}): ReactNode {
  const camW = useObservable(camera.width$);
  const camH = useObservable(camera.height$);
  const renderables = useRenderables(engine);
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const uRef = useRef(0);
  const [box, setBox] = useState({ w: 0, h: 0, u: 0 });

  // Fit the largest camera-aspect rectangle into the container; derive --u.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const fit = (): void => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      let w = cw;
      let h = cw / camera.aspect;
      if (h > ch) {
        h = ch;
        w = ch * camera.aspect;
      }
      uRef.current = w / camera.width;
      setBox({ w, h, u: uRef.current });
    };
    fit();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(fit);
      ro.observe(container);
      return () => ro.disconnect();
    }
    return undefined;
  }, [camera, camW, camH]);

  // Capture DOM input and feed the engine (pointer mapped to world coords).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const toWorld = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      return screenToWorld(
        e.clientX,
        e.clientY,
        rect.left,
        rect.top,
        uRef.current,
        camera,
      );
    };
    const onMove = (e: PointerEvent): void =>
      engine.input.feedPointerMove(toWorld(e));
    const onDown = (e: PointerEvent): void =>
      engine.input.feedPointerDown(e.button, toWorld(e));
    const onUp = (e: PointerEvent): void =>
      engine.input.feedPointerUp(e.button, toWorld(e));
    const onKeyDown = (e: KeyboardEvent): void =>
      engine.input.feedKeyDown(e.key);
    const onKeyUp = (e: KeyboardEvent): void => engine.input.feedKeyUp(e.key);

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [engine, camera]);

  const stageStyle: CSSProperties = {
    position: "relative",
    overflow: "hidden",
    width: box.w || "100%",
    height: box.h || "100%",
    ["--u" as string]: `${box.u}px`,
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      <div ref={stageRef} style={stageStyle} data-mise-stage="">
        <Viewport camera={camera}>
          {renderables.map((unit, i) => (
            <EntityView key={unit.id} unit={unit} order={i} />
          ))}
        </Viewport>
      </div>
    </div>
  );
}

/** The compositor: renders the engine's renderables through the active camera. */
export function Compositor(): ReactNode {
  const engine = useEngine();
  const camera = useObservable(engine.activeCamera$);
  if (!camera) {
    return <div style={containerStyle} data-mise-stage="" />;
  }
  // Keyed on the camera so all camera-dependent hooks reset cleanly on a swap.
  return <Stage key={camera.id} engine={engine} camera={camera} />;
}
