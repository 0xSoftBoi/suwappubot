'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';

interface StatCountUpProps {
  /** Final display value, e.g. "41", "18", "20x", "$0.001". Rendered as-is in
   * the initial (server) markup so the real number is always in the HTML. */
  value: string;
  className?: string;
}

interface ParsedStat {
  target: number;
  prefix: string;
  suffix: string;
  decimals: number;
}

// Pulls the leading/trailing text away from the numeral inside a stat string
// so callouts like "20x" or "$0.001" can count up just the number while the
// unit/currency mark stays put.
function parseStat(value: string): ParsedStat | null {
  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match || match.index === undefined) return null;
  const decimals = match[1] ? match[1].length - 1 : 0;
  return {
    target: parseFloat(match[0]),
    prefix: value.slice(0, match.index),
    suffix: value.slice(match.index + match[0].length),
    decimals,
  };
}

/** Talos-pattern count-up: animates 0 -> target once the stat scrolls into
 * view, 900ms, and collapses to the static final value under reduced motion
 * or if the string has no numeral to animate. */
export default function StatCountUp({ value, className }: StatCountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const prefersReduced = useReducedMotion();
  const parsed = useMemo(() => parseStat(value), [value]);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (!inView || prefersReduced || !parsed) return;
    const controls = animate(0, parsed.target, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate(latest) {
        setDisplay(`${parsed.prefix}${latest.toFixed(parsed.decimals)}${parsed.suffix}`);
      },
    });
    return () => controls.stop();
  }, [inView, prefersReduced, parsed]);

  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}
