'use client';

import { useEffect, useRef, useState } from 'react';
import { SplitFlap } from './SplitFlap';
import styles from './next.module.css';

/*
 * Race plays ONCE on mount (~3.4 s), then settles and holds permanently.
 * `start` is captured as a closure variable so Strict-Mode double-invoke
 * never shares a stale timestamp between invocations.
 */

const ROUTERS = [
  { id: 'lifi',      label: 'lifi',       base: 2987.12, cap: 0.91 },
  { id: 'cow',       label: 'cow',        base: 2984.55, cap: 0.88 },
  { id: 'okx',       label: 'okx',        base: 2990.44, cap: 1.00, winner: true },
  { id: '1inch',     label: '1inch',      base: 2986.01, cap: 0.93 },
  { id: 'kyberswap', label: 'kyberswap',  base: 2983.90, cap: 0.85 },
  { id: 'jupiter',   label: 'jupiter',    base: 2981.27, cap: 0.79 },
  { id: 'across',    label: 'across',     base: 2975.44, cap: 0.72 },
  { id: 'cctp',      label: 'cctp',       base: 2970.11, cap: 0.68 },
  { id: 'paraswap',  label: 'paraswap',   base: 2980.88, cap: 0.81 },
];

const RACE_MS = 3400;

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PhosphorRace() {
  const rafRef = useRef<number | null>(null);

  // progress 0→1 during race; permanently 1 after. settled = progress reached 1.
  const [progress, setProgress] = useState(0);
  const [settled,  setSettled]  = useState(false);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    if (reduced) {
      setProgress(1);
      setSettled(true);
      return;
    }

    // `start` is local to THIS effect invocation: immune to Strict Mode sharing
    const start = performance.now();

    const step = (now: number) => {
      const elapsed = now - start;
      if (elapsed < RACE_MS) {
        setProgress(elapsed / RACE_MS);
        rafRef.current = requestAnimationFrame(step);
      } else {
        // Lock permanently: no further rAF
        setProgress(1);
        setSettled(true);
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.racePanel} role="region" aria-label="Router price race">
      <div className={styles.racePanelHeader}>
        <span className={styles.raceTitle}>ROUTING</span>
        <span className={styles.racePair}>
          ETH <span className={styles.raceArrow}>→</span> USDC
        </span>
        <span className={styles.raceAmt}>1.0</span>
      </div>

      <div className={styles.raceRows}>
        {ROUTERS.map((r) => {
          const isWinner = !!r.winner;
          // During race: progress climbs 0→1; bars fill to Math.min(progress, cap).
          // Once settled (progress=1): fill = cap. Bars stay at caps forever.
          const fill = Math.min(progress, r.cap);
          // Loser quotes drift slightly during the race then converge to their base
          const noiseSeed = r.id.charCodeAt(0) * 0.003 - 0.4;
          const quote = (settled || isWinner)
            ? fmt(r.base)
            : fmt(r.base + noiseSeed * (1 - progress) * 0.6);

          return (
            <div
              key={r.id}
              className={styles.raceRow}
              data-winner={isWinner ? 'true' : undefined}
              data-settled={settled && isWinner ? 'true' : undefined}
            >
              <span className={styles.raceRouterName}>{r.label}</span>
              <span className={styles.raceBarWrap} aria-hidden="true">
                <span
                  className={styles.raceBar}
                  style={{ width: `${fill * 100}%` }}
                />
                {isWinner && settled && (
                  <span className={styles.raceGlow} aria-hidden="true" />
                )}
              </span>
              <span className={styles.raceQuote}>{quote}</span>
              {isWinner && settled && (
                <span className={styles.raceBest}>◀ BEST</span>
              )}
            </div>
          );
        })}
      </div>

      <div className={styles.raceSummary}>
        <span className={styles.raceBestLabel}>▶ BEST</span>
        <span className={styles.raceBestValue}>
          <SplitFlap value="2,990.44" settled={settled} />
          {settled && <span className={styles.raceCursor} aria-hidden="true" />}
          {' '}USDC
        </span>
      </div>

      <p className={styles.raceMeta}>
        resolved in 0.34s · 9 quotes · best of 9
      </p>

      <p className={styles.raceCaption}>
        non-custodial · sub-second · 9 routers raced · you sign
      </p>
    </div>
  );
}
