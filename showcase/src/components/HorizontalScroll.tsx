'use client';

import { useRef, useEffect, useState, createContext, useContext } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

interface ScrollContextValue {
  scrollTween: gsap.core.Tween | null;
  /** 0–1 normalized scroll progress through the horizontal section */
  progressRef: React.RefObject<number>;
}

const ScrollContext = createContext<ScrollContextValue>({
  scrollTween: null,
  progressRef: { current: 0 },
});
export const useScrollContext = () => useContext(ScrollContext);

interface HorizontalScrollProps {
  children: React.ReactNode;
}

export default function HorizontalScroll({ children }: HorizontalScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const panelsRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<number>(0);
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
        scrub: 1,
        end: () => `+=${panelsRef.current!.scrollWidth - window.innerWidth}`,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          progressRef.current = self.progress;
        },
      },
    });

    setScrollTween(tween);

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
      <ScrollContext.Provider value={{ scrollTween: null, progressRef }}>
        <div className="flex flex-col">
          {children}
        </div>
      </ScrollContext.Provider>
    );
  }

  return (
    <ScrollContext.Provider value={{ scrollTween, progressRef }}>
      <div ref={containerRef} className="overflow-hidden">
        <div ref={panelsRef} className="flex flex-nowrap">
          {children}
        </div>
      </div>
    </ScrollContext.Provider>
  );
}
