import type { ReactNode } from 'react';

/**
 * Section layouts + header pattern (server components).
 *
 *   <V3Section id tone="dark|light" variant="default|bleed|band" backdrop={<Backdrop …/>}>
 *     <SectionHead kicker title lead align="start|center" id="…-title" />
 *     …content using .v3-split / .v3-bento / .v3-stagger
 *   </V3Section>
 *
 * variants:  default (padded), bleed (overflow clipped, for full-width visual
 * stages), band (short quiet band). Layout helper classes live in v3.css:
 * .v3-split (+ --reverse, --wide-visual) and .v3-bento (+ .v3-span-2).
 * `tone="light"` flips every kit variable to cream/navy for that section.
 */
export function V3Section({
  id,
  tone,
  variant = 'default',
  backdrop,
  className = '',
  labelledBy,
  children,
  wrap = true,
}: {
  id?: string;
  tone?: 'dark' | 'light';
  variant?: 'default' | 'bleed' | 'band';
  backdrop?: ReactNode;
  className?: string;
  labelledBy?: string;
  children: ReactNode;
  wrap?: boolean;
}) {
  const cls = [
    'v3-section',
    variant !== 'default' ? `v3-section--${variant}` : '',
    tone ? `v3-tone-${tone} v3-section--${tone}` : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <section id={id} className={cls} aria-labelledby={labelledBy}>
      {backdrop}
      {wrap ? <div className="v3-wrap">{children}</div> : children}
    </section>
  );
}

export function SectionHead({
  kicker,
  title,
  lead,
  align = 'start',
  id,
  level = 2,
}: {
  kicker?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  align?: 'start' | 'center';
  id?: string;
  level?: 1 | 2;
}) {
  const H = level === 1 ? 'h1' : 'h2';
  return (
    <header className={`v3-head${align === 'center' ? ' v3-head--center' : ''}`}>
      {kicker ? <p className="v3-kicker">{kicker}</p> : null}
      <H id={id} className="v3-head__title">{title}</H>
      {lead ? <p className="v3-head__lead">{lead}</p> : null}
    </header>
  );
}

/** Absolute, aria-hidden background treatment. Sits at z-index -1 of its section. */
export function Backdrop({ kind = 'mesh', className = '' }: { kind?: 'mesh' | 'glow' | 'grid' | 'grain' | 'mesh-grain'; className?: string }) {
  if (kind === 'mesh-grain') {
    return (
      <>
        <span className={`v3-bd v3-mesh ${className}`} aria-hidden="true" />
        <span className="v3-bd v3-grain" aria-hidden="true" />
      </>
    );
  }
  return <span className={`v3-bd v3-${kind} ${className}`} aria-hidden="true" />;
}
