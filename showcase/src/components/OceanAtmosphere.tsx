'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { startAmbient, type AmbientHandle } from '@/lib/ambientEngine';

/**
 * Hero atmosphere: a golden-hour ocean loop behind the hero, plus an opt-in
 * generative soundscape (see @/lib/ambientEngine).
 *
 * The footage is Pexels video 1093652 (Pexels licence: free for commercial
 * use, no attribution required), re-encoded and SELF-HOSTED. It is not
 * hotlinked from the Pexels CDN: a third party we do not control should never
 * be able to break or throttle the first thing a visitor sees.
 *
 * What ships, and why (see scripts/encode-ocean.sh for the exact ffmpeg calls
 * and the measurements behind each number):
 *  - a seamless loop: the cut point was found by searching every frame pair in
 *    the source for the tightest colour match, then dissolved over 0.5s
 *  - H.264 only. WebM was measured on this footage and lost, and H.264 has
 *    universal hardware decode, which matters for a video that loops forever
 *    in the background of somebody's phone.
 *  - 1080p (1.3 MB) for tablet-and-up, 720p (476 KB) for phones
 *  - a WebP poster of the loop's OPENING frame, so the poster-to-video handoff
 *    has nothing to flash between
 */

type Variant = '1080' | '720';

type Labels = {
  soundOn: string;
  soundOff: string;
  videoLabel: string;
  motionPause: string;
  motionPlay: string;
};

// Session-scoped so a visitor who pauses the loop doesn't have it spring back
// to life on the next page in the same tab (sessionStorage, not localStorage:
// this is a per-visit preference, not a persistent one).
const MOTION_PAUSED_KEY = 'sw-ocean-motion-paused';

function readStoredPause(): boolean {
  try {
    return sessionStorage.getItem(MOTION_PAUSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStoredPause(paused: boolean) {
  try {
    if (paused) {
      sessionStorage.setItem(MOTION_PAUSED_KEY, '1');
    } else {
      sessionStorage.removeItem(MOTION_PAUSED_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode, quota) — the toggle still
    // works for the current render, it just won't survive navigation.
  }
}

export default function OceanAtmosphere({ labels }: { labels: Labels }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ambientRef = useRef<AmbientHandle | null>(null);
  const [variant, setVariant] = useState<Variant | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const motionPausedRef = useRef(false);

  // Decide whether to load video at all, and at what size. Runs after
  // hydration, which also keeps the video off the critical path: the poster
  // gets the network to itself while it is the largest contentful paint.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } })
      .connection;
    if (connection?.saveData) return;
    if (/(^|\b)(slow-2g|2g|3g)\b/.test(connection?.effectiveType ?? '')) return;
    setVariant(window.innerWidth >= 700 ? '1080' : '720');

    const paused = readStoredPause();
    motionPausedRef.current = paused;
    setMotionPaused(paused);
  }, []);

  // Once the video element exists, honor a pause carried over from earlier
  // in the session (or set moments ago, before the element mounted).
  useEffect(() => {
    if (!variant) return;
    const video = videoRef.current;
    if (motionPaused) {
      video?.pause();
    }
  }, [variant, motionPaused]);

  // Don't animate or synthesize for a tab nobody is looking at.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (document.hidden) {
        video?.pause();
        ambientRef.current?.suspend();
      } else {
        // A user-initiated pause takes precedence over the visibility
        // handler: coming back to the tab should not restart motion the
        // visitor explicitly stopped.
        if (!motionPausedRef.current) video?.play().catch(() => {});
        ambientRef.current?.resume();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(
    () => () => {
      ambientRef.current?.stop(0.2);
      ambientRef.current = null;
    },
    []
  );

  const toggleSound = useCallback(() => {
    if (ambientRef.current) {
      ambientRef.current.stop();
      ambientRef.current = null;
      setSoundOn(false);
      return;
    }
    ambientRef.current = startAmbient();
    setSoundOn(Boolean(ambientRef.current));
  }, []);

  // WCAG 2.2.2: the loop runs longer than 5s with no other way to stop it, so
  // it needs a real pause control. Pausing freezes the current frame in
  // place — it does not fall back to the poster, which would visibly jump.
  const toggleMotion = useCallback(() => {
    const video = videoRef.current;
    const next = !motionPausedRef.current;
    motionPausedRef.current = next;
    setMotionPaused(next);
    writeStoredPause(next);
    if (next) {
      video?.pause();
    } else if (!document.hidden) {
      video?.play().catch(() => {});
    }
  }, []);

  return (
    <>
      <div className="home-ocean" aria-hidden="true">
        <div className="home-ocean__media">
          {/* Plain img, not next/image: a full-bleed background frame already
              encoded at the size we serve wants no re-optimizing. One format
              (WebP, universally supported) rather than an AVIF/WebP picture, so
              the preload in page.tsx maps to exactly the file that gets used and
              no browser fetches two posters. */}
          <img
            className="home-ocean__poster"
            src="/media/ocean-poster.webp"
            alt=""
            decoding="async"
            fetchPriority="high"
          />

          {variant && (
            <video
              ref={videoRef}
              className={videoReady ? 'home-ocean__video is-ready' : 'home-ocean__video'}
              muted
              loop
              autoPlay
              playsInline
              preload="auto"
              tabIndex={-1}
              aria-label={labels.videoLabel}
              onPlaying={() => setVideoReady(true)}
              src={`/media/ocean-${variant}.mp4`}
            />
          )}
        </div>
        <div className="home-ocean__scrim" />
        <div className="home-ocean__grain" />
        <div className="home-ocean__vignette" />
      </div>

      <div className="home-atmosphere-controls">
        {variant && (
          <button
            type="button"
            className={motionPaused ? 'home-sound' : 'home-sound is-on'}
            onClick={toggleMotion}
            aria-pressed={motionPaused}
            aria-label={motionPaused ? labels.motionPlay : labels.motionPause}
          >
            {motionPaused ? labels.motionPlay : labels.motionPause}
          </button>
        )}

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
      </div>
    </>
  );
}
