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
        <a href="/products"><strong>Explore</strong></a>
        <a href="/dashboard/signals">Signals <span aria-hidden="true">↗</span></a>
        <a href="/research">Research</a>
        <a href="/pricing">{nav('pricing')}</a>
        <a href="/docs">{nav('docs')}</a>
        <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer">{hero('telegramNav')}</a>
      </nav>

      <div className="summer-nav__actions">
        <a
          className="summer-nav__cta"
          href={TERMINAL_URL}
          onClick={() => track('cta_clicked', { surface: 'homepage_nav', destination: 'terminal' })}
        >
          {hero('ctaTerminal')}
        </a>
        <a
          className="summer-nav__cta summer-nav__cta--ghost"
          href="/products"
          onClick={() => track('cta_clicked', { surface: 'homepage_nav', destination: 'products' })}
        >
          Explore all
        </a>

        {/* Below 980px the link row is hidden; this is the only way in. */}
        <NavDrawer
          className="summer-nav__burger"
          extraLinks={[
            { href: '/products', label: 'Explore all products' },
            { href: '/dashboard/signals', label: 'Signal Intelligence' },
            { href: '/research', label: 'Research' },
            { href: '/pricing', label: nav('pricing') },
            { href: '/docs', label: nav('docs') },
            { href: TELEGRAM_URL, label: hero('telegramNav'), external: true },
          ]}
          actions={
            <>
              <a
                href={TERMINAL_URL}
                className="nav__drawer-cta"
              >
                {hero('ctaTerminal')}
              </a>
              <a
                href="/products"
                className="nav__drawer-cta nav__drawer-cta--ghost"
              >
                Explore all
              </a>
            </>
          }
        />
      </div>
    </header>
  );
}
