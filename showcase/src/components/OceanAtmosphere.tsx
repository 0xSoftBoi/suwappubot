'use client';

import { useEffect, useRef, useState } from 'react';

/* Hero atmosphere: a slow aerial ocean loop behind the hero, plus an opt-in
   ambient soundscape. Footage is Pexels video 856204 (Pexels license: free
   for commercial use, no attribution required), streamed from the Pexels CDN
   rather than committed to the repo — the UHD file alone is 53 MB. */
const VIDEO_HD = 'https://videos.pexels.com/video-files/856204/856204-hd_1920_1080_25fps.mp4';
const VIDEO_UHD = 'https://videos.pexels.com/video-files/856204/856204-uhd_3840_2160_25fps.mp4';

type Labels = {
  soundOn: string;
  soundOff: string;
  videoLabel: string;
};

type AmbientHandle = {
  ctx: AudioContext;
  master: GainNode;
};

/* The soundscape is synthesized, not a file: filtered brown noise with two
   slow out-of-phase swells for the water, and a quiet detuned D-major pad
   underneath. Zero download, zero licensing, and it never audibly loops. */
function startAmbient(): AmbientHandle | null {
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctx) return null;
  const ctx: AudioContext = new Ctx();

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  master.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 4);
  master.connect(ctx.destination);

  // Ocean bed: looped brown noise -> lowpass -> swell gain.
  const seconds = 4;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.value = 420;
  noiseFilter.Q.value = 0.4;

  const swell = ctx.createGain();
  swell.gain.value = 0.32;

  for (const [rate, depth] of [
    [0.07, 0.16],
    [0.113, 0.1],
  ] as const) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = depth;
    lfo.connect(lfoGain);
    lfoGain.connect(swell.gain);
    lfo.start();
  }

  noise.connect(noiseFilter);
  noiseFilter.connect(swell);
  swell.connect(master);
  noise.start();

  // Pad: D2 / A2 / F#3 / E4, each a detuned pair, breathing at its own rate.
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 900;
  padFilter.connect(master);

  const notes: Array<[number, number, number]> = [
    [73.42, 0.05, 0.017], // D2
    [110.0, 0.04, 0.023], // A2
    [185.0, 0.028, 0.031], // F#3
    [329.63, 0.014, 0.041], // E4
  ];
  for (const [freq, level, breatheRate] of notes) {
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
    const breathe = ctx.createOscillator();
    breathe.frequency.value = breatheRate;
    const breatheGain = ctx.createGain();
    breatheGain.gain.value = level * 0.55;
    breathe.connect(breatheGain);
    breatheGain.connect(voice.gain);
    breathe.start();
    voice.connect(padFilter);
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
    if (reducedMotion || connection?.saveData) return; // static gradient only
    const slow = /(^|\b)(slow-2g|2g|3g)\b/.test(connection?.effectiveType ?? '');
    const wantsUhd =
      !slow && window.screen.width * (window.devicePixelRatio || 1) > 2200;
    setVideoSrc(slow ? null : wantsUhd ? VIDEO_UHD : VIDEO_HD);
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
        {videoSrc && (
          <video
            ref={videoRef}
            className={videoReady ? 'home-ocean__video is-ready' : 'home-ocean__video'}
            src={videoSrc}
            muted
            loop
            autoPlay
            playsInline
            preload="metadata"
            tabIndex={-1}
            aria-label={labels.videoLabel}
            onPlaying={() => setVideoReady(true)}
          />
        )}
        <div className="home-ocean__scrim" />
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
