'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './next.module.css';

/*
 * Value mask for "2,990.44":
 *   index  0   1   2  3  4   5   6  7
 *   char   2   ,   9  9  0   .   4  4
 *   type  DIG SEP DIG DIG DIG SEP DIG DIG
 *
 * SEP characters (',' and '.') are rendered as plain static spans: never
 * shuffled, never wrong. Only DIG slots cycle through DIGIT_CHARS.
 *
 * While racing  : digits shuffle continuously (random from DIGIT_CHARS).
 * On settle     : each digit stagger-flips SETTLE_TICKS times then locks
 *                 to its real target char (the prop), left-to-right.
 * After settle  : display is frozen at the real char permanently.
 *
 * No hasLocked guard: the parent never resets settled back to false, so
 * the settle effect fires exactly once and the timeout runs to completion.
 */

const DIGIT_CHARS  = '9053728416';
const SHUFFLE_HZ   = 75;   // ms between drum ticks while racing
const SETTLE_TICKS = 9;    // random flips before locking on each digit
const SETTLE_HZ    = 50;   // ms per settle tick

function Sep({ char }: { char: string }) {
  return <span className={styles.sfSep}>{char}</span>;
}

function Digit({
  targetChar,
  settled,
  startDelay,
}: {
  targetChar: string;
  settled: boolean;
  startDelay: number;
}) {
  // Start with a random digit so we never flash the real value before the race
  const [display, setDisplay] = useState<string>(
    () => DIGIT_CHARS[Math.floor(Math.random() * DIGIT_CHARS.length)]
  );
  const [locked, setLocked] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval>  | null>(null);
  const timerRef    = useRef<ReturnType<typeof setTimeout>   | null>(null);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Phase 1: shuffle while racing ───────────────────────────────────
  useEffect(() => {
    if (reduced) return; // skip to settle

    intervalRef.current = setInterval(() => {
      setDisplay(DIGIT_CHARS[Math.floor(Math.random() * DIGIT_CHARS.length)]);
    }, SHUFFLE_HZ);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ── Phase 2: on settle, stop shuffle and flip-lock to real char ──────
  useEffect(() => {
    if (!settled) return;

    // Stop the shuffle
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Reduced-motion: snap directly to target
    if (reduced) {
      setDisplay(targetChar);
      setLocked(true);
      return;
    }

    // Staggered settle: flip N times then hard-lock on targetChar.
    // Capture targetChar in the closure right now: it won't change.
    const target = targetChar;
    let tick = 0;

    const run = () => {
      tick++;
      if (tick >= SETTLE_TICKS) {
        setDisplay(target);
        setLocked(true);
        return; // done: no more scheduling
      }
      setDisplay(DIGIT_CHARS[Math.floor(Math.random() * DIGIT_CHARS.length)]);
      timerRef.current = setTimeout(run, SETTLE_HZ);
    };

    timerRef.current = setTimeout(run, startDelay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]); // fires once when settled flips true; targetChar is stable

  return (
    <span className={styles.sfDigit} data-locked={locked ? 'true' : undefined}>
      {display}
    </span>
  );
}

export function SplitFlap({ value, settled }: { value: string; settled: boolean }) {
  let digitSlot = 0;
  const glyphs = value.split('').map((ch, i) => {
    const isSep = ch === ',' || ch === '.';
    const delay = isSep ? 0 : digitSlot++ * 90;
    return { ch, isSep, delay, i };
  });

  return (
    <span className={styles.sfRoot} aria-label={settled ? value : 'calculating'}>
      {glyphs.map(({ ch, isSep, delay, i }) =>
        isSep
          ? <Sep key={i} char={ch} />
          : <Digit key={i} targetChar={ch} settled={settled} startDelay={delay} />
      )}
    </span>
  );
}
