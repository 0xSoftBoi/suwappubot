'use client';

import { TELEGRAM_URL, TERMINAL_URL } from '@/lib/links';
import ProductMenu from './ProductMenu';
import NavDrawer from './NavDrawer';

/**
 * SummerNav — the homepage header.
 *
 * Keeps the `.summer-nav` shell (sticky, in-flow, sits above the cosmic hero)
 * that the homepage layout is built around, but swaps the old flat row of eight
 * anchor links for the same grouped product directory the rest of the site
 * uses. See ProductMenu for why the two shells stay separate.
 */
export default function SummerNav() {
  return (
    <header className="summer-nav">
      <a className="summer-brand" href="/">
        <img src="/logo.svg" alt="" aria-hidden="true" />
        <span>suwappu</span>
      </a>

      <nav aria-label="Primary navigation" className="summer-nav__menu">
        <ProductMenu triggerClassName="summer-nav__trigger" />
        <a href="/pricing">Pricing</a>
        <a href="/docs">Docs</a>
      </nav>

      <div className="summer-nav__actions">
        <a className="summer-nav__cta summer-nav__cta--ghost" href={TERMINAL_URL}>
          Open Terminal
        </a>
        <a
          className="summer-nav__cta"
          href={TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Bot
        </a>

        {/* Below 980px the link row is hidden; this is the only way in. */}
        <NavDrawer
          className="summer-nav__burger"
          extraLinks={[
            { href: '/pricing', label: 'Pricing' },
            { href: '/docs', label: 'Docs' },
          ]}
          actions={
            <>
              <a
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="nav__drawer-cta"
              >
                Open Bot
              </a>
              <a href={TERMINAL_URL} className="nav__drawer-cta nav__drawer-cta--ghost">
                Open Terminal
              </a>
            </>
          }
        />
      </div>
    </header>
  );
}
