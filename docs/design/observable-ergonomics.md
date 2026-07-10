# Observable ergonomics: `@observable` sugar and equality for `ObservableValue`

Design notes for two roadmap items in `@mise/core`:

1. **Decorator sugar** — `@observable accessor hp = 100` collapsing the
   channel/getter/setter trio to one line.
2. **Structural equality option for `ObservableValue`** — a comparator
   deciding whether `set` is a no-op (v1 compares only by `===`).

Both ship in `core/src/primitives` (`observable.ts`, `observable-value.ts`)
and are demonstrated end to end in `examples/ergonomics-demo`.

## Goals

The house convention is the trio:

```ts
readonly hp$ = new ObservableValue(100);
get hp() { return this.hp$.get(); }
set hp(v: number) { this.hp$.set(v); }
```

The sugar must produce **exactly that public shape** — nothing weaker:

- `hp` is a real getter/setter pair on the prototype, so simulation code
  keeps `this.hp -= 5 * dt` and tween libraries keep the plain-property
  protocol (`gsap.to(unit, { hp: 0 })` walks the prototype for a setter).
- `hp$` is a real per-instance, read-only `ObservableValue`, so
  `useObservable(unit.hp$)` and every other channel consumer keep working.
- Zero dependencies, no metadata reflection, no class decorator, no base
  class requirement — it works on any class, not just `Unit`s.

## Decorator mechanics

`observable` is a standard **TC39 class accessor decorator** (TypeScript 5+
native semantics — *not* `experimentalDecorators`, which this repo has never
enabled). It only accepts the `accessor` keyword form, because that is the
only standard form that gives the decorator both an initializer hook and
replaceable get/set in one place:

```ts
@observable accessor hp = 100;
```

The decorator returns a `ClassAccessorDecoratorResult`:

- **`init(value)`** runs per instance, at the exact point in construction
  where the field initializer sits (same ordering as the manual trio's field).
  It defines the channel on the instance via `Object.defineProperty(this,
  "hp$", { value: new ObservableValue(value, options), enumerable: true,
  writable: false, configurable: false })` — matching the manual `readonly
  hp$` (own, enumerable, unwritable). The decorator reads the channel name
  from `context.name` and appends `$`.
- **`get`/`set`** route through that instance channel. The auto-generated
  private backing slot still exists but is never read after `init`.

`addInitializer` was considered for channel creation but rejected: accessor
extra-initializers run *before* field initializers at construction time, so
the channel would exist before its seed value and ordering would diverge
from the manual trio. `init` is the faithful hook.

Bare and factory forms are both supported through an overloaded function:

```ts
@observable accessor hp = 100;
@observable({ equals: structuralEquals }) accessor pos = Vector.zero;
```

The implementation distinguishes them by arity (a decorator call passes the
context as the second argument; a factory call passes one options object).

**Restrictions** (enforced with thrown errors at class-definition time):
public, string-named, non-static instance accessors only. A symbol name has
no `$` form; a `#private` or static channel would not be reachable the way
the convention promises. Static state has no house convention yet; when it
does, the restriction can be lifted deliberately.

**Constructor seeding** stays ordinary assignment (`if (props?.hp !==
undefined) this.hp = props.hp;`) — it fires the channel, but no listener can
exist during construction, so it is indistinguishable from seeding the
initializer.

## The typing story (and its limits)

A decorator cannot add declared members to the class type — TypeScript
deliberately keeps decorators non-mutating at the type level, and TS 7
(7.0.2, the toolchain here) behaves the same. So `hp$` is real at runtime
but invisible to the compiler. Rather than pretend otherwise, we offer two
honest routes and document the gap:

1. **Declare the channel** when it is part of the class's public API:

   ```ts
   @observable accessor hp = 100;
   declare readonly hp$: ObservableValue<number>;
   ```

   One extra line, zero runtime emit, full autocomplete. The `declare` is
   trusted, not checked — if the field above it is renamed and the declare
   is not, the type lies. The name adjacency keeps that risk visible.

2. **`channel(obj, "hp")`** — a typed lookup helper:

   ```ts
   const hp$ = channel(player, "hp"); // ObservableValue<number>
   ```

   Typed as `<O, K extends string & keyof O>(obj: O, name: K) =>
   ObservableValue<O[K]>`, so the key is checked against the class and the
   value type flows from the accessor. It throws if `name$` is not an
   `ObservableValue`. It also works against manual trios, since both follow
   the same `name$` convention.

Limits accepted: the two routes can drift from each other only in the
`declare` case; `channel` is always sound at the key level but cannot prove
the field was decorated (that is a runtime check). A subclass overriding a
decorated accessor with a fresh `accessor` of the same name would try to
redefine the non-configurable channel and throw — considered acceptable
(overriding reactive state wholesale is not a supported pattern).

### Alternatives considered

- **`experimentalDecorators` (legacy)** — rejected: legacy decorators cannot
  intercept field initialization sanely, the repo would take on a
  deprecated compiler mode, and oxc/esbuild treat the two modes differently.
- **A base-class helper (`this.defineObservable("hp", 100)`)** — rejected:
  loses the declaration-site readability, still has the same typing gap for
  `hp$`, and couples the sugar to `Unit`.
- **Class-type mutation via a class decorator + declaration merging**
  (`@observables class Player ...`) — rejected: standard class decorators
  cannot change the instance type either, and the merging tricks that fake
  it break subclassing and IDE navigation.
- **Making `hp$` the only API (no accessor)** — rejected: the engine's whole
  ergonomic bet is natural assignment in simulation code plus the tween
  plain-property protocol.
- **A `channel` *property* on the function (`observable.channel`)** — folded
  into a standalone `channel` export instead; simpler typing, same grep-able
  name.

### Toolchain reality

Standard decorators are a *syntax-level* feature no JS engine ships yet, so
every consumer's transpiler must lower them:

- `tsc` 7.0.2 type-checks them natively with no flags (this repo is
  `noEmit`; nothing else needed).
- **esbuild ≥ 0.21** lowers them when the target does not claim support —
  which means `target: "es2022"`, **not** `esnext` (esbuild treats `esnext`
  as "supports everything" and passes decorators through to a parser that
  will choke). The example app sets `esbuild: { target: "es2022" }` in its
  Vite config for exactly this reason.
- **oxc (Vite 8 / rolldown)** only lowers *legacy* decorators as of
  rolldown 1.0.3; TC39 decorators throw a SyntaxError at runtime. The root
  `package.json` therefore pins `vite: ^7` so Vitest (which supports Vite
  6/7/8) transforms through esbuild. When oxc gains proposal-decorator
  lowering, the pin can be dropped.
- oxlint/oxfmt parse the syntax fine.

### Internal migration: deliberately not done

`Unit2D`/`Camera`/`Renderable` trios were left manual. The decorator is not
a strict drop-in there: those channels are seeded from constructor props
(`new ObservableValue(props?.position ?? Vector.zero)`), so migrating means
an initializer *plus* a constructor override-assignment *plus* a `declare`
line per field — a wash or worse in line count, with churn in files that
parallel work touches. The sugar is user-facing; internals keep the explicit
trio, which also serves as living documentation of what the decorator
expands to.

## Equality option for `ObservableValue`

```ts
new ObservableValue(initial, { equals?: (a, b) => boolean })
```

- `set` short-circuits on `===` first (unchanged v1 behavior, and the
  comparator is never consulted for it), then on `equals(next, current)`.
- A suppressed set **keeps the old reference**. This is load-bearing for
  React: `useSyncExternalStore` snapshots stay stable, so no re-render.
- The comparator lives on the instance, not the class: different fields of
  the same type can have different equality.

`structuralEquals` ships as the sensible built-in for the common case
(immutable value objects like `Vector`): `a === b`, or `a` and `b` are
same-prototype objects and `a.equals(b)` returns `true`. The same-prototype
guard keeps a foreign object with a lying `equals` from matching a `Vector`.
It is `equals()`-method-aware rather than `Vector`-aware, keeping the
primitive generic and core zero-dep.

The decorator threads options straight through:
`@observable({ equals: structuralEquals }) accessor pos = Vector.zero`. The
factory overload types the comparator against the accessor's value type
(`V extends T`), so `@observable({ equals: (a: Vector, b: Vector) =>
a.equals(b) })` on a `number` accessor is a compile error. Note that an
inline comparator's parameters are not inferred *backwards* from the field —
annotate them or use `structuralEquals`.

Alternatives considered: a static `ObservableValue.withEquals(v, eq)`
(rejected: options object composes better if more options arrive); deep
structural comparison by default (rejected: silent O(n) cost and semantics
changes for v1 users); special-casing `Vector` in core (rejected: the
`equals()` protocol covers it without coupling).

## Built-in fields

Built-in channels (`position$`, `rotation$`, …) stay `===`-compared for now.
Simulation code that rewrites a Vector field every tick can either skip the
write (`if (!next.equals(this.position)) this.position = next`, as the demo
does) or subscribe through its own structurally-compared derived field.
Flipping built-ins to `structuralEquals` is a one-line-per-field follow-up
once the option has soaked.
