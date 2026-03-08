'use client';

import { useRef, useEffect, useState, createContext, useContext } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

interface ScrollContextValue {
  scrollTween: gsap.core.Tween | null;
}

const ScrollContext = createContext<ScrollContextValue>({ scrollTween: null });
export const useScrollContext = () => useContext(ScrollContext);

interface HorizontalScrollProps {
  children: React.ReactNode;
}

export default function HorizontalScroll({ children }: HorizontalScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  const [scrollTween, setScrollTween] = useState<gsap.core.Tween | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useGSAP(() => {
    if (isMobile || !panelsRef.current || !containerRef.current) return;

    const panels = gsap.utils.toArray<HTMLElement>('.gsap-panel', panelsRef.current);
    if (panels.length === 0) return;

    const tween = gsap.to(panels, {
      xPercent: -100 * (panels.length - 1),
      ease: 'none',
      scrollTrigger: {
        trigger: containerRef.current,
        pin: true,
        scrub: 2,
        snap: {
          snapTo: 1 / (panels.length - 1),
          duration: { min: 0.2, max: 0.6 },
          ease: 'power1.inOut',
        },
        end: () => `+=${panelsRef.current!.scrollWidth - window.innerWidth}`,
        invalidateOnRefresh: true,
      },
    });

    setScrollTween(tween);

    // Respect prefers-reduced-motion
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleMotion = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        tween.scrollTrigger?.kill();
        gsap.set(panels, { xPercent: 0 });
      }
    };
    handleMotion(mq);
    mq.addEventListener('change', handleMotion);

    return () => {
      mq.removeEventListener('change', handleMotion);
    };
  }, { scope: containerRef, dependencies: [isMobile] });

  if (isMobile) {
    return (
      <ScrollContext.Provider value={{ scrollTween: null }}>
        <div className="flex flex-col">
          {children}
        </div>
      </ScrollContext.Provider>
    );
  }

  return (
    <ScrollContext.Provider value={{ scrollTween }}>
      <div ref={containerRef} className="overflow-hidden">
        <div ref={panelsRef} className="flex flex-nowrap">
          {children}
        </div>
      </div>
    </ScrollContext.Provider>
  );
}
