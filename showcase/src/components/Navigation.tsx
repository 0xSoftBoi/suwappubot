'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TELEGRAM_URL, WHATSAPP_URL, WHATSAPP_ENABLED, ENTERPRISE_CONTACT_PATH } from '@/lib/links';
import LanguageSwitcher from './LanguageSwitcher';

/** Homepage section anchors the nav scroll-spies. Document order is resolved at runtime. */
const SECTION_IDS = ['engine', 'agents', 'api', 'hyperliquid', 'tempo', 'mobile-app', 'bot'];

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

  // Whether this browser already has a dashboard session. The nav previously
  // had NO sign-in entry at all — /dashboard was reachable only by typing the
  // URL, so an existing paying customer had no route back to their usage,
  // API keys or billing from the site they landed on.
  //
  // Read in an effect rather than during render: localStorage does not exist
  // on the server, and branching on it during render would desync hydration.
  const [hasSession, setHasSession] = useState(false);
  useEffect(() => {
    try {
      setHasSession(Boolean(localStorage.getItem('suwappu_dashboard_token')));
    } catch {
      // Private mode / storage disabled — fall back to the signed-out label.
    }
  }, []);
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [locale, setLocale] = useState<string>(() =>
    typeof window === 'undefined' ? 'en' : getCurrentLocale()
  );

  useEffect(() => {
    // 8px is enough to commit to the hairline — any more reads as lag.
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Scroll-spy the homepage section anchors so the nav reflects where you are.
  const visibleSections = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (pathname !== '/') {
      setActiveSection(null);
      return;
    }
    const nodes = SECTION_IDS.map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null)
      .sort((a, b) => a.offsetTop - b.offsetTop);
    if (nodes.length === 0) return;

    const order = nodes.map((n) => n.id);
    const seen = visibleSections.current;
    seen.clear();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) seen.add(entry.target.id);
          else seen.delete(entry.target.id);
        }
        setActiveSection(order.find((id) => seen.has(id)) ?? null);
      },
      // Middle band of the viewport — exactly one section owns the nav at a time.
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
    );
    nodes.forEach((n) => observer.observe(n));
    return () => {
      observer.disconnect();
      seen.clear();
    };
  }, [pathname]);

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

  /** Route matches get aria-current="page"; scroll-spied sections get "location". */
  const linkState = (href: string): { active: boolean; current?: 'page' | 'location' } => {
    if (href.startsWith('/#')) {
      const active = pathname === '/' && activeSection === href.slice(2);
      return active ? { active, current: 'location' } : { active };
    }
    if (href.startsWith('http')) return { active: false };
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return active ? { active, current: 'page' } : { active };
  };

  const navLink = (href: string, label: string, external = false) => {
    const { active, current } = linkState(href);
    return (
      <a
        key={href}
        href={href}
        className={`nav__link${active ? ' nav__link--active' : ''}`}
        aria-current={current}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {label}
      </a>
    );
  };

  const drawerLink = (href: string, label: string, external = false) => {
    const { active, current } = linkState(href);
    return (
      <a
        key={href}
        href={href}
        className={`nav__drawer-link${active ? ' nav__drawer-link--active' : ''}`}
        aria-current={current}
        onClick={closeMenu}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {label}
      </a>
    );
  };

  return (
    <nav className={`nav ${scrolled ? 'nav--scrolled' : ''}`} role="navigation" aria-label="Main navigation">
      <a href="/" className="nav__logo">suwappu</a>

      {/* Desktop links */}
      <div className="nav__links">
        {navLink('/#hyperliquid', t('hyperliquid'))}
        {navLink('/#tempo', t('tempo'))}
        {navLink('/agents', t('forAgents'))}
        {navLink('/solutions', t('solutions'))}
        {navLink('/compare', t('compare'))}
        {navLink('/pricing', t('pricing'))}
        {navLink('/docs', t('docs'))}
        {navLink('https://github.com/0xSoftBoi/suwappubot', 'GitHub', true)}
        <LanguageSwitcher current={locale} />
        {/* Account entry. Deliberately a nav link rather than a third CTA:
            "Open Bot" is an acquisition action, and an existing customer
            looking for their billing should not have to parse two buttons
            that both look like signup. */}
        <a href="/dashboard" className="nav__link nav__link--account">
          {hasSession ? t('dashboard') : t('signIn')}
        </a>
        {/* Two CTAs only: ghost sales + persimmon primary. */}
        <a href={ENTERPRISE_CONTACT_PATH} className="nav__cta nav__cta--ghost">
          {t('talkToSales')}
        </a>
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
        {drawerLink('/#hyperliquid', t('hyperliquid'))}
        {drawerLink('/#tempo', t('tempo'))}
        {drawerLink('/agents', t('forAgents'))}
        {drawerLink('/solutions', t('solutions'))}
        {drawerLink('/compare', t('compare'))}
        {drawerLink('/pricing', t('pricing'))}
        {drawerLink('/docs', t('docs'))}
        {drawerLink('/status', t('status'))}
        {drawerLink('https://github.com/0xSoftBoi/suwappubot', 'GitHub', true)}
        <a href="/dashboard" className="nav__drawer-cta nav__drawer-cta--ghost" onClick={closeMenu}>
          {hasSession ? t('dashboard') : t('signIn')}
        </a>
        <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="nav__drawer-cta" onClick={closeMenu}>
          {t('openBot')}
        </a>
        <a href={ENTERPRISE_CONTACT_PATH} className="nav__drawer-cta nav__drawer-cta--ghost" onClick={closeMenu}>
          {t('talkToSales')}
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
