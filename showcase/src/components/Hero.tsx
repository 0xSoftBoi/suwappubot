'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, useMotionValue, useInView, animate, AnimatePresence } from 'framer-motion';
import {
  staggerContainerSlow,
  staggerChild,
  fadeInUp,
  EASE_OUT_EXPO,
} from '@/lib/animations';

// ---------------------------------------------------------------------------
// SwapCounter – social proof counter (preserved from original)
// ---------------------------------------------------------------------------

function SwapCounter() {
  const count = useMotionValue(0);
  const [display, setDisplay] = useState('0');
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (inView) {
      return animate(count, 247583, {
        duration: 2.5,
        ease: 'easeOut',
        onUpdate: (v) => setDisplay(Math.floor(v).toLocaleString()),
      }).stop;
    }
  }, [inView, count]);

  return (
    <div ref={ref} className="text-sm font-medium text-white/60">
      <span className="bg-gradient-to-r from-suwappu-magenta to-suwappu-purple bg-clip-text text-transparent font-bold text-base">
        {display}+
      </span>{' '}
      swaps executed
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat Demo types & data
// ---------------------------------------------------------------------------

type ChatMessage =
  | { type: 'user'; text: string }
  | { type: 'typing' }
  | { type: 'bot'; text: string }
  | { type: 'button'; text: string }
  | { type: 'success'; text: string };

const CHAT_SEQUENCE: { msg: ChatMessage; showAt: number }[] = [
  { msg: { type: 'user', text: 'Swap 1 ETH to USDC on Arbitrum' }, showAt: 500 },
  { msg: { type: 'typing' }, showAt: 1500 },
  {
    msg: {
      type: 'bot',
      text: '✅ Best route found via Li.Fi\n1 ETH → 2,847.32 USDC\nChain: Arbitrum\nFee: 0.3% | Gas: ~$0.12',
    },
    showAt: 2500,
  },
  { msg: { type: 'button', text: 'Confirm Swap' }, showAt: 3500 },
  { msg: { type: 'success', text: '🎉 Swap complete! +2,847.32 USDC' }, showAt: 5000 },
];

const LOOP_DELAY = 3000; // ms to wait after last message before resetting
const TOTAL_CYCLE = 5000 + LOOP_DELAY;

// ---------------------------------------------------------------------------
// TypingIndicator
// ---------------------------------------------------------------------------

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-2 h-2 rounded-full bg-white/40"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatDemo
// ---------------------------------------------------------------------------

function ChatDemo() {
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const [cycleKey, setCycleKey] = useState(0);

  const runSequence = useCallback(() => {
    // Clear messages at start of each cycle
    setVisibleMessages([]);

    const timers: NodeJS.Timeout[] = [];

    CHAT_SEQUENCE.forEach(({ msg, showAt }, index) => {
      const timer = setTimeout(() => {
        setVisibleMessages((prev) => {
          // When a bot message arrives, remove the typing indicator
          if (msg.type === 'bot') {
            return [...prev.filter((m) => m.type !== 'typing'), msg];
          }
          // When typing arrives, just add it
          return [...prev, msg];
        });
      }, showAt);
      timers.push(timer);
    });

    // Schedule next cycle
    const resetTimer = setTimeout(() => {
      setCycleKey((k) => k + 1);
    }, TOTAL_CYCLE);
    timers.push(resetTimer);

    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const cleanup = runSequence();
    return cleanup;
  }, [cycleKey, runSequence]);

  const messageVariants = {
    hidden: { opacity: 0, y: 20, scale: 0.95 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { duration: 0.4, ease: EASE_OUT_EXPO },
    },
    exit: { opacity: 0, transition: { duration: 0.2 } },
  };

  const popInVariants = {
    hidden: { opacity: 0, scale: 0.6 },
    visible: {
      opacity: 1,
      scale: 1,
      transition: { type: 'spring', stiffness: 400, damping: 15 },
    },
    exit: { opacity: 0, scale: 0.8, transition: { duration: 0.2 } },
  };

  return (
    <div className="relative">
      {/* Glow behind phone */}
      <div className="absolute inset-0 -m-8 bg-[radial-gradient(ellipse_at_center,_rgba(233,30,140,0.1)_0%,_transparent_70%)]" />

      {/* Phone frame */}
      <div className="relative w-full max-w-[360px] mx-auto rounded-3xl border border-white/10 bg-suwappu-dark-surface overflow-hidden shadow-suwappu-card-dark">
        {/* Header bar */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/5 bg-suwappu-dark-surface-elevated">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-suwappu-magenta to-suwappu-purple flex items-center justify-center">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
            </svg>
          </div>
          <div>
            <div className="text-white font-heading font-semibold text-sm">Suwappu Bot</div>
            <div className="text-white/40 text-xs">online</div>
          </div>
        </div>

        {/* Chat area */}
        <div className="px-4 py-5 min-h-[340px] flex flex-col gap-3">
          <AnimatePresence mode="popLayout">
            {visibleMessages.map((msg, i) => {
              if (msg.type === 'user') {
                return (
                  <motion.div
                    key={`${cycleKey}-user-${i}`}
                    variants={messageVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    layout
                    className="flex justify-end"
                  >
                    <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-blue-600/80 text-white text-sm leading-relaxed">
                      {msg.text}
                    </div>
                  </motion.div>
                );
              }

              if (msg.type === 'typing') {
                return (
                  <motion.div
                    key={`${cycleKey}-typing`}
                    variants={messageVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    layout
                    className="flex justify-start"
                  >
                    <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-suwappu-dark-surface-elevated">
                      <TypingIndicator />
                    </div>
                  </motion.div>
                );
              }

              if (msg.type === 'bot') {
                return (
                  <motion.div
                    key={`${cycleKey}-bot-${i}`}
                    variants={messageVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    layout
                    className="flex justify-start"
                  >
                    <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-suwappu-dark-surface-elevated text-white/90 text-sm leading-relaxed whitespace-pre-line">
                      {msg.text}
                    </div>
                  </motion.div>
                );
              }

              if (msg.type === 'button') {
                return (
                  <motion.div
                    key={`${cycleKey}-btn-${i}`}
                    variants={popInVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    layout
                    className="flex justify-center pt-1"
                  >
                    <div className="px-8 py-2.5 rounded-full bg-gradient-to-r from-suwappu-magenta to-suwappu-purple text-white text-sm font-heading font-semibold shadow-suwappu-glow-magenta cursor-pointer hover:shadow-suwappu-glow-magenta-light transition-shadow">
                      {msg.text}
                    </div>
                  </motion.div>
                );
              }

              if (msg.type === 'success') {
                return (
                  <motion.div
                    key={`${cycleKey}-success-${i}`}
                    variants={messageVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    layout
                    className="flex justify-start"
                  >
                    <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-suwappu-success/10 border border-suwappu-success/20 text-suwappu-success text-sm font-semibold leading-relaxed">
                      {msg.text}
                    </div>
                  </motion.div>
                );
              }

              return null;
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

const STATS = [
  { value: '15', label: 'Chains' },
  { value: '9', label: 'Providers' },
  { value: '< 1s', label: 'Quotes' },
];

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden pt-20 bg-suwappu-dark-bg">
      {/* Background effects */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(233,30,140,0.08)_0%,_transparent_70%)]" />
      <div className="absolute top-1/4 left-[10%] w-72 h-72 rounded-full bg-suwappu-magenta/5 blur-3xl animate-float-slow" />
      <div className="absolute bottom-1/4 right-[10%] w-96 h-96 rounded-full bg-suwappu-purple/5 blur-3xl animate-float" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left side – text content */}
          <motion.div variants={staggerContainerSlow} initial="hidden" animate="visible">
            {/* Eyebrow badge */}
            <motion.div variants={staggerChild} className="mb-5">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-suwappu-magenta/30 bg-suwappu-magenta/5 text-xs font-heading font-semibold text-suwappu-magenta tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-suwappu-success animate-pulse" />
                Cross-chain DEX
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              variants={staggerChild}
              className="font-heading font-bold text-4xl md:text-5xl lg:text-6xl leading-[1.08] mb-6 text-white"
            >
              Swap Any Token.
              <br />
              Any Chain.
              <br />
              <span className="bg-gradient-to-r from-suwappu-magenta to-suwappu-purple bg-clip-text text-transparent">
                Any Chat.
              </span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              variants={staggerChild}
              className="text-lg text-suwappu-dark-text-secondary max-w-md mb-8 leading-relaxed"
            >
              15 chains. 9 providers. One message. Trade from Telegram, WhatsApp,
              Discord, or iOS.
            </motion.p>

            {/* Stats row */}
            <motion.div
              variants={staggerChild}
              className="flex items-center gap-6 mb-6"
            >
              {STATS.map((stat, i) => (
                <div key={stat.label} className="flex items-center gap-6">
                  {i > 0 && <div className="w-px h-8 bg-white/10" />}
                  <div className="text-center">
                    <div className="bg-gradient-to-r from-suwappu-magenta to-suwappu-purple bg-clip-text text-transparent font-heading font-bold text-2xl">
                      {stat.value}
                    </div>
                    <div className="text-white/50 text-xs font-medium uppercase tracking-wider mt-0.5">
                      {stat.label}
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>

            {/* SwapCounter */}
            <motion.div variants={staggerChild} className="mb-8">
              <SwapCounter />
            </motion.div>

            {/* CTA buttons */}
            <motion.div variants={staggerChild} className="flex flex-wrap items-center gap-3">
              <a
                href="https://t.me/suwappu_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-suwappu-magenta to-suwappu-purple text-white font-heading font-semibold px-8 py-3 rounded-full shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
              >
                Start Trading
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-1.5 font-heading font-medium text-sm text-white px-6 py-3 rounded-full border border-white/20 hover:bg-white/5 transition-all"
              >
                See How It Works
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </a>
            </motion.div>
          </motion.div>

          {/* Right side – chat demo */}
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.3, ease: EASE_OUT_EXPO }}
          >
            <ChatDemo />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
