'use client';

import { useState, useEffect } from 'react';

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav className={`nav ${scrolled ? 'nav--scrolled' : ''}`}>
      <a href="/" className="nav__logo">suwappu</a>
      <div className="nav__links">
        <a href="#how-it-works" className="nav__link">How it works</a>
        <a href="#features" className="nav__link">Features</a>
        <a href="https://docs.suwappu.bot" target="_blank" rel="noopener noreferrer" className="nav__link">Docs</a>
        <a href="https://github.com/0xSoftBoi/suwappubot" target="_blank" rel="noopener noreferrer" className="nav__link">GitHub</a>
        <a href="https://t.me/suwappu_bot" target="_blank" rel="noopener noreferrer" className="nav__cta">
          Open Bot
        </a>
      </div>
    </nav>
  );
}
