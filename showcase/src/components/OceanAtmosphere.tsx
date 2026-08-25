'use client';

import { useEffect, useRef, useState } from 'react';

/* Hero atmosphere: a golden-hour open-ocean loop behind the hero, plus an
   opt-in ambient soundscape. Footage is Pexels video 1093652 (Pexels
   license: free for commercial use, no attribution required), streamed from
   the Pexels CDN rather than committed — the UHD file is 25 MB. The poster
   frame paints immediately so the first impression is water, not a gradient
   waiting for a video. */
const VIDEO_HD = 'https://videos.pexels.com/video-files/1093652/1093652-hd_1920_1080_30fps.mp4';
const VIDEO_UHD = 'https://videos.pexels.com/video-files/1093652/1093652-uhd_3840_2160_30fps.mp4';
const POSTER =
  'https://images.pexels.com/videos/1093652/free-video-1093652.jpg?auto=compress&cs=tinysrgb&w=1920';

type Labels = {
  soundOn: string;
  soundOff: string;
  videoLabel: string;
  scroll: string;
};

type AmbientHandle = {
  ctx: AudioContext;
  master: GainNode;
};

/* The soundscape is synthesized, not a file: filtered brown noise with slow
   out-of-phase swells for the water, a distant band of wind, and a quiet
   detuned D-major pad drifting across the stereo field under a breathing
   lowpass. Zero download, zero licensing, and it never audibly loops. */
function startAmbient(): AmbientHandle | null {
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctx) return null;
  const ctx: AudioContext = new Ctx();

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 5);
  master.connect(ctx.destination);

  const slowGainLfo = (target: AudioParam, rate: number, depth: number) => {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const amp = ctx.createGain();
    amp.gain.value = depth;
    lfo.connect(amp);
    amp.connect(target);
    lfo.start();
  };

  // Shared noise buffer (brown-ish), reused by water and wind.
  const seconds = 4;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }

  // Water bed: noise -> lowpass -> swelling gain.
  const water = ctx.createBufferSource();
  water.buffer = buffer;
  water.loop = true;
  const waterFilter = ctx.createBiquadFilter();
  waterFilter.type = 'lowpass';
  waterFilter.frequency.value = 420;
  waterFilter.Q.value = 0.4;
  const waterGain = ctx.createGain();
  waterGain.gain.value = 0.3;
  slowGainLfo(waterGain.gain, 0.07, 0.15);
  slowGainLfo(waterGain.gain, 0.113, 0.09);
  water.connect(waterFilter);
  waterFilter.connect(waterGain);
  waterGain.connect(master);
  water.start();

  // Distant wind: the same noise through a drifting bandpass, barely there.
  const wind = ctx.createBufferSource();
  wind.buffer = buffer;
  wind.loop = true;
  wind.playbackRate.value = 0.5;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.frequency.value = 1300;
  windFilter.Q.value = 1.4;
  slowGainLfo(windFilter.frequency, 0.019, 350);
  const windGain = ctx.createGain();
  windGain.gain.value = 0.05;
  slowGainLfo(windGain.gain, 0.043, 0.03);
  wind.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(master);
  wind.start();

  // Pad: D2 / A2 / F#3 / E4 detuned pairs, each breathing at its own rate
  // and drifting slowly across the stereo field, under a lowpass that
  // opens and closes over ~90 s.
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 900;
  slowGainLfo(padFilter.frequency, 0.011, 320);
  padFilter.connect(master);

  const notes: Array<[number, number, number, number]> = [
    [73.42, 0.05, 0.017, 0.006], // D2  (kept centered)
    [110.0, 0.04, 0.023, 0.009], // A2
    [185.0, 0.028, 0.031, 0.013], // F#3
    [329.63, 0.014, 0.041, 0.017], // E4
  ];
  for (const [freq, level, breatheRate, panRate] of notes) {
    const voice = ctx.createGain();
    voice.gain.value = level;
    for (const detune of [-3, 3]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(voice);
      osc.start();
    }
    slowGainLfo(voice.gain, breatheRate, level * 0.55);
    let out: AudioNode = voice;
    if (ctx.createStereoPanner && freq > 100) {
      const pan = ctx.createStereoPanner();
      slowGainLfo(pan.pan, panRate, 0.45);
      voice.connect(pan);
      out = pan;
    }
    out.connect(padFilter);
  }

  return { ctx, master };
}

export default function OceanAtmosphere({ labels }: { labels: Labels }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ambientRef = useRef<AmbientHandle | null>(null);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [soundOn, setSoundOn] = useState(false);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const connection = (navigator as any).connection;
    if (reducedMotion || connection?.saveData) return; // poster stays as a still
    const slow = /(^|\b)(slow-2g|2g|3g)\b/.test(connection?.effectiveType ?? '');
    if (slow) return;
    const wantsUhd = window.screen.width * (window.devicePixelRatio || 1) > 2200;
    setVideoSrc(wantsUhd ? VIDEO_UHD : VIDEO_HD);
  }, []);

  // Don't burn battery animating a background nobody is looking at.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (video) document.hidden ? video.pause() : video.play().catch(() => {});
      ambientRef.current?.ctx[document.hidden ? 'suspend' : 'resume']();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    return () => {
      ambientRef.current?.ctx.close().catch(() => {});
      ambientRef.current = null;
    };
  }, []);

  const toggleSound = () => {
    const handle = ambientRef.current;
    if (soundOn && handle) {
      const t = handle.ctx.currentTime;
      handle.master.gain.cancelScheduledValues(t);
      handle.master.gain.setValueAtTime(handle.master.gain.value, t);
      handle.master.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      setTimeout(() => {
        ambientRef.current?.ctx.close().catch(() => {});
        ambientRef.current = null;
      }, 1400);
      setSoundOn(false);
      return;
    }
    ambientRef.current = startAmbient();
    if (ambientRef.current) setSoundOn(true);
  };

  return (
    <>
      <div className="home-ocean" aria-hidden="true">
        <div className="home-ocean__media">
          {/* Plain <img>, not next/image: it's a full-bleed background frame
              from a remote CDN — no layout sizing or srcset wanted. */}
          <img className="home-ocean__poster" src={POSTER} alt="" fetchPriority="high" />
          {videoSrc && (
            <video
              ref={videoRef}
              className={videoReady ? 'home-ocean__video is-ready' : 'home-ocean__video'}
              src={videoSrc}
              muted
              loop
              autoPlay
              playsInline
              preload="auto"
              tabIndex={-1}
              aria-label={labels.videoLabel}
              onPlaying={() => setVideoReady(true)}
            />
          )}
        </div>
        <div className="home-ocean__scrim" />
        <div className="home-ocean__grain" />
        <div className="home-ocean__vignette" />
      </div>
      <div className="home-scrollcue" aria-hidden="true">
        <span>{labels.scroll}</span>
        <i />
      </div>
      <button
        type="button"
        className={soundOn ? 'home-sound is-on' : 'home-sound'}
        onClick={toggleSound}
        aria-pressed={soundOn}
      >
        <span className="home-sound__bars" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        {soundOn ? labels.soundOn : labels.soundOff}
      </button>
    </>
  );
}
