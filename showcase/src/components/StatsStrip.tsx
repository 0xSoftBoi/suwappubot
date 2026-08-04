'use client';

import { useEffect, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';

/**
 * StatsStrip: the homepage "at a glance" row.
 *
 * The final value is what renders on the server and on first client paint, so
 * it is always present in the HTML for SEO and no-JS readers; the count-up only
 * rewinds to zero after mount, once the strip scrolls into view. Non-numeric
 * values ("Sub-second", "Non-custodial") never animate, and under
 * `prefers-reduced-motion` nothing animates at all.
 *
 * Values are passed in from the page so the generated product numbers keep a
 * single source of truth (`stats.generated.json`).
 */

export interface Stat {
  value: string;
  label: string;
}

const COUNT_UP_MS = 900;
const EASE = [0.22, 1, 0.36, 1] as const;

function StatValue({ value }: { value: string }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  const prefersReduced = useReducedMotion();
  const [display, setDisplay] = useState(value);

  // Only whole numbers count up; anything else is a word, not a numeral.
  const target = /^\d+$/.test(value) ? Number(value) : null;

  useEffect(() => {
    if (target === null || prefersReduced || !inView) return;
    const controls = animate(0, target, {
      duration: COUNT_UP_MS / 1000,
      ease: [...EASE],
      onUpdate: (v) => setDisplay(String(Math.round(v))),
      onComplete: () => setDisplay(value),
    });
    return () => controls.stop();
  }, [inView, target, prefersReduced, value]);

  return <strong ref={ref}>{display}</strong>;
}

export default function StatsStrip({ stats }: { stats: Stat[] }) {
  return (
    <section className="summer-stats" aria-label="At a glance">
      {stats.map((s, i) => (
        <div
          className="summer-stat sw-rise"
          key={s.label}
          style={{ '--rise-i': i } as React.CSSProperties}
        >
          <StatValue value={s.value} />
          <span>{s.label}</span>
        </div>
      ))}
    </section>
  );
}
