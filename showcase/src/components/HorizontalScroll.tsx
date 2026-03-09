'use client';

import { createContext, useContext, useRef, useEffect, useState, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type ScrollContextValue = {
  scrollTween: gsap.core.Tween | null;
  progressRef: React.MutableRefObject<number>;
  panelCount: number;
};

const ScrollContext = createContext<ScrollContextValue>({
  scrollTween: null,
  progressRef: { current: 0 },
  panelCount: 0,
});

export const useScrollContext = () => useContext(ScrollContext);

interface HorizontalScrollProps {
  children: ReactNode;
}

export default function HorizontalScroll({ children }: HorizontalScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelsContainerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const [scrollTween, setScrollTween] = useState<gsap.core.Tween | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useGSAP(() => {
    if (isMobile || !panelsContainerRef.current || !containerRef.current) return;

    const panels = gsap.utils.toArray<HTMLElement>('.gsap-panel');
    if (panels.length === 0) return;

    // Main horizontal scroll tween
    const tween = gsap.to(panelsContainerRef.current, {
      x: () => -(panelsContainerRef.current!.scrollWidth - window.innerWidth),
      ease: 'none',
      scrollTrigger: {
        trigger: containerRef.current,
        pin: true,
        scrub: 0.8,
        snap: {
          snapTo: 1 / (panels.length - 1),
          duration: { min: 0.15, max: 0.4 },
          ease: 'power2.inOut',
        },
        end: () => '+=' + (panelsContainerRef.current!.scrollWidth - window.innerWidth),
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          progressRef.current = self.progress;
        },
      },
    });

    setScrollTween(tween);

    // Prefetch reduced-motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      ScrollTrigger.getAll().forEach(t => t.kill());
    }

    return () => {
      ScrollTrigger.getAll().forEach(t => t.kill());
    };
  }, { scope: containerRef, dependencies: [isMobile] });

  const panelCount = Array.isArray(children) ? children.length : 1;

  // Mobile: vertical fallback
  if (isMobile) {
    return (
      <ScrollContext.Provider value={{ scrollTween: null, progressRef, panelCount }}>
        <div className="flex flex-col">{children}</div>
      </ScrollContext.Provider>
    );
  }

  return (
    <ScrollContext.Provider value={{ scrollTween, progressRef, panelCount }}>
      <div ref={containerRef} className="relative overflow-hidden">
        <div ref={panelsContainerRef} className="flex h-screen w-max">
          {children}
        </div>
      </div>
    </ScrollContext.Provider>
  );
}
