'use client';

import { useState, useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { MENU_PANELS } from './NavMenuData';

/**
 * NavDrawer: the small-screen menu, shared by both header shells.
 *
 * The homepage header used to hide its links outright below 980px with nothing
 * to replace them, so phones got no navigation at all. Both headers now render
 * this: a hamburger, and a drawer carrying the same product directory as the
 * desktop mega menu, collapsed into accordions.
 */
export default function NavDrawer({
  extraLinks = [],
  actions,
  className = '',
}: {
  /** Flat links shown under the accordions (Pricing, Docs, ...). */
  extraLinks?: Array<{ href: string; label: string; external?: boolean }>;
  /** Rendered at the bottom of the drawer: the CTAs each shell wants. */
  actions?: ReactNode;
  className?: string;
}) {
  const tm = useTranslations('nav.menu');
  const [open, setOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        className={`nav__hamburger ${className}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? 'Close menu' : 'Open menu'}
      >
        <span className={`nav__hamburger-line ${open ? 'nav__hamburger-line--open' : ''}`} />
        <span className={`nav__hamburger-line ${open ? 'nav__hamburger-line--open' : ''}`} />
        <span className={`nav__hamburger-line ${open ? 'nav__hamburger-line--open' : ''}`} />
      </button>

      {/* Clips the off-screen drawer so it cannot create horizontal scroll. */}
      <div className="nav__portal">
      {open && <div className="nav__backdrop" onClick={close} aria-hidden="true" />}

      <div
        id="mobile-menu"
        className={`nav__drawer ${open ? 'nav__drawer--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        {MENU_PANELS.map((panel) => {
          const expanded = openSection === panel.id;
          return (
            <div key={panel.id} className="nav__drawer-section">
              <button
                type="button"
                className={`nav__drawer-toggle${expanded ? ' nav__drawer-toggle--open' : ''}`}
                aria-expanded={expanded}
                aria-controls={`drawer-panel-${panel.id}`}
                onClick={() => setOpenSection(expanded ? null : panel.id)}
              >
                {tm(panel.key)}
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div id={`drawer-panel-${panel.id}`} className="nav__drawer-sublist" hidden={!expanded}>
                {panel.groups.flatMap((group) =>
                  group.items.map((item) => (
                    <a
                      key={item.key}
                      href={item.href}
                      className="nav__drawer-link"
                      onClick={close}
                      {...(item.external
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {tm(`${item.key}Title`)}
                    </a>
                  ))
                )}
              </div>
            </div>
          );
        })}

        {extraLinks.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="nav__drawer-link"
            onClick={close}
            {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {l.label}
          </a>
        ))}

        {actions}
      </div>
      </div>
    </>
  );
}
