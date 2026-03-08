'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const NAV_LINKS = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Demos', href: '#demos' },
  { label: 'Compare', href: '#compare' },
  { label: 'FAQ', href: '#faq' },
];

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'glass shadow-md py-3' : 'py-5 bg-transparent'
      }`}
      aria-label="Main navigation"
    >
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
        <a href="#" className="font-heading font-bold text-xl gradient-text">
          Suwappu
        </a>

        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              className="font-heading text-sm font-medium text-suwappu-dark-text-secondary hover:text-suwappu-magenta transition-colors"
            >
              {l.label}
            </a>
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

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden overflow-hidden glass mx-4 mt-2 rounded-2xl"
          >
            <div className="p-6 space-y-3">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  className="block font-heading text-base font-medium py-2 text-suwappu-dark-text hover:text-suwappu-magenta transition-colors"
                >
                  {l.label}
                </a>
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
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
