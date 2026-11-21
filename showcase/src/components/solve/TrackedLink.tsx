'use client';

import type { ReactNode } from 'react';
import { track } from '@/lib/analytics';

/**
 * Link that fires the first-party `cta_clicked` event (an "intent" event on the
 * Growth dashboard) before navigating. The sink keeps `surface`, `slug`,
 * `dest` and `kind` as props; `dest` is a host or path, never a full URL.
 */
export default function TrackedLink({
  href, surface, slug, kind = 'link', className, children, ariaLabel, sameTab,
}: {
  href: string;
  surface: string;
  slug: string;
  kind?: 'primary' | 'secondary' | 'band' | 'related' | 'proof' | 'product' | 'link';
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  /** Keep an external link in the current tab (e.g. the Terminal launch). */
  sameTab?: boolean;
}) {
  const external = /^https?:\/\//.test(href);
  let dest = href.split('?')[0];
  if (external) {
    try { dest = new URL(href).hostname; } catch { /* keep as is */ }
  }
  return (
    <a
      href={href}
      className={className}
      aria-label={ariaLabel}
      {...(external && !sameTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={() => track('cta_clicked', { surface, slug, dest, kind })}
    >
      {children}
    </a>
  );
}
