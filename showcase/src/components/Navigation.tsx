'use client';

import { useState, useEffect, useCallback } from 'react';
import gsap from 'gsap';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollToPlugin, ScrollTrigger);

const NAV_LINKS = [
  { label: 'How It Works', panel: 1 },
  { label: 'Features', panel: 2 },
  { label: 'Demos', panel: 3 },
];

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  // Track scroll progress for the progress bar
  useEffect(() => {
    const updateProgress = () => {
      const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollHeight > 0) {
        setProgress(window.scrollY / scrollHeight);
      }
    };
    window.addEventListener('scroll', updateProgress, { passive: true });
    return () => window.removeEventListener('scroll', updateProgress);
  }, []);

  const scrollToPanel = useCallback((panelIndex: number) => {
    const panels = document.querySelectorAll('.gsap-panel');
    if (panels[panelIndex]) {
      // Calculate where to scroll based on horizontal scroll setup
      const container = panels[0]?.parentElement?.parentElement;
      if (!container) return;

      const st = ScrollTrigger.getAll().find(t => t.vars.trigger === container);
      if (st) {
        // Horizontal scroll mode: calculate scroll position
        const totalPanels = panels.length;
        const scrollRange = st.end - st.start;
        const targetScroll = st.start + (panelIndex / (totalPanels - 1)) * scrollRange;
        gsap.to(window, { scrollTo: targetScroll, duration: 1, ease: 'power2.inOut' });
      } else {
        // Mobile / vertical fallback: scroll to element
        panels[panelIndex].scrollIntoView({ behavior: 'smooth' });
      }
    }
    setMobileOpen(false);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'glass shadow-md py-3' : 'py-5 bg-transparent'
      }`}
      aria-label="Main navigation"
    >
      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 h-[2px] bg-gradient-to-r from-suwappu-magenta to-suwappu-purple transition-all duration-150" style={{ width: `${progress * 100}%` }} />

      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
        <button
          onClick={() => scrollToPanel(0)}
          className="font-heading font-bold text-xl gradient-text"
        >
          Suwappu
        </button>

        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <button
              key={l.label}
              onClick={() => scrollToPanel(l.panel)}
              className="nav-link font-heading text-sm font-medium text-suwappu-dark-text-secondary hover:text-suwappu-magenta transition-colors"
            >
              {l.label}
            </button>
          ))}
          <a
            href="https://t.me/suwappu_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-suwappu bg-suwappu-gradient text-white font-heading font-medium text-sm px-5 py-2 rounded-suwappu-pill shadow-suwappu-button hover:shadow-suwappu-button-hover"
          >
            Open in Telegram
          </a>
        </div>

        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="md:hidden p-2 -mr-2"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
          </svg>
        </button>
      </div>

      {/* Mobile menu — CSS transition instead of AnimatePresence */}
      <div
        className={`md:hidden overflow-hidden transition-all duration-300 ${
          mobileOpen ? 'max-h-80 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="glass mx-4 mt-2 rounded-2xl p-6 space-y-3">
          {NAV_LINKS.map((l) => (
            <button
              key={l.label}
              onClick={() => scrollToPanel(l.panel)}
              className="block w-full text-left font-heading text-base font-medium py-2 text-suwappu-dark-text hover:text-suwappu-magenta transition-colors"
            >
              {l.label}
            </button>
          ))}
          <a
            href="https://t.me/suwappu_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center btn-suwappu bg-suwappu-gradient text-white font-heading font-medium px-5 py-3 rounded-suwappu-pill mt-4"
          >
            Open in Telegram
          </a>
        </div>
      </div>
    </nav>
  );
}
