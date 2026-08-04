'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Kinetic hero headline — word-swaps the audience noun ("traders" / "agents")
 * on a timer. Ties into the Trade/Build nav toggle conceptually (same two
 * audiences) without needing cross-component state plumbing for Phase 1.
 * Reduced-motion users just see the first word, no swap.
 */
const WORDS = ['traders', 'agents', 'builders'];

export default function HeroHeadline() {
  const [index, setIndex] = useState(0);
  const [key, setKey] = useState(0);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % WORDS.length);
      setKey((k) => k + 1);
    }, 2600);
    return () => clearInterval(id);
  }, [reduce]);

  return (
    <h1 className="font-display text-4xl font-medium leading-[1.05] tracking-tight text-[var(--ink-0)] md:text-5xl lg:text-6xl">
      One SDK to swap
      <br />
      for{' '}
      <span className="relative inline-block text-[var(--accent)]">
        <span key={key} className="kinetic-word">
          {WORDS[index]}
        </span>
      </span>
      .
    </h1>
  );
}
