'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * CountUp: counts 0 -> value when scrolled into view.
 * The final value is in the SSR HTML (so no-JS, crawlers and reduced-motion
 * see the real number); tabular-nums keeps the width steady while counting.
 * Only use for numbers that already exist in the codebase.
 */
export default function CountUp({
  value,
  duration = 1500,
  className = '',
}: {
  value: number;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / duration);
          setN(Math.round(value * (1 - Math.pow(1 - p, 4))));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        setN(0);
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className={`v3-count ${className}`.trim()}>
      {n.toLocaleString('en-US')}
    </span>
  );
}
