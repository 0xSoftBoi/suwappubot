'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Live: wrapper for every decorative graphic in the v3 kit.
 *
 * Renders `.v3-gfx[aria-hidden]` and toggles `data-live` on/off with an
 * IntersectionObserver; v3.css pauses every CSS animation inside while "off",
 * so nothing animates off-screen. Server render is "off" (animations wait for
 * the viewport, so draw-ons play when seen). The <noscript> rule shows the
 * final state when JS never runs. Reduced motion is handled in v3.css.
 */
export default function Live({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`v3-gfx ${className}`.trim()}
      data-live={on ? 'on' : 'off'}
      style={style}
      aria-hidden="true"
    >
      {children}
      <noscript>
        <style>{'.v3-gfx *{animation:none!important}.v3-pulse{display:none}'}</style>
      </noscript>
    </div>
  );
}
