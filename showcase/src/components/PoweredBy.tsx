'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  stagger,
  staggerChild,
  staggerContainerFast,
  fadeInUp,
  viewportOnce,
} from '@/lib/animations';

const PROVIDERS = [
  {
    name: 'Li.Fi',
    category: 'Multi-chain Aggregator',
    brief: 'Routes across 30+ DEXes and bridges',
  },
  {
    name: 'Jupiter',
    category: 'Solana DEX Aggregator',
    brief: 'Best rates across all Solana liquidity',
  },
  {
    name: 'CoW Protocol',
    category: 'MEV-Protected Swaps',
    brief: 'Batch auctions shield you from frontrunning',
  },
  {
    name: 'Wormhole',
    category: 'Cross-chain Bridge',
    brief: 'Secure token transfers across chains',
  },
  {
    name: 'CCTP (Circle)',
    category: 'Native USDC Bridge',
    brief: 'Zero-slippage USDC transfers',
  },
  {
    name: 'Socket',
    category: 'Bridge Aggregator',
    brief: 'Optimal bridge routes across chains',
  },
  {
    name: 'Turnkey',
    category: 'Wallet Infrastructure',
    brief: 'TEE hardware-secured key management',
  },
  {
    name: '1inch',
    category: 'DEX Aggregator',
    brief: 'Pathfinder algorithm for best swap rates',
  },
  {
    name: 'Across',
    category: 'Intent-Based Bridge',
    brief: 'Fast, capital-efficient bridging',
  },
];

const STATS = [
  { value: '15', label: 'Chains Supported' },
  { value: '9', label: 'Swap Providers' },
  { value: '5', label: 'Platforms' },
];

export default function PoweredBy() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, viewportOnce);

  return (
    <section id="powered-by" className="py-28 px-6 relative bg-suwappu-dark-bg">
      <div className="max-w-6xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p
            variants={staggerChild}
            className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3"
          >
            Infrastructure
          </motion.p>
          <motion.h2
            variants={staggerChild}
            className="font-heading font-bold text-3xl md:text-4xl text-center mb-4 text-suwappu-dark-text"
          >
            Powered By the Best
          </motion.h2>
          <motion.p
            variants={staggerChild}
            className="text-center text-suwappu-dark-text-secondary mb-16 max-w-lg mx-auto"
          >
            We route through 9 leading swap providers to find you the best rate, every time.
          </motion.p>

          {/* Provider grid */}
          <motion.div
            variants={staggerContainerFast}
            initial="hidden"
            animate={inView ? 'visible' : 'hidden'}
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-20"
          >
            {PROVIDERS.map((provider, i) => (
              <motion.div
                key={provider.name}
                variants={staggerChild}
                className="group glass-card rounded-2xl p-5 shadow-suwappu-card-dark border border-transparent hover:border-white/[0.08] hover:shadow-suwappu-card-dark-hover transition-all duration-300 hover:-translate-y-0.5"
              >
                <h3 className="font-heading font-bold text-base text-suwappu-dark-text mb-1">
                  {provider.name}
                </h3>
                <p className="text-[11px] font-heading font-semibold text-suwappu-magenta/70 uppercase tracking-[0.08em] mb-2">
                  {provider.category}
                </p>
                <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed">
                  {provider.brief}
                </p>
              </motion.div>
            ))}
          </motion.div>

          {/* Bottom stat bar */}
          <motion.div
            variants={staggerChild}
            className="flex flex-col sm:flex-row items-center justify-center gap-12 sm:gap-20"
          >
            {STATS.map((stat, i) => (
              <motion.div key={stat.label} variants={fadeInUp} custom={i} className="text-center">
                <p className="font-heading font-bold text-5xl bg-gradient-to-r from-suwappu-magenta to-suwappu-purple bg-clip-text text-transparent mb-1">
                  {stat.value}
                </p>
                <p className="text-suwappu-dark-text-secondary text-sm font-heading font-medium">
                  {stat.label}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
