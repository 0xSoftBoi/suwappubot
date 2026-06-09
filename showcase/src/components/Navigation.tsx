'use client';

import { useState, useEffect, useCallback } from 'react';
import { TELEGRAM_URL, WHATSAPP_URL, WHATSAPP_ENABLED } from '@/lib/links';

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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
        <a href="#how-it-works" className="nav__link">How it works</a>
        <a href="#features" className="nav__link">Features</a>
        <a href="/docs" className="nav__link">Docs</a>
        <a href="https://github.com/0xSoftBoi/suwappubot" target="_blank" rel="noopener noreferrer" className="nav__link">GitHub</a>
        <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="nav__cta">
          Open Bot
        </a>
        {WHATSAPP_ENABLED && (
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="nav__cta nav__cta--whatsapp">
            WhatsApp
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
        <a href="#how-it-works" className="nav__drawer-link" onClick={closeMenu}>How it works</a>
        <a href="#features" className="nav__drawer-link" onClick={closeMenu}>Features</a>
        <a href="/docs" className="nav__drawer-link" onClick={closeMenu}>Docs</a>
        <a href="https://github.com/0xSoftBoi/suwappubot" target="_blank" rel="noopener noreferrer" className="nav__drawer-link" onClick={closeMenu}>GitHub</a>
        <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className="nav__drawer-cta" onClick={closeMenu}>
          Open Bot
        </a>
        {WHATSAPP_ENABLED && (
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="nav__drawer-cta nav__drawer-cta--whatsapp" onClick={closeMenu}>
            Chat on WhatsApp
          </a>
        )}
      </div>
    </nav>
  );
}
