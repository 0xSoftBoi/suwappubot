'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useScrollContext } from './HorizontalScroll';

const NUM_PANELS = 4;

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [activePanel, setActivePanel] = useState(0);
  const { progressRef } = useScrollContext();
  const rafRef = useRef<number>(0);

  // Track vertical scroll for background change
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // RAF loop to read progressRef and determine active dot
  const updateActivePanel = useCallback(() => {
    const progress = progressRef.current ?? 0;
    const panel = Math.min(
      NUM_PANELS - 1,
      Math.floor(progress * NUM_PANELS)
    );
    setActivePanel(panel);
    rafRef.current = requestAnimationFrame(updateActivePanel);
  }, [progressRef]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(updateActivePanel);
    return () => cancelAnimationFrame(rafRef.current);
  }, [updateActivePanel]);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-[#07070e]/80 backdrop-blur-xl border-b border-white/[0.04]'
          : 'bg-transparent'
      }`}
      aria-label="Main navigation"
    >
      <div className="max-w-none mx-auto px-6 lg:px-10 py-4 flex items-center justify-between">
        {/* Logo */}
        <a
          href="#hero"
          className="font-display font-bold text-lg text-noir-text hover:text-white transition-colors"
        >
          Suwappu
        </a>

        {/* Center: Panel indicator dots (hidden on mobile) */}
        <div className="hidden md:flex items-center gap-2.5">
          {Array.from({ length: NUM_PANELS }).map((_, i) => (
            <span
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                activePanel === i
                  ? 'bg-[#ff2d78] scale-125'
                  : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Right: Links + CTA */}
        <div className="flex items-center gap-6">
          {/* Text links (hidden on mobile) */}
          <a
            href="#sdk"
            className="hidden md:inline text-sm text-[#8a8a9c] hover:text-[#e8e6e3] transition-colors"
          >
            SDK
          </a>
          <a
            href="#how-it-works"
            className="hidden md:inline text-sm text-[#8a8a9c] hover:text-[#e8e6e3] transition-colors"
          >
            How it works
          </a>

          {/* Pill CTA */}
          <a
            href="https://t.me/suwappu_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[#ff2d78] text-white rounded-full px-5 py-2 text-sm font-medium hover:bg-[#ff2d78]/90 transition-colors"
          >
            Open @suwappu_bot
          </a>
        </div>
      </div>
    </nav>
  );
}
