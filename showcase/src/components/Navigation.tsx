'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { TELEGRAM_URL, WHATSAPP_URL, WHATSAPP_ENABLED } from '@/lib/links';
import LanguageSwitcher from './LanguageSwitcher';

/** Read current locale from cookie (set by LanguageSwitcher) or localStorage fallback. */
function getCurrentLocale(): string {
  try {
    // localStorage mirror is the fastest read — no cookie parse needed.
    const ls = localStorage.getItem('NEXT_LOCALE');
    if (ls) return ls;
  } catch {}
  // Parse document.cookie as fallback.
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  return match?.[1] ?? 'en';
}

export default function Navigation() {
  const t = useTranslations('nav');
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [locale, setLocale] = useState<string>(() =>
    typeof window === 'undefined' ? 'en' : getCurrentLocale()
  );

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  // Close on Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <nav className={`nav ${scrolled ? 'nav--scrolled' : ''}`} role="navigation" aria-label="Main navigation">
      <a href="/" className="nav__logo">suwappu</a>

      {/* Desktop links */}
      <div className="nav__links">
        <a href="/#hyperliquid" className="nav__link">{t('hyperliquid')}</a>
        <a href="/#tempo" className="nav__link">{t('tempo')}</a>
        <a href="/agents" className="nav__link">{t('forAgents')}</a>
        <a href="/solutions" className="nav__link">{t('solutions')}</a>
        <a href="/compare" className="nav__link">{t('compare')}</a>
        <a href="/pricing" className="nav__link">{t('pricing')}</a>
        <a href="/docs" className="nav__link">{t('docs')}</a>
        <a href="https://github.com/0xSoftBoi/suwappubot" target="_blank" rel="noopener noreferrer" className="nav__link">GitHub</a>
        <LanguageSwitcher current={locale} />
        <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="nav__cta">
          {t('openBot')}
        </a>
        {WHATSAPP_ENABLED && (
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="nav__cta nav__cta--whatsapp">
            {t('whatsapp')}
          </a>
        )}
      </div>

      {/* Mobile hamburger */}
      <button
        className="nav__hamburger"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-expanded={menuOpen}
        aria-controls="mobile-menu"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
      >
        <span className={`nav__hamburger-line ${menuOpen ? 'nav__hamburger-line--open' : ''}`} />
        <span className={`nav__hamburger-line ${menuOpen ? 'nav__hamburger-line--open' : ''}`} />
        <span className={`nav__hamburger-line ${menuOpen ? 'nav__hamburger-line--open' : ''}`} />
      </button>

      {/* Mobile drawer */}
      {menuOpen && <div className="nav__backdrop" onClick={closeMenu} aria-hidden="true" />}
      <div
        id="mobile-menu"
        className={`nav__drawer ${menuOpen ? 'nav__drawer--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div style={{ padding: '12px 20px 4px' }}>
          <LanguageSwitcher current={locale} />
        </div>
        <a href="/#hyperliquid" className="nav__drawer-link" onClick={closeMenu}>{t('hyperliquid')}</a>
        <a href="/#tempo" className="nav__drawer-link" onClick={closeMenu}>{t('tempo')}</a>
        <a href="/agents" className="nav__drawer-link" onClick={closeMenu}>{t('forAgents')}</a>
        <a href="/solutions" className="nav__drawer-link" onClick={closeMenu}>{t('solutions')}</a>
        <a href="/compare" className="nav__drawer-link" onClick={closeMenu}>{t('compare')}</a>
        <a href="/pricing" className="nav__drawer-link" onClick={closeMenu}>{t('pricing')}</a>
        <a href="/docs" className="nav__drawer-link" onClick={closeMenu}>{t('docs')}</a>
        <a href="/status" className="nav__drawer-link" onClick={closeMenu}>{t('status')}</a>
        <a href="https://github.com/0xSoftBoi/suwappubot" target="_blank" rel="noopener noreferrer" className="nav__drawer-link" onClick={closeMenu}>GitHub</a>
        <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="nav__drawer-cta" onClick={closeMenu}>
          {t('openBot')}
        </a>
        {WHATSAPP_ENABLED && (
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="nav__drawer-cta nav__drawer-cta--whatsapp" onClick={closeMenu}>
            {t('whatsapp')}
          </a>
        )}
      </div>
    </nav>
  );
}
