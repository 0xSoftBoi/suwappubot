'use client';

import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import {
  stagger,
  staggerChild,
  staggerContainerFast,
  fadeInLeft,
  fadeInRight,
  viewportOnce,
} from '@/lib/animations';

const BENEFITS = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
    title: 'No Extensions',
    description: 'No browser extensions, no wallet popups, no seed phrase screens',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
      </svg>
    ),
    title: 'Trade Anywhere',
    description: 'Works on Telegram, WhatsApp, Discord, and iOS. Same wallet, same funds',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
      </svg>
    ),
    title: 'Share Instantly',
    description: 'Send your referral link in any group chat. Your community IS your trading floor',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
      </svg>
    ),
    title: 'Notifications Where You Are',
    description: 'Price alerts and order fills arrive in the same app you already check 100x/day',
  },
];

const TRADITIONAL_STEPS = [
  'Open browser',
  'Install extension',
  'Connect wallet',
  'Approve token',
  'Set slippage',
  'Confirm transaction',
];

const SUWAPPU_STEPS = ['Type swap command', 'Tap confirm'];

export default function WhyChat() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, viewportOnce);

  return (
    <section id="why-chat" className="py-28 px-6 relative bg-suwappu-dark-bg">
      <div className="max-w-6xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p
            variants={staggerChild}
            className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3"
          >
            The Suwappu Advantage
          </motion.p>
          <motion.h2
            variants={staggerChild}
            className="font-heading font-bold text-3xl md:text-4xl text-center mb-16 text-suwappu-dark-text"
          >
            Why Chat?
          </motion.h2>

          <div className="grid lg:grid-cols-2 gap-16 items-start">
            {/* Left column — Benefits */}
            <motion.div variants={stagger} className="space-y-4">
              {BENEFITS.map((benefit, i) => (
                <motion.div
                  key={benefit.title}
                  variants={fadeInLeft}
                  custom={i}
                  className="glass-card rounded-2xl p-5 flex gap-4 items-start shadow-suwappu-card-dark hover:shadow-suwappu-card-dark-hover transition-all duration-300 hover:-translate-y-0.5"
                >
                  <div className="shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-suwappu-magenta to-suwappu-purple flex items-center justify-center text-white">
                    {benefit.icon}
                  </div>
                  <div>
                    <h3 className="font-heading font-semibold text-base text-suwappu-dark-text mb-1">
                      {benefit.title}
                    </h3>
                    <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed">
                      {benefit.description}
                    </p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            {/* Right column — Comparison visual */}
            <motion.div variants={fadeInRight} custom={0} className="space-y-6">
              {/* Traditional DEX flow */}
              <div>
                <p className="text-xs font-heading font-semibold text-suwappu-dark-text-muted uppercase tracking-[0.12em] mb-3">
                  Traditional DEX
                </p>
                <motion.div
                  variants={staggerContainerFast}
                  initial="hidden"
                  animate={inView ? 'visible' : 'hidden'}
                  className="space-y-2"
                >
                  {TRADITIONAL_STEPS.map((step, i) => (
                    <motion.div
                      key={step}
                      variants={staggerChild}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04]"
                    >
                      <span className="shrink-0 w-6 h-6 rounded-full bg-white/[0.06] text-suwappu-dark-text-muted flex items-center justify-center text-[11px] font-heading font-bold">
                        {i + 1}
                      </span>
                      <span className="text-sm text-suwappu-dark-text-muted">{step}</span>
                    </motion.div>
                  ))}
                </motion.div>
              </div>

              {/* Suwappu flow */}
              <div>
                <p className="text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.12em] mb-3">
                  Suwappu
                </p>
                <motion.div
                  variants={staggerContainerFast}
                  initial="hidden"
                  animate={inView ? 'visible' : 'hidden'}
                  className="space-y-2"
                >
                  {SUWAPPU_STEPS.map((step, i) => (
                    <motion.div
                      key={step}
                      variants={staggerChild}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-suwappu-magenta/20 bg-gradient-to-r from-suwappu-magenta/[0.08] to-suwappu-purple/[0.06] shadow-suwappu-glow-magenta"
                    >
                      <span className="shrink-0 w-6 h-6 rounded-full bg-suwappu-gradient text-white flex items-center justify-center text-[11px] font-heading font-bold">
                        {i + 1}
                      </span>
                      <span className="text-sm font-medium text-suwappu-dark-text">{step}</span>
                    </motion.div>
                  ))}
                </motion.div>
              </div>

              {/* Summary badge */}
              <div className="text-center pt-2">
                <span className="inline-block text-xs font-heading font-bold text-suwappu-magenta bg-suwappu-magenta/10 px-4 py-1.5 rounded-full">
                  6 steps vs 2 steps
                </span>
              </div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
