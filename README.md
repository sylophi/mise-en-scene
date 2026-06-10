# Mise en Scène

A TypeScript-native 2D game engine inspired by Godot Engine and React.

The core is a headless scene-tree engine (units, fixed and device loops,
input, reactive state) with no DOM and zero dependencies. Rendering is a
plugin that observes it, and the flagship renderer draws every entity as a
**pure React component**. No canvas: your sprites are HTML, styled like any
other component, positioned by the engine's transform math.

```tsx
class Player extends Renderable {
  readonly hp$ = new ObservableValue(100);
  get hp() { return this.hp$.get(); }
  set hp(v: number) { this.hp$.set(v); }

  override tick(dt: number) {
    if (this.engine.input.isDown("d")) {
      this.position = this.position.add(new Vector(40 * dt, 0));
    }
    if (this.hp <= 0) this.destroy();
  }

  readonly component = ({ unit }: { unit: Player }) => {
    const hp = useObservable(unit.hp$);
    return <div className="player">{hp} hp</div>;
  };
}

const engine = new Engine(); // runs on its own; React is just a viewer
engine.changeScene(
  mes(Player, { position: new Vector(80, 45) }, [
    mes(Sword, { damage: 5 }),
  ]),
);

createRoot(el).render(<MiseProvider engine={engine} />);
```

## Why

- **Godot's scene model.** Everything is a unit in a tree: visible sprites,
  invisible spawners, trigger zones, the camera. Parents carry children
  through space; lifecycle and ticking flow through the tree.
- **React's composition model.** Scenes are plain typed functions that build
  subtrees. `mes(Class, props, children)` is to units what JSX is to
  elements, and `mes` is short for the engine's name. Appearance is a real
  React component with hooks, CSS, and the whole ecosystem.
- **No canvas.** Retained DOM rendering means you debug your game in the
  element inspector, animate with CSS, and reuse every UI trick you know.
  Bring your own animation library, or build one: GSAP and anime.js tween
  unit fields directly through the accessor pairs, no adapter needed. The
  engine stays headless, so a canvas/WebGL renderer can exist alongside.

## Packages

| Package | What it is | Docs |
| --- | --- | --- |
| `@mise/core` | The headless engine. Pure TypeScript, zero dependencies. | [core/README.md](core/README.md) |
| `@mise/react` | The React DOM renderer: compositor, hooks, input adapter. | [react/README.md](react/README.md) |

`@mise/react` depends on `@mise/core`; `core` knows nothing about rendering.
