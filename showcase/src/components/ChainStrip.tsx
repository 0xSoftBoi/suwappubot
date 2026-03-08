'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { CHAINS } from '@/data/chainsData';

function MarqueeRow({ reverse = false }: { reverse?: boolean }) {
  const items = [...CHAINS, ...CHAINS, ...CHAINS, ...CHAINS];
  return (
    <div className="overflow-hidden">
      <div className={`flex shrink-0 items-center gap-6 ${reverse ? 'animate-marquee-reverse' : 'animate-marquee'}`}>
        {items.map((item, i) => (
          <div
            key={`${item.name}-${i}`}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/5 whitespace-nowrap shadow-sm"
          >
            <span className="w-2 h-2 rounded-full bg-suwappu-gradient shrink-0" />
            <span className="font-heading font-medium text-sm text-suwappu-dark-text-secondary">{item.name}</span>
            {item.type === 'partner' && (
              <span className="text-[9px] font-semibold text-suwappu-magenta bg-suwappu-magenta/10 border border-suwappu-magenta/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                Partner
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChainStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0 }}
      animate={inView ? { opacity: 1 } : {}}
      transition={{ duration: 0.8 }}
      className="py-12 space-y-3"
      aria-label="Supported chains and partners"
    >
      <p className="text-center text-xs font-heading font-semibold text-suwappu-dark-text-muted uppercase tracking-[0.15em] mb-6">
        Routing across
      </p>
      <MarqueeRow />
      <MarqueeRow reverse />
    </motion.section>
  );
}
