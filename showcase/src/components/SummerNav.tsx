'use client';

import { useTranslations } from 'next-intl';
import { TELEGRAM_URL, TERMINAL_URL } from '@/lib/links';
import { track } from '@/lib/analytics';
import ProductMenu from './ProductMenu';
import NavDrawer from './NavDrawer';

/**
 * SummerNav: the homepage header.
 *
 * Product discovery is intentionally explicit here. Important product surfaces
 * must be reachable from the first screen of suwappu.bot rather than living as
 * hidden routes inside account or research pages.
 */
export default function SummerNav() {
  const nav = useTranslations('nav');
  const hero = useTranslations('home.hero');

  return (
    <header className="summer-nav">
      <a className="summer-brand" href="/">
        <img src="/logo.svg" alt="" aria-hidden="true" />
        <span>suwappu</span>
      </a>

      <nav aria-label="Primary navigation" className="summer-nav__menu">
        <ProductMenu triggerClassName="summer-nav__trigger" />
        <a href="/pricing">{nav('pricing')}</a>
        <a href="/docs">{nav('docs')}</a>
      </nav>

      <div className="summer-nav__actions">
        <a
          className="summer-nav__cta"
          href={TERMINAL_URL}
          onClick={() => track('cta_clicked', { surface: 'homepage_nav', destination: 'terminal' })}
        >
          {hero('ctaTerminal')}
        </a>

        {/* Below 980px the link row is hidden; this is the only way in. */}
        <NavDrawer
          className="summer-nav__burger"
          extraLinks={[
            { href: '/pricing', label: nav('pricing') },
            { href: '/docs', label: nav('docs') },
          ]}
          actions={
            <a
              href={TERMINAL_URL}
              className="nav__drawer-cta"
            >
              {hero('ctaTerminal')}
            </a>
          }
        />
      </div>
    </header>
  );
}
