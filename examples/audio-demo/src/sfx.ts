/**
 * Procedural sound: every buffer in the game is rendered offline from
 * oscillators, so the demo ships zero audio files. The buffers are plain
 * `AudioBuffer`s passed straight to `AudioPlayer`/`AudioPlayer2D` as `src`.
 */

const SAMPLE_RATE = 44100;

export interface Sfx {
  chirp: AudioBuffer;
  pickup: AudioBuffer;
  fanfare: AudioBuffer;
  music: AudioBuffer;
}

async function render(
  seconds: number,
  build: (ctx: OfflineAudioContext) => void,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(
    2,
    Math.ceil(seconds * SAMPLE_RATE),
    SAMPLE_RATE,
  );
  build(ctx);
  return ctx.startRendering();
}

interface Tone {
  type: OscillatorType;
  freq: number;
  /** Optional pitch glide target over the tone's duration. */
  freqEnd?: number;
  at: number;
  dur: number;
  vol: number;
}

/** One enveloped oscillator note: fast attack, exponential decay. */
function tone(ctx: OfflineAudioContext, t: Tone): void {
  const osc = ctx.createOscillator();
  osc.type = t.type;
  osc.frequency.setValueAtTime(t.freq, t.at);
  if (t.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(t.freqEnd, t.at + t.dur);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t.at);
  gain.gain.linearRampToValueAtTime(t.vol, t.at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t.at + t.dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t.at);
  osc.stop(t.at + t.dur);
}

/** Two quick upward sine sweeps, then silence — a bird chirp loop (~1.5s). */
const makeChirp = (): Promise<AudioBuffer> =>
  render(1.5, (ctx) => {
    tone(ctx, {
      type: "sine",
      freq: 2100,
      freqEnd: 3400,
      at: 0.02,
      dur: 0.1,
      vol: 0.5,
    });
    tone(ctx, {
      type: "sine",
      freq: 2500,
      freqEnd: 3900,
      at: 0.17,
      dur: 0.09,
      vol: 0.4,
    });
  });

/** Three rising triangle notes — the "found one" reward. */
const makePickup = (): Promise<AudioBuffer> =>
  render(0.55, (ctx) => {
    const notes = [660, 880, 1320];
    notes.forEach((freq, i) => {
      tone(ctx, {
        type: "triangle",
        freq,
        at: i * 0.09,
        dur: 0.22,
        vol: 0.45,
      });
    });
  });

/** A little major-arpeggio flourish for finding every bird. */
const makeFanfare = (): Promise<AudioBuffer> =>
  render(1.8, (ctx) => {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, i) => {
      tone(ctx, {
        type: "triangle",
        freq,
        at: i * 0.13,
        dur: i === notes.length - 1 ? 0.9 : 0.28,
        vol: 0.4,
      });
    });
  });

/**
 * A four-chord ambient loop (Am–F–G–C): a soft triangle bass on each chord
 * and a slow sine arpeggio above it. 7.2 seconds, loops cleanly because every
 * envelope decays out before the boundary.
 */
const makeMusic = (): Promise<AudioBuffer> => {
  const chords = [
    [220.0, 261.63, 329.63, 440.0], // Am
    [174.61, 220.0, 261.63, 349.23], // F
    [196.0, 246.94, 293.66, 392.0], // G
    [261.63, 329.63, 392.0, 523.25], // C
  ];
  const chordDur = 1.8;
  return render(chords.length * chordDur, (ctx) => {
    chords.forEach((chord, c) => {
      const at = c * chordDur;
      const root = chord[0]!;
      tone(ctx, {
        type: "triangle",
        freq: root / 2,
        at: at + 0.02,
        dur: chordDur - 0.15,
        vol: 0.16,
      });
      for (let i = 0; i < 6; i++) {
        tone(ctx, {
          type: "sine",
          freq: chord[(i % 3) + 1]! * (i >= 3 ? 2 : 1),
          at: at + 0.08 + i * 0.28,
          dur: 0.5,
          vol: 0.09,
        });
      }
    });
  });
};

export async function makeSfx(): Promise<Sfx> {
  const [chirp, pickup, fanfare, music] = await Promise.all([
    makeChirp(),
    makePickup(),
    makeFanfare(),
    makeMusic(),
  ]);
  return { chirp, pickup, fanfare, music };
}
