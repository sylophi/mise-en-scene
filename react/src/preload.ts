import { ObservableValue } from "@mise/core";

/** One url that failed to load, with the error it failed with. */
export interface PreloadError {
  url: string;
  error: unknown;
}

/** What `PreloadTask.promise` resolves with. Empty `errors` means all loaded. */
export interface PreloadResult {
  errors: readonly PreloadError[];
}

export interface PreloadOptions {
  /**
   * Per-url loader override. The default loads image urls via
   * `new Image()` + `decode()` (warm cache, decoded bitmap) and everything
   * else via `fetch()` with a full body read (warm HTTP cache). Inject a stub
   * here for tests, or a custom loader for exotic asset types.
   */
  load?: (url: string) => Promise<unknown>;
}

/**
 * A running (or finished) preload. Failures do not abort the batch: a failed
 * url is recorded in `errors$`, still counts toward `progress$` (which always
 * reaches 1), and `promise` *resolves* — never rejects — with the collected
 * errors. Callers that want fail-fast check `result.errors.length`.
 */
export interface PreloadTask {
  /** Fraction of urls settled (loaded or failed), 0..1. */
  readonly progress$: ObservableValue<number>;
  /** True once every url has settled. */
  readonly done$: ObservableValue<boolean>;
  /** The urls that failed so far, in settle order. */
  readonly errors$: ObservableValue<readonly PreloadError[]>;
  /** Resolves with `{ errors }` when every url has settled. Never rejects. */
  readonly promise: Promise<PreloadResult>;
  /** Number of urls in the batch. */
  readonly total: number;
  /** Number of urls settled so far. */
  readonly loaded: number;
}

const IMAGE_URL = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i;

function loadImage(url: string): Promise<unknown> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  // `decode()` waits for fetch + decode and rejects on failure; the fallback
  // covers environments without it.
  if (typeof img.decode === "function") {
    return img.decode().then(
      () => img,
      (error: unknown) =>
        Promise.reject(
          error instanceof Error ? error : new Error(`failed to decode ${url}`),
        ),
    );
  }
  return new Promise((resolve, reject) => {
    img.addEventListener("load", () => resolve(img), { once: true });
    img.addEventListener(
      "error",
      () => reject(new Error(`failed to load ${url}`)),
      { once: true },
    );
  });
}

async function loadViaFetch(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to fetch ${url}: ${res.status}`);
  await res.arrayBuffer(); // read fully so the HTTP cache is warm
  return url;
}

function defaultLoad(url: string): Promise<unknown> {
  if (IMAGE_URL.test(url) && typeof Image !== "undefined") {
    return loadImage(url);
  }
  return loadViaFetch(url);
}

/**
 * Load `urls` ahead of use so later `<img>`/`background-image`/`fetch` hits
 * are instant. Returns immediately with a {@link PreloadTask} whose channels
 * a loading screen can observe; `await task.promise` for the imperative path.
 *
 * v1 returns no parsed asset objects on purpose: the browser cache is the
 * asset store, and consumers simply use the same url again.
 */
export function preload(
  urls: readonly string[],
  options: PreloadOptions = {},
): PreloadTask {
  const load = options.load ?? defaultLoad;
  const total = urls.length;
  const progress$ = new ObservableValue(total === 0 ? 1 : 0);
  const done$ = new ObservableValue(total === 0);
  const errors$ = new ObservableValue<readonly PreloadError[]>([]);
  let settled = 0;

  const settle = (): void => {
    settled++;
    progress$.set(settled / total);
    if (settled === total) done$.set(true);
  };
  const promise = Promise.all(
    urls.map((url) =>
      load(url)
        .catch((error: unknown) => {
          errors$.set([...errors$.get(), { url, error }]);
        })
        .then(settle),
    ),
  ).then(() => ({ errors: errors$.get() }));

  return {
    progress$,
    done$,
    errors$,
    promise,
    total,
    get loaded() {
      return settled;
    },
  };
}
