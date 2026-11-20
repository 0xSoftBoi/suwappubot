'use client';

import { useRef, type CSSProperties, type ReactNode } from 'react';

/**
 * SpotlightCard: bento card with a pointer-reactive glow and a mini-visual slot.
 *
 *   <SpotlightCard visual={<MiniViz kind="route" />} index="01" title="…" href="#x">body</SpotlightCard>
 *
 * Renders <a> when `href` is set, otherwise <article>. The glow follows the
 * pointer via --mx/--my (set imperatively: no re-render). Glow colour comes
 * from --v3-glow so it works on dark and light tones. Add `className="v3-span-2"`
 * inside `.v3-bento` for a wide card.
 */
export default function SpotlightCard({
  visual,
  index,
  title,
  children,
  href,
  external,
  arrow,
  className = '',
  id,
  style,
}: {
  visual?: ReactNode;
  index?: string;
  title: ReactNode;
  children?: ReactNode;
  href?: string;
  external?: boolean;
  arrow?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLElement>(null);

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  const inner = (
    <>
      {visual ? <div className="v3-tile__visual" aria-hidden="true">{visual}</div> : null}
      <div className="v3-tile__body">
        {index ? <span className="v3-tile__index">{index}</span> : null}
        <h3 className="v3-tile__title">{title}</h3>
        {children ? <p className="v3-tile__text">{children}</p> : null}
        {arrow ? <span className="v3-tile__arrow" aria-hidden="true">{arrow}</span> : null}
      </div>
    </>
  );
  const cls = `v3-tile ${className}`.trim();

  if (href) {
    return (
      <a
        ref={ref as React.RefObject<HTMLAnchorElement>}
        id={id}
        className={cls}
        style={style}
        href={href}
        onPointerMove={onMove}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {inner}
      </a>
    );
  }
  return (
    <article ref={ref as React.RefObject<HTMLElement>} id={id} className={cls} style={style} onPointerMove={onMove}>
      {inner}
    </article>
  );
}
