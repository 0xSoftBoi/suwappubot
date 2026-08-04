'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { TELEGRAM_URL, WHATSAPP_URL, WHATSAPP_ENABLED } from '@/lib/links';
import LanguageSwitcher from './LanguageSwitcher';

const TERMINAL_URL = 'https://terminal.suwappu.bot';
const ROLE_STORAGE_KEY = 'suwappu_nav_role';

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

export type NavRole = 'trade' | 'build';

/**
 * Trade/Build audience toggle — local state persisted in localStorage,
 * not a route split (per the Phase 1 plan). Avoids useSearchParams so
 * this stays static-renderable without a Suspense boundary on every page.
 */
function useRole(): [NavRole, (role: NavRole) => void] {
  const [role, setRoleState] = useState<NavRole>('trade');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(ROLE_STORAGE_KEY);
      if (stored === 'build' || stored === 'trade') setRoleState(stored);
    } catch {}
  }, []);

  const setRole = useCallback((next: NavRole) => {
    setRoleState(next);
    try {
      localStorage.setItem(ROLE_STORAGE_KEY, next);
    } catch {}
  }, []);

  return [role, setRole];
}

export default function Navigation() {
  const t = useTranslations('nav');
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useRole();
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

  const isBuild = role === 'build';
  const primaryHref = isBuild ? '/docs' : TELEGRAM_URL;
  const primaryLabel = isBuild ? 'Read the docs' : t('openBot');
  const primaryExternal = !isBuild;

  // Role-ordered nav links — Trade surfaces product entry points first,
  // Build surfaces the developer surface first. Same set, reordered.
  const tradeLinks = [
    { href: '/#hyperliquid', label: t('hyperliquid') },
    { href: '/#tempo', label: t('tempo') },
    { href: '/pricing', label: t('pricing') },
    { href: '/compare', label: t('compare') },
    { href: '/agents', label: t('forAgents') },
    { href: '/docs', label: t('docs') },
  ];
  const buildLinks = [
    { href: '/agents', label: t('forAgents') },
    { href: '/docs', label: t('docs') },
    { href: '/pricing', label: t('pricing') },
    { href: '/solutions', label: t('solutions') },
    { href: '/#hyperliquid', label: t('hyperliquid') },
    { href: '/compare', label: t('compare') },
  ];
  const links = isBuild ? buildLinks : tradeLinks;

  return (
    <nav
      className={`sticky top-0 z-50 flex h-16 items-center gap-6 border-b px-6 backdrop-blur-md transition-colors md:h-[72px] ${
        scrolled
          ? 'border-white/10 bg-[var(--canvas-0)]/85'
          : 'border-transparent bg-[var(--canvas-0)]/40'
      }`}
      role="navigation"
      aria-label="Main navigation"
    >
      <a href="/" className="shrink-0 font-display text-lg font-medium tracking-tight text-[var(--ink-0)]">
        suwappu
      </a>

      {/* Trade / Build role toggle — relabels the primary CTA + reorders nav, no route change */}
      <div
        className="hidden shrink-0 items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5 md:flex"
        role="group"
        aria-label="View site for"
      >
        <button
          type="button"
          onClick={() => setRole('trade')}
          aria-pressed={!isBuild}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            !isBuild ? 'bg-[var(--accent)] text-[#1a1108]' : 'text-[var(--ink-1)] hover:text-[var(--ink-0)]'
          }`}
        >
          Trade
        </button>
        <button
          type="button"
          onClick={() => setRole('build')}
          aria-pressed={isBuild}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            isBuild ? 'bg-[var(--accent)] text-[#1a1108]' : 'text-[var(--ink-1)] hover:text-[var(--ink-0)]'
          }`}
        >
          Build
        </button>
      </div>

      {/* Desktop links */}
      <div className="hidden flex-1 items-center gap-5 md:flex">
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="text-sm text-[var(--ink-1)] transition-colors hover:text-[var(--ink-0)]"
          >
            {l.label}
          </a>
        ))}
        <a
          href="https://github.com/0xSoftBoi/suwappubot"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--ink-1)] transition-colors hover:text-[var(--ink-0)]"
        >
          GitHub
        </a>
      </div>

      <div className="ml-auto hidden shrink-0 items-center gap-3 md:flex">
        <LanguageSwitcher current={locale} />
        {!isBuild && (
          <a
            href={TERMINAL_URL}
            className="text-sm text-[var(--ink-1)] transition-colors hover:text-[var(--ink-0)]"
          >
            Open Terminal
          </a>
        )}
        <a
          href={primaryHref}
          target={primaryExternal ? '_blank' : undefined}
          rel={primaryExternal ? 'noopener noreferrer' : undefined}
          className="rounded-control bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[#1a1108] transition-colors hover:bg-[var(--accent-hover)] active:scale-[0.98]"
        >
          {primaryLabel}
        </a>
        {WHATSAPP_ENABLED && (
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-control border border-white/10 px-4 py-2 text-sm text-[var(--ink-0)] hover:bg-white/5"
          >
            {t('whatsapp')}
          </a>
        )}
      </div>

      {/* Mobile hamburger */}
      <button
        className="ml-auto flex flex-col gap-1.5 md:hidden"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-expanded={menuOpen}
        aria-controls="mobile-menu"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
      >
        <span
          className={`h-[1.5px] w-5 bg-[var(--ink-0)] transition-transform ${
            menuOpen ? 'translate-y-[6.5px] rotate-45' : ''
          }`}
        />
        <span className={`h-[1.5px] w-5 bg-[var(--ink-0)] transition-opacity ${menuOpen ? 'opacity-0' : ''}`} />
        <span
          className={`h-[1.5px] w-5 bg-[var(--ink-0)] transition-transform ${
            menuOpen ? '-translate-y-[6.5px] -rotate-45' : ''
          }`}
        />
      </button>

      {/* Mobile drawer */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={closeMenu}
          aria-hidden="true"
        />
      )}
      <div
        id="mobile-menu"
        className={`fixed inset-y-0 right-0 z-50 flex w-72 max-w-[85vw] flex-col gap-1 border-l border-white/10 bg-[var(--canvas-1)] p-6 transition-transform duration-300 md:hidden ${
          menuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
      >
        <div className="mb-4 flex gap-1 rounded-full border border-white/10 bg-white/5 p-0.5">
          <button
            type="button"
            onClick={() => setRole('trade')}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium ${
              !isBuild ? 'bg-[var(--accent)] text-[#1a1108]' : 'text-[var(--ink-1)]'
            }`}
          >
            Trade
          </button>
          <button
            type="button"
            onClick={() => setRole('build')}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-medium ${
              isBuild ? 'bg-[var(--accent)] text-[#1a1108]' : 'text-[var(--ink-1)]'
            }`}
          >
            Build
          </button>
        </div>
        <div className="mb-2">
          <LanguageSwitcher current={locale} />
        </div>
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            onClick={closeMenu}
            className="border-b border-white/5 py-3 text-sm text-[var(--ink-0)]"
          >
            {l.label}
          </a>
        ))}
        <a href="/status" onClick={closeMenu} className="border-b border-white/5 py-3 text-sm text-[var(--ink-0)]">
          {t('status')}
        </a>
        <a
          href="https://github.com/0xSoftBoi/suwappubot"
          target="_blank"
          rel="noopener noreferrer"
          onClick={closeMenu}
          className="border-b border-white/5 py-3 text-sm text-[var(--ink-0)]"
        >
          GitHub
        </a>
        <a
          href={primaryHref}
          target={primaryExternal ? '_blank' : undefined}
          rel={primaryExternal ? 'noopener noreferrer' : undefined}
          onClick={closeMenu}
          className="mt-4 rounded-control bg-[var(--accent)] px-4 py-3 text-center text-sm font-medium text-[#1a1108]"
        >
          {primaryLabel}
        </a>
      </div>
    </nav>
  );
}
