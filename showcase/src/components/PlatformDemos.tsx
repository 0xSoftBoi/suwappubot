'use client';

import { useRef, useState } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';
import { PLATFORMS } from '@/data/platformsData';
import { stagger, staggerChild, viewportOnce } from '@/lib/animations';

function VideoPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const toggle = () => {
    if (!ref.current) return;
    playing ? ref.current.pause() : ref.current.play();
    setPlaying(!playing);
  };

  return (
    <div className="video-container relative group cursor-pointer" onClick={toggle}>
      <video ref={ref} src={src} className="w-full aspect-[9/19.5] object-cover bg-suwappu-ocean" onLoadedData={() => setLoaded(true)} playsInline muted />
      {!loaded && (
        <div className="absolute inset-0 bg-suwappu-ocean flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
        </div>
      )}
      {!playing && loaded && (
        <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
            <svg className="w-5 h-5 text-suwappu-purple ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlatformDemos() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, viewportOnce);
  const [active, setActive] = useState(0);
  const plat = PLATFORMS[active];

  return (
    <section id="demos" className="py-28 px-6 relative">
      <div className="absolute inset-0" />
      <div className="relative max-w-5xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p variants={staggerChild} className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">Demos</motion.p>
          <motion.h2 variants={staggerChild} className="font-heading font-bold text-3xl md:text-4xl text-center mb-4">Pick your interface</motion.h2>
          <motion.p variants={staggerChild} className="text-center text-suwappu-dark-text-secondary text-sm mb-12">Same wallet and funds everywhere.</motion.p>

          <motion.div variants={staggerChild} className="flex flex-wrap justify-center gap-2 mb-14" role="tablist">
            {PLATFORMS.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setActive(i)}
                role="tab"
                aria-selected={i === active}
                className={`px-5 py-2.5 rounded-suwappu-pill font-heading font-medium text-sm transition-all duration-200 ${
                  i === active
                    ? 'bg-suwappu-gradient text-white shadow-suwappu-button'
                    : 'bg-suwappu-dark-surface text-suwappu-dark-text-secondary hover:text-suwappu-dark-text border border-white/5 shadow-sm hover:shadow-md'
                }`}
              >
                {p.name}
              </button>
            ))}
          </motion.div>

          <motion.div variants={staggerChild}>
            <div className="grid md:grid-cols-2 gap-10 items-center">
              <div className="max-w-[280px] mx-auto">
                <div className="phone-frame">
                  <div className="phone-screen">
                    <AnimatePresence mode="wait">
                      <motion.div key={plat.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
                        <VideoPlayer src={plat.video} />
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              </div>
              <div>
                <AnimatePresence mode="wait">
                  <motion.div key={plat.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.3 }}>
                    <h3 className="font-heading font-bold text-2xl mb-2">{plat.name}</h3>
                    <p className="text-suwappu-dark-text-secondary mb-6 text-sm">{plat.description}</p>
                    <ul className="space-y-3">
                      {plat.features.map((f) => (
                        <li key={f} className="flex items-center gap-3 text-sm">
                          <span className="w-5 h-5 rounded-full bg-suwappu-magenta/10 flex items-center justify-center shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-suwappu-magenta" />
                          </span>
                          {f}
                        </li>
                      ))}
                    </ul>
                    {plat.id === 'telegram-bot' && (
                      <a href="https://t.me/suwappu_bot" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 mt-8 text-sm font-heading font-semibold text-suwappu-magenta hover:text-suwappu-purple transition-colors">
                        Try it now
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                      </a>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
