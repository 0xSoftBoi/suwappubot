'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { FEATURES } from '@/data/featuresData';
import { stagger, staggerChild, viewportOnce } from '@/lib/animations';

export default function Features() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, viewportOnce);

  return (
    <section id="features" className="py-28 px-6 relative">
      <div className="absolute inset-0" />
      <div className="relative max-w-5xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p variants={staggerChild} className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
            Features
          </motion.p>
          <motion.h2 variants={staggerChild} className="font-heading font-bold text-3xl md:text-4xl text-center mb-16">
            What you get
          </motion.h2>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <motion.div
                key={f.title}
                variants={staggerChild}
                className="group glass-card rounded-2xl p-7 shadow-suwappu-card hover:shadow-suwappu-card-hover transition-all duration-300 hover:-translate-y-1"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white mb-5 shadow-sm group-hover:scale-105 transition-transform duration-200`}>
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={f.iconPath} />
                  </svg>
                </div>
                <h3 className="font-heading font-semibold text-lg mb-2 text-suwappu-dark-text">{f.title}</h3>
                <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed mb-4">{f.description}</p>
                <span className="inline-block text-xs font-heading font-bold text-suwappu-purple bg-suwappu-purple/15 px-3 py-1 rounded-full">
                  {f.stat}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
