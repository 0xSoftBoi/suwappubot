'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TELEGRAM_URL, WHATSAPP_URL, WHATSAPP_ENABLED, ENTERPRISE_CONTACT_PATH } from '@/lib/links';
import { MENU_PANELS } from './NavMenuData';
import ProductMenu from './ProductMenu';
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
  const tm = useTranslations('nav.menu');
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  /** Which accordion section is open in the mobile drawer. */
  const [openDrawerPanel, setOpenDrawerPanel] = useState<string | null>(null);
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

  // Lock body scroll when the mobile drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  // Escape closes whichever layer is open.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Any route change closes every menu layer.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
    <nav
      className={`nav ${scrolled ? 'nav--scrolled' : ''}`}
      role="navigation"
      aria-label="Main navigation"
    >
      <a href="/" className="nav__logo">suwappu</a>

      {/* Desktop links */}
      <div className="nav__links">
        <ProductMenu triggerClassName="nav__link" isActive={(href) => linkState(href).active} />

        {navLink('/pricing', t('pricing'))}
        <LanguageSwitcher current={locale} />
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
        <div className="nav__drawer-lang">
          <LanguageSwitcher current={locale} />
        </div>

        {/* Same directory as desktop, collapsed into accordions. */}
        {MENU_PANELS.map((panel) => {
          const open = openDrawerPanel === panel.id;
          return (
            <div key={panel.id} className="nav__drawer-section">
              <button
                type="button"
                className={`nav__drawer-toggle${open ? ' nav__drawer-toggle--open' : ''}`}
                aria-expanded={open}
                aria-controls={`drawer-panel-${panel.id}`}
                onClick={() => setOpenDrawerPanel(open ? null : panel.id)}
              >
                {tm(panel.key)}
                <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                  <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div id={`drawer-panel-${panel.id}`} hidden={!open}>
                {panel.groups.flatMap((group) =>
                  group.items.map((item) =>
                    drawerLink(item.href, tm(`${item.key}Title`), item.external)
                  )
                )}
              </div>
            </div>
          );
        })}

        {drawerLink('/pricing', t('pricing'))}

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
