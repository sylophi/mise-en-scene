import {
  ObservableValue,
  type ObservableValueOptions,
} from "./observable-value.ts";

/**
 * Decorator sugar for the `x`/`x$` trio. On an `accessor` field it routes the
 * accessor through an `ObservableValue` defined on the instance at `name$`:
 *
 * ```ts
 * class Player extends Unit {
 *   @observable accessor hp = 100;
 *   // ≡ readonly hp$ = new ObservableValue(100);
 *   //   get hp() { return this.hp$.get(); }
 *   //   set hp(v: number) { this.hp$.set(v); }
 * }
 * ```
 *
 * Works bare or called with `ObservableValue` options:
 *
 * ```ts
 * @observable({ equals: structuralEquals }) accessor pos = Vector.zero;
 * ```
 *
 * The channel is real at runtime but invisible to the type system (a decorator
 * cannot add declared members). For typed access either declare it —
 * `declare readonly hp$: ObservableValue<number>;` — or use
 * `channel(unit, "hp")`.
 *
 * Only public, string-named instance accessors are supported: the channel
 * name is derived by appending `$`, and it must be reachable from outside.
 */
export function observable<This, T>(
  target: ClassAccessorDecoratorTarget<This, T>,
  context: ClassAccessorDecoratorContext<This, T>,
): ClassAccessorDecoratorResult<This, T>;
export function observable<T>(
  options: ObservableValueOptions<T>,
): <This, V extends T>(
  target: ClassAccessorDecoratorTarget<This, V>,
  context: ClassAccessorDecoratorContext<This, V>,
) => ClassAccessorDecoratorResult<This, V>;
export function observable(
  targetOrOptions:
    | ClassAccessorDecoratorTarget<unknown, unknown>
    | ObservableValueOptions<unknown>,
  maybeContext?: ClassAccessorDecoratorContext<unknown, unknown>,
):
  | ClassAccessorDecoratorResult<unknown, unknown>
  | ((
      target: ClassAccessorDecoratorTarget<unknown, unknown>,
      context: ClassAccessorDecoratorContext<unknown, unknown>,
    ) => ClassAccessorDecoratorResult<unknown, unknown>) {
  if (maybeContext !== undefined) {
    // Bare form: @observable accessor hp = 100
    return decorate(maybeContext, undefined);
  }
  // Factory form: @observable({ equals }) accessor pos = Vector.zero
  const options = targetOrOptions as ObservableValueOptions<unknown>;
  return (_target, context) => decorate(context, options);
}

function decorate<This, T>(
  context: ClassAccessorDecoratorContext<This, T>,
  options: ObservableValueOptions<T> | undefined,
): ClassAccessorDecoratorResult<This, T> {
  if ((context.kind as string) !== "accessor") {
    throw new Error("@observable only decorates `accessor` fields");
  }
  if (context.static || context.private || typeof context.name !== "string") {
    throw new Error(
      "@observable requires a public, string-named instance accessor " +
        `(got ${String(context.name)})`,
    );
  }
  const channelKey = `${context.name}$`;
  const channelOf = (self: This): ObservableValue<T> =>
    (self as Record<string, ObservableValue<T>>)[channelKey]!;
  return {
    // Runs where the field initializer sits in the class body, per instance,
    // so channel creation order matches the manual trio's.
    init(value: T): T {
      Object.defineProperty(this, channelKey, {
        value: new ObservableValue(value, options),
        enumerable: true,
        writable: false,
        configurable: false,
      });
      return value; // the auto-backing slot is unused after this
    },
    get(): T {
      return channelOf(this).get();
    },
    set(value: T): void {
      channelOf(this).set(value);
    },
  };
}

/**
 * Typed access to the channel behind an `@observable` accessor without a
 * `declare` line: `channel(player, "hp")` returns the `hp$`
 * `ObservableValue`, typed from the accessor. Throws if `name$` is not an
 * `ObservableValue` (the field was never decorated).
 */
export function channel<O extends object, K extends string & keyof O>(
  obj: O,
  name: K,
): ObservableValue<O[K]> {
  const ov = (obj as Record<string, unknown>)[`${name}$`];
  if (!(ov instanceof ObservableValue)) {
    throw new Error(
      `channel(): no ObservableValue at "${name}$"; ` +
        `is "${name}" declared as \`@observable accessor\`?`,
    );
  }
  return ov as ObservableValue<O[K]>;
}
