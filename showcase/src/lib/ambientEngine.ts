/**
 * Generative ambient engine for the hero soundscape.
 *
 * Everything here is synthesized at runtime: there is no audio file to
 * download, license, or cache-bust, and because the composition is generated
 * rather than played back it never audibly loops.
 *
 * The signal graph, in the order sound flows:
 *
 *   pad voices  ─┐
 *   bell voices ─┼─> wet send ─> convolver ─> reverb gain ─┐
 *   water bed   ─┤                                          ├─> compressor ─> master ─> out
 *   wind band   ─┘─> dry path ─────────────────────────────┘
 *
 * The convolver is what separates this from oscillators-in-a-box. Its impulse
 * response is generated (see makeImpulseResponse) rather than fetched, so the
 * "room" costs no bytes.
 */

export type AmbientHandle = {
  stop: (fadeSeconds?: number) => void;
  suspend: () => void;
  resume: () => void;
};

/** D natural minor, as frequencies. The pad draws chords from these. */
const CHORDS: number[][] = [
  [73.42, 174.61, 220.0, 329.63], // Dm9    D2  F3  A3  E4
  [58.27, 174.61, 220.0, 293.66], // Bbmaj7 Bb1 F3  A3  D4
  [87.31, 174.61, 261.63, 329.63], // Fmaj9  F2  F3  C4  E4
  [98.0, 233.08, 293.66, 349.23], // Gm7    G2  Bb3 D4  F4
];

/** Sparse bell tones, high in the D-minor scale. */
const BELLS = [587.33, 698.46, 880.0, 1046.5, 1174.66];

/**
 * Procedural room impulse response.
 *
 * Exponentially decaying noise alone reads as static. What makes a synthetic
 * tail sound like a real space is that air absorbs high frequencies first, so
 * the noise runs through a one-pole lowpass whose cutoff closes across the
 * tail. A short fade-in keeps the onset reading as an early-reflection cluster
 * instead of a click. Decorrelated per channel, which is what widens it.
 */
function makeImpulseResponse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const ir = ctx.createBuffer(2, length, rate);
  const fadeIn = Math.floor(rate * 0.012);

  for (let channel = 0; channel < 2; channel++) {
    const data = ir.getChannelData(channel);
    let lowpass = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // One-pole coefficient: 1 passes everything, 0 blocks everything.
      const coeff = 0.3 - 0.26 * t;
      lowpass += coeff * (Math.random() * 2 - 1 - lowpass);
      let env = Math.pow(1 - t, decay);
      if (i < fadeIn) env *= i / fadeIn;
      data[i] = lowpass * env;
    }
  }
  return ir;
}

/** Brown-ish noise, used for both the water bed and the wind band. */
function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}

export function startAmbient(): AmbientHandle | null {
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  const ctx = new Ctor();
  const started = ctx.currentTime;
  /** Every node that must be torn down on stop(). */
  const sources: Array<AudioScheduledSourceNode> = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;

  // ── master bus ────────────────────────────────────────────────
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, started);
  // Long fade-in: the soundscape should arrive, not switch on.
  master.gain.exponentialRampToValueAtTime(0.6, started + 6);

  // Gentle glue so overlapping swells never stack into clipping.
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 22;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.15;
  compressor.release.value = 0.9;
  compressor.connect(master);
  master.connect(ctx.destination);

  // ── reverb ────────────────────────────────────────────────────
  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulseResponse(ctx, 5.5, 2.4);
  const reverbReturn = ctx.createGain();
  reverbReturn.gain.value = 0.85;
  convolver.connect(reverbReturn);
  reverbReturn.connect(compressor);

  /** Anything connected here is placed in the room. */
  const wet = ctx.createGain();
  wet.gain.value = 1;
  wet.connect(convolver);

  /** A little dry signal keeps the pad from turning to fog. */
  const dry = ctx.createGain();
  dry.gain.value = 0.35;
  dry.connect(compressor);

  /** Slow modulation helper: an LFO summed into an AudioParam. */
  const modulate = (target: AudioParam, rate: number, depth: number) => {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const amp = ctx.createGain();
    amp.gain.value = depth;
    lfo.connect(amp);
    amp.connect(target);
    lfo.start();
    sources.push(lfo);
  };

  // ── water bed ─────────────────────────────────────────────────
  // Noise through a lowpass, with two out-of-phase swells so the surge never
  // settles into a countable rhythm.
  const noise = makeNoiseBuffer(ctx, 4);
  const water = ctx.createBufferSource();
  water.buffer = noise;
  water.loop = true;
  const waterFilter = ctx.createBiquadFilter();
  waterFilter.type = 'lowpass';
  waterFilter.frequency.value = 440;
  waterFilter.Q.value = 0.4;
  const waterGain = ctx.createGain();
  waterGain.gain.value = 0.34;
  modulate(waterGain.gain, 0.07, 0.16);
  modulate(waterGain.gain, 0.113, 0.09);
  modulate(waterFilter.frequency, 0.05, 120);
  water.connect(waterFilter);
  waterFilter.connect(waterGain);
  waterGain.connect(dry);
  // A touch of the water in the room glues it to the pad.
  const waterSend = ctx.createGain();
  waterSend.gain.value = 0.18;
  waterGain.connect(waterSend);
  waterSend.connect(wet);
  water.start();
  sources.push(water);

  // ── distant wind ──────────────────────────────────────────────
  const wind = ctx.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  wind.playbackRate.value = 0.5;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 1250;
  windFilter.Q.value = 1.6;
  modulate(windFilter.frequency, 0.019, 380);
  const windGain = ctx.createGain();
  windGain.gain.value = 0.05;
  modulate(windGain.gain, 0.043, 0.03);
  wind.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(wet);
  wind.start();
  sources.push(wind);

  // ── voices ────────────────────────────────────────────────────
  /**
   * One pad note: three oscillators detuned in cents (the beating between them
   * is the width), through a lowpass, under a long swell. Nodes disconnect
   * themselves when the note ends so a long session doesn't accumulate garbage.
   */
  const padNote = (freq: number, at: number, duration: number, level: number) => {
    const voice = ctx.createGain();
    voice.gain.setValueAtTime(0.0001, at);
    voice.gain.exponentialRampToValueAtTime(level, at + duration * 0.45);
    voice.gain.exponentialRampToValueAtTime(0.0001, at + duration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 3, 900), at);
    // The note opens up as it swells, then closes again: movement without vibrato.
    filter.frequency.linearRampToValueAtTime(Math.min(freq * 7, 2400), at + duration * 0.45);
    filter.frequency.linearRampToValueAtTime(Math.min(freq * 3, 900), at + duration);
    filter.Q.value = 0.7;

    voice.connect(filter);
    const panner = ctx.createStereoPanner?.();
    if (panner) {
      panner.pan.value = (Math.random() * 2 - 1) * 0.5;
      filter.connect(panner);
      panner.connect(wet);
      panner.connect(dry);
    } else {
      filter.connect(wet);
      filter.connect(dry);
    }

    for (const detune of [-7, 0, 7]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(voice);
      osc.start(at);
      osc.stop(at + duration + 0.2);
      osc.onended = () => {
        osc.disconnect();
        voice.disconnect();
        filter.disconnect();
        panner?.disconnect();
      };
    }
  };

  /** A sparse bell: pure sine, struck and left to ring out in the reverb. */
  const bellNote = (freq: number, at: number, level: number) => {
    const voice = ctx.createGain();
    voice.gain.setValueAtTime(0.0001, at);
    voice.gain.exponentialRampToValueAtTime(level, at + 0.6);
    voice.gain.exponentialRampToValueAtTime(0.0001, at + 7);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(voice);
    // Bells go almost entirely to the room; that's what makes them feel distant.
    voice.connect(wet);
    osc.start(at);
    osc.stop(at + 7.2);
    osc.onended = () => {
      osc.disconnect();
      voice.disconnect();
    };
  };

  // ── scheduler ─────────────────────────────────────────────────
  // Lookahead scheduling against the audio clock rather than setTimeout: timer
  // callbacks jitter and drift, AudioContext.currentTime does not.
  const CHORD_SECONDS = 24;
  let nextChordAt = started + 0.5;
  let chordIndex = 0;
  let nextBellAt = started + 14;

  const schedule = () => {
    if (stopped) return;
    const horizon = ctx.currentTime + 2;

    while (nextChordAt < horizon) {
      const chord = CHORDS[chordIndex % CHORDS.length];
      chordIndex++;
      chord.forEach((freq, i) => {
        // Stagger entries so the chord assembles rather than lands as a block,
        // and overlap the previous chord's tail for a continuous bed.
        const at = nextChordAt + i * 1.7;
        const level = i === 0 ? 0.075 : 0.05 / Math.sqrt(i + 1);
        padNote(freq, at, CHORD_SECONDS * 1.4, level);
      });
      nextChordAt += CHORD_SECONDS;
    }

    while (nextBellAt < horizon) {
      bellNote(BELLS[Math.floor(Math.random() * BELLS.length)], nextBellAt, 0.03);
      // Irregular spacing; a metronomic bell would read as a UI chime.
      nextBellAt += 17 + Math.random() * 26;
    }
  };

  schedule();
  timer = setInterval(schedule, 500);

  return {
    stop(fadeSeconds = 1.4) {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + fadeSeconds);
      window.setTimeout(() => {
        for (const source of sources) {
          try {
            source.stop();
          } catch {
            /* already stopped */
          }
        }
        ctx.close().catch(() => {});
      }, fadeSeconds * 1000 + 120);
    },
    suspend() {
      if (!stopped) ctx.suspend().catch(() => {});
    },
    resume() {
      if (!stopped) ctx.resume().catch(() => {});
    },
  };
}
