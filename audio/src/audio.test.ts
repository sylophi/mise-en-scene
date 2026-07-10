import { describe, expect, it } from "vitest";
import { Camera, Engine, Unit2D, Vector, mes, type Unit } from "@mise/core";
import {
  AudioListener2D,
  AudioMixer,
  AudioPlayer,
  AudioPlayer2D,
  type AudioBufferLike,
  type AudioBufferSourceNodeLike,
  type AudioNodeLike,
  type GainNodeLike,
  type MiseAudioContext,
  type StereoPannerNodeLike,
} from "./index.ts";

// ── Stub Web Audio (no jsdom, no real audio) ────────────────────────────────

class StubParam {
  value = 1;
}

class StubNode implements AudioNodeLike {
  readonly connected: AudioNodeLike[] = [];
  connect(destination: AudioNodeLike): AudioNodeLike {
    this.connected.push(destination);
    return destination;
  }
  disconnect(): void {
    this.connected.length = 0;
  }
}

class StubGain extends StubNode implements GainNodeLike {
  readonly gain = new StubParam();
}

class StubPanner extends StubNode implements StereoPannerNodeLike {
  readonly pan = new StubParam();
}

class StubSource extends StubNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  readonly playbackRate = new StubParam();
  onended: ((ev: Event) => unknown) | null = null;
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  /** Simulate the natural end of a non-looping source. */
  end(): void {
    this.onended?.(new Event("ended"));
  }
}

class StubContext implements MiseAudioContext {
  state = "running";
  readonly destination = new StubNode();
  readonly gains: StubGain[] = [];
  readonly panners: StubPanner[] = [];
  readonly sources: StubSource[] = [];
  resumeCalls = 0;
  resume(): Promise<void> {
    this.resumeCalls++;
    this.state = "running";
    return Promise.resolve();
  }
  createGain(): StubGain {
    const node = new StubGain();
    this.gains.push(node);
    return node;
  }
  createStereoPanner(): StubPanner {
    const node = new StubPanner();
    this.panners.push(node);
    return node;
  }
  createBufferSource(): StubSource {
    const node = new StubSource();
    this.sources.push(node);
    return node;
  }
  decodeAudioData(_data: ArrayBuffer): Promise<AudioBufferLike> {
    return Promise.resolve({ duration: 1 });
  }
  get lastSource(): StubSource | undefined {
    return this.sources[this.sources.length - 1];
  }
}

const buffer: AudioBufferLike = { duration: 1 };

const engineWith = (scene: Unit): Engine => {
  const e = new Engine({ autoStart: false });
  e.changeScene(scene);
  return e;
};

const step = (e: Engine, n = 1): void => {
  for (let i = 0; i < n; i++) e.advanceFixed(e.fixedStep);
};

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// A real AudioContext must satisfy the structural context type, so games can
// pass one without casts. Compile-time only; never executed.
const acceptsRealContext = (ctx: AudioContext): MiseAudioContext => ctx;

it("accepts a real AudioContext structurally", () => {
  expect(acceptsRealContext).toBeTypeOf("function");
});

describe("AudioPlayer lifecycle", () => {
  it("plays on tree enter and stops on tree exit", () => {
    const ctx = new StubContext();
    const player = mes(AudioPlayer, { src: buffer, loop: true });
    const scene = mes(AudioMixer, { context: ctx }, [player]);
    engineWith(scene);

    expect(player.playing).toBe(true);
    const source = ctx.lastSource!;
    expect(source.started).toBe(true);
    expect(source.buffer).toBe(buffer);
    expect(source.loop).toBe(true);

    scene.removeChild(player);
    expect(player.playing).toBe(false);
    expect(source.stopped).toBe(true);
  });

  it("replays on re-enter with autoplay", () => {
    const ctx = new StubContext();
    const player = mes(AudioPlayer, { src: buffer });
    const scene = mes(AudioMixer, { context: ctx }, [player]);
    engineWith(scene);
    scene.removeChild(player);
    scene.addChild(player);
    expect(player.playing).toBe(true);
    expect(ctx.sources.length).toBe(2);
    expect(ctx.lastSource!.started).toBe(true);
  });

  it("waits for play() when autoplay is false, and honors pre-mount intent", () => {
    const ctx = new StubContext();
    const player = mes(AudioPlayer, { src: buffer, autoplay: false });
    const scene = mes(AudioMixer, { context: ctx }, [player]);
    engineWith(scene);
    expect(player.playing).toBe(false);
    expect(ctx.sources.length).toBe(0);

    player.play();
    expect(player.playing).toBe(true);
    expect(ctx.lastSource!.started).toBe(true);

    // Intent recorded off-tree starts the source on enter.
    const eager = mes(AudioPlayer, { src: buffer, autoplay: false });
    eager.play();
    expect(eager.playing).toBe(true);
    scene.addChild(eager);
    expect(ctx.lastSource!.started).toBe(true);
  });

  it("flips playing$ off and fires onFinished at natural end", () => {
    const ctx = new StubContext();
    const player = mes(AudioPlayer, { src: buffer });
    engineWith(mes(AudioMixer, { context: ctx }, [player]));
    let finished = 0;
    player.onFinished.addListener(() => finished++);

    ctx.lastSource!.end();
    expect(player.playing).toBe(false);
    expect(finished).toBe(1);

    // A commanded stop is not a "finish".
    player.play();
    player.stop();
    expect(finished).toBe(1);
  });

  it("writes volume and playbackRate through to the nodes", () => {
    const ctx = new StubContext();
    const player = mes(AudioPlayer, { src: buffer, volume: 0.5 });
    engineWith(mes(AudioMixer, { context: ctx }, [player]));
    const gain = ctx.gains[1]!; // gains[0] is the mixer's master
    expect(gain.gain.value).toBe(0.5);
    player.volume = 0.25;
    expect(gain.gain.value).toBe(0.25);
    player.playbackRate = 2;
    expect(ctx.lastSource!.playbackRate.value).toBe(2);
  });

  it("decodes a URL src once per context and starts when it lands", async () => {
    const ctx = new StubContext();
    let fetches = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      fetches++;
      return Promise.resolve(new Response(new ArrayBuffer(4)));
    }) as typeof fetch;
    try {
      const a = mes(AudioPlayer, { src: "sfx/chirp.wav" });
      const b = mes(AudioPlayer, { src: "sfx/chirp.wav" });
      engineWith(mes(AudioMixer, { context: ctx }, [a, b]));
      expect(ctx.sources.length).toBe(0); // still decoding
      expect(a.playing).toBe(true); // intent already recorded
      await flush();
      expect(fetches).toBe(1); // shared cache: one fetch for two players
      expect(ctx.sources.length).toBe(2);
      expect(ctx.sources.every((s) => s.started)).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("throws on tree enter without an AudioMixer ancestor", () => {
    const e = new Engine({ autoStart: false });
    expect(() => e.changeScene(mes(AudioPlayer, { src: buffer }))).toThrow(
      /AudioMixer/,
    );
  });
});

describe("spatialization", () => {
  it("pans and attenuates against an explicit listener", () => {
    const ctx = new StubContext();
    const player = mes(AudioPlayer2D, {
      src: buffer,
      loop: true,
      position: new Vector(25, 0),
      maxDistance: 100, // panRange defaults to 50
    });
    const listener = mes(AudioListener2D, { position: Vector.zero });
    const world = mes(Unit2D, {}, [listener, player]);
    const e = engineWith(mes(AudioMixer, { context: ctx }, [world]));
    step(e);

    expect(player.pan).toBeCloseTo(0.5);
    expect(player.attenuation).toBeCloseTo(0.75);
    const gain = ctx.gains[1]!;
    const panner = ctx.panners[0]!;
    expect(gain.gain.value).toBeCloseTo(0.75); // volume 1 × attenuation
    expect(panner.pan.value).toBeCloseTo(0.5);

    // Far left of the listener: pan clamps, attenuation floors at 0.
    player.position = new Vector(-150, 0);
    step(e);
    expect(player.pan).toBe(-1);
    expect(player.attenuation).toBe(0);
    expect(gain.gain.value).toBe(0);

    // On top of the listener: centered and full volume.
    player.position = Vector.zero;
    step(e);
    expect(player.pan).toBe(0);
    expect(player.attenuation).toBe(1);
  });

  it("scales attenuated gain by the player's volume and rolloff", () => {
    const ctx = new StubContext();
    const player = mes(AudioPlayer2D, {
      src: buffer,
      position: new Vector(0, 50),
      maxDistance: 100,
      rolloff: 2,
      volume: 0.5,
    });
    const listener = mes(AudioListener2D, { position: Vector.zero });
    const world = mes(Unit2D, {}, [listener, player]);
    const e = engineWith(mes(AudioMixer, { context: ctx }, [world]));
    step(e);
    expect(player.attenuation).toBeCloseTo(0.25); // (1 - 0.5)^2
    expect(player.pan).toBe(0); // purely vertical offset
    expect(ctx.gains[1]!.gain.value).toBeCloseTo(0.125); // 0.5 × 0.25
  });

  it("follows the active camera's view center when no listener exists", () => {
    const ctx = new StubContext();
    const player = mes(AudioPlayer2D, {
      src: buffer,
      position: new Vector(40, 0),
      maxDistance: 80, // panRange 40
    });
    const camera = mes(Camera, {
      width: 100,
      height: 50,
      position: new Vector(40, 0),
    });
    const world = mes(Unit2D, {}, [camera, player]);
    const e = engineWith(mes(AudioMixer, { context: ctx }, [world]));
    step(e);
    expect(player.pan).toBe(0); // camera sits on the player
    expect(player.attenuation).toBe(1);

    camera.position = Vector.zero;
    // Two steps: the view center advances after the tick that spatializes,
    // so the mixer hears the camera move one fixed step later.
    step(e, 2);
    expect(player.pan).toBe(1); // 40 / 40, to the right
    expect(player.attenuation).toBeCloseTo(0.5);
  });

  it("spatializes immediately on registration, before the first tick", () => {
    const ctx = new StubContext();
    const listener = mes(AudioListener2D, { position: Vector.zero });
    const world = mes(Unit2D, {}, [listener]);
    engineWith(mes(AudioMixer, { context: ctx }, [world]));

    const player = mes(AudioPlayer2D, {
      src: buffer,
      position: new Vector(200, 0),
      maxDistance: 100,
    });
    world.addChild(player); // no step() after this
    expect(player.attenuation).toBe(0);
    expect(ctx.gains[ctx.gains.length - 1]!.gain.value).toBe(0);
  });
});

describe("scene swap and mixer", () => {
  it("tears all audio down on changeScene and keeps playing in the next scene", () => {
    const ctx = new StubContext();
    const music = mes(AudioPlayer, { src: buffer, loop: true });
    const chirp = mes(AudioPlayer2D, { src: buffer, loop: true });
    const scene = mes(AudioMixer, { context: ctx }, [music, chirp]);
    const e = engineWith(scene);
    step(e);
    const master = ctx.gains[0]!;
    expect(master.connected).toEqual([ctx.destination]);
    expect(ctx.sources.filter((s) => s.started).length).toBe(2);

    e.changeScene(mes(AudioMixer, { context: ctx }, []));
    expect(scene.destroyed).toBe(true);
    expect(music.playing).toBe(false);
    expect(chirp.playing).toBe(false);
    expect(chirp.audioMixer).toBeNull();
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
    expect(master.connected).toEqual([]); // master gain disconnected

    step(e, 5); // the new mixer ticks happily
  });

  it("applies volume and mute to the master gain", () => {
    const ctx = new StubContext();
    const mixer = mes(AudioMixer, { context: ctx, volume: 0.8 });
    engineWith(mixer);
    const master = ctx.gains[0]!;
    expect(master.gain.value).toBeCloseTo(0.8);
    mixer.muted = true;
    expect(master.gain.value).toBe(0);
    mixer.muted = false;
    mixer.volume = 0.2;
    expect(master.gain.value).toBeCloseTo(0.2);
  });
});

describe("autoplay unlock", () => {
  it("resumes a suspended context on the first gesture and fires unlocked$", async () => {
    // Node's globalThis is not an EventTarget; shim the listener API the
    // mixer feature-detects (in a browser this is the window).
    const listeners = new Map<string, Set<(ev: Event) => void>>();
    const g = globalThis as unknown as Record<string, unknown>;
    g.addEventListener = (type: string, cb: (ev: Event) => void) => {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(cb);
    };
    g.removeEventListener = (type: string, cb: (ev: Event) => void) => {
      listeners.get(type)?.delete(cb);
    };
    const dispatch = (type: string): void => {
      for (const cb of listeners.get(type) ?? []) cb(new Event(type));
    };
    try {
      const ctx = new StubContext();
      ctx.state = "suspended";
      const mixer = mes(AudioMixer, { context: ctx });
      engineWith(mixer);
      expect(mixer.unlocked).toBe(false);

      dispatch("pointerdown");
      await flush();
      expect(ctx.resumeCalls).toBe(1);
      expect(mixer.unlocked).toBe(true);

      // Listeners removed after unlock: further gestures do nothing.
      dispatch("keydown");
      await flush();
      expect(ctx.resumeCalls).toBe(1);
      const armed = [...listeners.values()].some((set) => set.size > 0);
      expect(armed).toBe(false);
    } finally {
      delete g.addEventListener;
      delete g.removeEventListener;
    }
  });

  it("reports unlocked immediately for a running context", () => {
    const ctx = new StubContext();
    const mixer = mes(AudioMixer, { context: ctx });
    engineWith(mixer);
    expect(mixer.unlocked).toBe(true);
  });
});

describe("headless safety", () => {
  it("runs a full lifecycle with no audio context at all", () => {
    // No `context` prop and no global AudioContext in node: silent mode.
    const player = mes(AudioPlayer2D, {
      src: buffer,
      position: new Vector(10, 0),
      maxDistance: 20,
    });
    const music = mes(AudioPlayer, { src: "song.ogg", loop: true });
    const scene = mes(AudioMixer, {}, [player, music]);
    const e = engineWith(scene);
    expect(scene.context).toBeNull();
    expect(scene.unlocked).toBe(true); // nothing to unlock

    step(e);
    expect(player.playing).toBe(true); // intent still tracked
    expect(player.attenuation).toBeCloseTo(0.5); // spatial math still runs
    expect(player.pan).toBe(1);
    music.volume = 0.5;
    player.stop();
    expect(player.playing).toBe(false);

    e.changeScene(mes(AudioMixer, {}, []));
    expect(scene.destroyed).toBe(true);
  });
});
