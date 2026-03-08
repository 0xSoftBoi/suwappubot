'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  stagger,
  staggerChild,
  fadeInUp,
  viewportOnce,
} from '@/lib/animations';

const TRUST_CARDS = [
  {
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: 'Turnkey Secure Enclaves',
    description:
      'Every wallet is backed by Trusted Execution Environment hardware. Private keys are generated and stored inside tamper-proof secure enclaves \u2014 never on our servers, never on your device.',
    badge: 'Powered by Turnkey',
  },
  {
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
      </svg>
    ),
    title: 'Your Keys, Always',
    description:
      'We never see, store, or have access to your private keys. Export your keys anytime. Full self-custody with hardware-grade protection.',
    badge: 'Self-Custody',
  },
  {
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Defense in Depth',
    description:
      'MEV protection via CoW Protocol and Jito bundles. 2FA authentication. Address whitelisting. Spending limits. Every swap requires your explicit confirmation.',
    badge: 'MEV Shielded',
  },
];

export default function TrustSecurity() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, viewportOnce);

  return (
    <section id="trust-security" className="py-28 px-6 relative bg-suwappu-dark-bg">
      <div className="max-w-6xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p
            variants={staggerChild}
            className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3"
          >
            Trust &amp; Security
          </motion.p>
          <motion.h2
            variants={staggerChild}
            className="font-heading font-bold text-3xl md:text-4xl text-center mb-4 text-suwappu-dark-text"
          >
            Hardware-Grade Security
          </motion.h2>
          <motion.p
            variants={staggerChild}
            className="text-center text-suwappu-dark-text-secondary mb-16 max-w-lg mx-auto"
          >
            Your keys live in tamper-proof hardware that even we cannot access.
          </motion.p>

          {/* Trust cards grid */}
          <div className="grid sm:grid-cols-1 lg:grid-cols-3 gap-5 mb-16">
            {TRUST_CARDS.map((card, i) => (
              <motion.div
                key={card.title}
                variants={fadeInUp}
                custom={i}
                className="group glass-card rounded-2xl p-7 shadow-suwappu-card-dark border border-transparent hover:border-suwappu-magenta/20 hover:shadow-suwappu-glow-magenta transition-all duration-300"
              >
                <div className="w-13 h-13 w-[52px] h-[52px] rounded-xl bg-gradient-to-br from-suwappu-magenta/20 to-suwappu-purple/20 flex items-center justify-center text-suwappu-magenta mb-5 group-hover:from-suwappu-magenta/30 group-hover:to-suwappu-purple/30 transition-all duration-300">
                  {card.icon}
                </div>
                <h3 className="font-heading font-semibold text-lg text-suwappu-dark-text mb-2">
                  {card.title}
                </h3>
                <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed mb-4">
                  {card.description}
                </p>
                <span className="inline-block text-xs font-heading font-bold text-suwappu-purple-light bg-suwappu-purple/10 px-3 py-1 rounded-full">
                  {card.badge}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Transaction confirmation visual */}
          <motion.div variants={staggerChild} className="max-w-md mx-auto">
            <div className="glass-card rounded-2xl p-6 shadow-suwappu-card-dark border border-suwappu-magenta/10">
              {/* Chat bubble style confirmation */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-lg">&#x1f512;</span>
                  <span className="font-heading font-bold text-suwappu-dark-text">Confirm Swap</span>
                </div>

                <div className="space-y-1.5 text-sm font-mono">
                  <p className="text-suwappu-dark-text">
                    1 ETH <span className="text-suwappu-dark-text-muted">&rarr;</span> 2,847.32 USDC
                  </p>
                  <p className="text-suwappu-dark-text-secondary">
                    Route: Li.Fi &rarr; Arbitrum
                  </p>
                  <p className="text-suwappu-dark-text-secondary">
                    Fee: 0.3% ($8.54)
                  </p>
                  <p className="text-suwappu-dark-text-secondary">
                    Gas: ~$0.12
                  </p>
                </div>

                <div className="flex gap-3 pt-3">
                  <button className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-suwappu-gradient text-white font-heading font-semibold text-sm shadow-suwappu-button cursor-default">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Confirm
                  </button>
                  <button className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/[0.05] text-suwappu-dark-text-secondary font-heading font-semibold text-sm border border-white/[0.06] cursor-default">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Cancel
                  </button>
                </div>
              </div>
            </div>

            <p className="text-center text-suwappu-dark-text-secondary text-sm mt-4">
              You approve every transaction. Nothing executes without your explicit confirmation.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
