'use client';

import { useLayoutEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from 'react';

/**
 * Reveal: scroll-entry rise + fade (translate 16px, 650ms).
 *
 * `stagger` reveals the direct children one after another instead of the
 * wrapper. Content is visible in SSR and with JS off: the hidden state is only
 * applied after hydration, and only to elements that start below the fold, so
 * there is no flash and no layout shift (translate/opacity only).
 * Reduced motion: never hidden.
 */
export default function Reveal({
  children,
  as,
  className = '',
  delay = 0,
  stagger = false,
  style,
  id,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  delay?: number;
  stagger?: boolean;
  style?: CSSProperties;
  id?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const Tag = (as ?? 'div') as ElementType;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9) {
      el.dataset.reveal = 'in';
      return;
    }
    el.dataset.reveal = 'hidden';
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        el.dataset.reveal = 'in';
        io.disconnect();
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      id={id}
      className={`${stagger ? 'v3-stagger ' : ''}${className}`.trim()}
      style={delay ? ({ ...style, '--v3-delay': `${delay}ms` } as CSSProperties) : style}
    >
      {children}
    </Tag>
  );
}
