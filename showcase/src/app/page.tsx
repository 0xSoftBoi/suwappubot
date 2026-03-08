'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import {
  motion,
  useScroll,
  useTransform,
  useMotionValue,
  useInView,
  animate,
  AnimatePresence,
} from 'framer-motion';
import SakuraPetals from '@/components/SakuraPetals';
import Terminal from '@/components/Terminal';

/* ===================================================================
   Animation presets
   =================================================================== */

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (d: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: d * 0.08, ease: [0.22, 1, 0.36, 1] },
  }),
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09 } },
};

const staggerChild = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
  },
};

/* ===================================================================
   Nav
   =================================================================== */

const NAV_LINKS = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Demos', href: '#demos' },
  { label: 'Compare', href: '#compare' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Docs', href: 'https://docs.suwappu.bot' },
];

function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'glass shadow-md py-3'
          : 'py-5 bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
        <a href="#" className="font-heading font-bold text-xl gradient-text">
          Suwappu
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className="font-heading text-sm font-medium text-suwappu-text-secondary hover:text-suwappu-magenta transition-colors"
            >
              {l.label}
            </a>
          ))}
          <a
            href="https://t.me/SuwappuBot"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-suwappu bg-suwappu-gradient text-white font-heading font-medium text-sm px-5 py-2 rounded-suwappu-pill shadow-suwappu-button hover:shadow-suwappu-button-hover"
          >
            Open in Telegram
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="md:hidden p-2 -mr-2"
          aria-label="Menu"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden overflow-hidden glass mx-4 mt-2 rounded-2xl"
          >
            <div className="p-6 space-y-3">
              {NAV_LINKS.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={() => setMobileOpen(false)}
                  {...(l.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                  className="block font-heading text-base font-medium py-2 text-suwappu-text hover:text-suwappu-magenta transition-colors"
                >
                  {l.label}
                </a>
              ))}
              <a
                href="https://t.me/SuwappuBot"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center btn-suwappu bg-suwappu-gradient text-white font-heading font-medium px-5 py-3 rounded-suwappu-pill mt-4"
              >
                Open in Telegram
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

/* ===================================================================
   Hero
   =================================================================== */

function SwapCounter() {
  const count = useMotionValue(0);
  const [display, setDisplay] = useState('0');
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (inView) {
      return animate(count, 10000, {
        duration: 2,
        ease: 'easeOut',
        onUpdate: (v) => setDisplay(Math.floor(v).toLocaleString()),
      }).stop;
    }
  }, [inView, count]);

  return (
    <div ref={ref} className="text-sm text-suwappu-text-secondary font-medium">
      <span className="text-suwappu-purple font-bold text-base">{display}+</span>{' '}
      swaps routed
    </div>
  );
}

function Hero() {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden pt-20">
      {/* Background layers */}
      <div className="absolute inset-0 animated-gradient opacity-[0.08]" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 30% 20%, rgba(255,209,220,0.25) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(108,52,131,0.08) 0%, transparent 50%)',
        }}
      />

      {/* Floating blobs */}
      <div className="absolute top-1/4 left-[10%] w-72 h-72 rounded-full bg-suwappu-sakura-light/20 blur-3xl animate-float-slow" />
      <div className="absolute bottom-1/4 right-[10%] w-96 h-96 rounded-full bg-suwappu-purple/5 blur-3xl animate-float" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left — copy */}
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="visible"
          >
            <motion.div variants={staggerChild} className="mb-5">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-suwappu-sakura-light/30 border border-suwappu-sakura-mid/25 text-xs font-heading font-semibold text-suwappu-purple tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-suwappu-success animate-pulse" />
                Live on 7 chains
              </span>
            </motion.div>

            <motion.h1
              variants={staggerChild}
              className="font-heading font-bold text-4xl md:text-5xl lg:text-[3.5rem] leading-[1.1] mb-6"
            >
              Swap tokens
              <br />
              <span className="gradient-text">from Telegram.</span>
            </motion.h1>

            <motion.p
              variants={staggerChild}
              className="text-lg text-suwappu-text-secondary max-w-md mb-8 leading-relaxed"
            >
              Type{' '}
              <code className="bg-suwappu-sakura-light/30 text-suwappu-purple px-2 py-0.5 rounded text-[15px]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                /s 100 USDC ETH
              </code>{' '}
              and get the best rate across Ethereum, Solana, and 5 more chains.
              Your keys stay with you.
            </motion.p>

            <motion.div
              variants={staggerChild}
              className="flex flex-wrap items-center gap-3 mb-8"
            >
              <a
                href="https://t.me/SuwappuBot"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-suwappu inline-flex items-center gap-2 bg-suwappu-gradient text-white font-heading font-semibold px-7 py-3 rounded-suwappu-pill shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
              >
                <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
                Try @SuwappuBot
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-1.5 font-heading font-medium text-sm text-suwappu-text-secondary px-5 py-3 rounded-suwappu-pill border border-suwappu-sakura-mid/30 hover:border-suwappu-sakura-mid/50 hover:bg-white/50 transition-all"
              >
                See how it works
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </a>
            </motion.div>

            <motion.div
              variants={staggerChild}
              className="flex flex-wrap items-center gap-5 text-[13px] text-suwappu-text-secondary"
            >
              {['Non-custodial', 'No KYC', 'No download'].map((label) => (
                <span key={label} className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-suwappu-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {label}
                </span>
              ))}
              <SwapCounter />
            </motion.div>
          </motion.div>

          {/* Right — terminal */}
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="hidden lg:block"
          >
            <div className="animate-float-slow">
              <Terminal />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

/* ===================================================================
   Chain marquee
   =================================================================== */

const CHAINS = [
  { name: 'Ethereum', type: 'chain' },
  { name: 'BSC', type: 'chain' },
  { name: 'Polygon', type: 'chain' },
  { name: 'Arbitrum', type: 'chain' },
  { name: 'Optimism', type: 'chain' },
  { name: 'Base', type: 'chain' },
  { name: 'Solana', type: 'chain' },
  { name: 'Li.Fi', type: 'partner' },
  { name: 'Jupiter', type: 'partner' },
  { name: 'Turnkey', type: 'partner' },
];

function MarqueeRow({ reverse = false }: { reverse?: boolean }) {
  const items = [...CHAINS, ...CHAINS, ...CHAINS, ...CHAINS];
  return (
    <div className="overflow-hidden">
      <div className={`flex shrink-0 items-center gap-6 ${reverse ? 'animate-marquee-reverse' : 'animate-marquee'}`}>
        {items.map((item, i) => (
          <div
            key={`${item.name}-${i}`}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 border border-suwappu-sakura-light/20 whitespace-nowrap shadow-sm"
          >
            <span className="w-2 h-2 rounded-full bg-suwappu-gradient shrink-0" />
            <span className="font-heading font-medium text-sm text-suwappu-text">
              {item.name}
            </span>
            {item.type === 'partner' && (
              <span className="text-[9px] font-semibold text-suwappu-magenta bg-suwappu-sakura-light/40 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
                Partner
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChainStrip() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0 }}
      animate={inView ? { opacity: 1 } : {}}
      transition={{ duration: 0.8 }}
      className="py-12 space-y-3"
    >
      <p className="text-center text-xs font-heading font-semibold text-suwappu-text-secondary/60 uppercase tracking-[0.15em] mb-6">
        Routing across
      </p>
      <MarqueeRow />
      <MarqueeRow reverse />
    </motion.section>
  );
}

/* ===================================================================
   How it works — 3 steps + chat simulation
   =================================================================== */

const STEPS = [
  {
    number: 1,
    title: 'Message the bot',
    description:
      'Open @SuwappuBot in Telegram. A non-custodial wallet is created for you automatically — no seed phrase to write down.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
  },
  {
    number: 2,
    title: 'Type a swap',
    description:
      'Send /s 100 USDC ETH. The bot finds the best rate across Li.Fi and Jupiter, then shows you a quote with fees included.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    number: 3,
    title: 'Tap confirm',
    description:
      'Review the quote and hit the confirm button. The transaction goes on-chain and you get a status update when it lands.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

function ChatBubble({ from, text }: { from: 'user' | 'bot'; text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={`flex ${from === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] px-4 py-2.5 text-sm whitespace-pre-line leading-relaxed ${
          from === 'user'
            ? 'bg-suwappu-gradient text-white rounded-2xl rounded-br-lg'
            : 'bg-white border border-suwappu-sakura-light/20 text-suwappu-text rounded-2xl rounded-bl-lg shadow-sm'
        }`}
      >
        {text}
      </div>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex justify-start"
    >
      <div className="bg-white border border-suwappu-sakura-light/20 px-4 py-3 rounded-2xl rounded-bl-lg shadow-sm flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-suwappu-text-secondary/40"
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12 }}
          />
        ))}
      </div>
    </motion.div>
  );
}

function ChatSimulation() {
  const [step, setStep] = useState('idle');
  const [messages, setMessages] = useState<{ from: 'user' | 'bot'; text: string }[]>([]);

  const runDemo = useCallback(() => {
    setMessages([]);
    setStep('idle');

    const t: NodeJS.Timeout[] = [];
    const push = (delay: number, fn: () => void) => {
      t.push(setTimeout(fn, delay));
    };

    let d = 0;
    push((d += 600), () => setMessages([{ from: 'user', text: '/s 100 USDC ETH' }]));
    push((d += 600), () => setStep('bot-typing'));
    push((d += 1200), () => {
      setMessages((m) => [...m, { from: 'bot', text: 'Swap 100 USDC \u2192 0.0287 ETH\nRate: $3,484.32 \u00b7 Fee: 0.3%\nRoute: USDC \u2192 WETH via Uniswap V3' }]);
      setStep('confirm');
    });
    push((d += 1800), () => setStep('confirm-click'));
    push((d += 600), () => {
      setMessages((m) => [...m, { from: 'bot', text: 'Confirmed. Tx submitted \u2713' }]);
      setStep('done');
    });
    push((d += 3000), () => runDemo());

    return () => t.forEach(clearTimeout);
  }, []);

  useEffect(() => { return runDemo(); }, [runDemo]);

  return (
    <div className="glass-card rounded-2xl p-5 max-w-sm mx-auto shadow-suwappu-card">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-suwappu-sakura-light/15">
        <div className="w-9 h-9 rounded-full bg-suwappu-gradient flex items-center justify-center text-white font-bold text-xs">
          S
        </div>
        <div>
          <div className="font-heading font-semibold text-sm leading-none">Suwappu Bot</div>
          <div className="text-[11px] text-suwappu-success mt-0.5">online</div>
        </div>
      </div>

      {/* Messages */}
      <div className="space-y-2.5 min-h-[240px]">
        {messages.map((m, i) => (
          <ChatBubble key={i} from={m.from} text={m.text} />
        ))}
        <AnimatePresence>{step === 'bot-typing' && <TypingDots />}</AnimatePresence>
        {step === 'confirm' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex justify-start"
          >
            <span className="bg-suwappu-success/90 text-white font-heading font-semibold px-5 py-2 rounded-suwappu-pill text-sm shadow-sm">
              Confirm Swap
            </span>
          </motion.div>
        )}
        {step === 'done' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex justify-center mt-1"
          >
            <span className="flex items-center gap-1.5 text-suwappu-success font-heading font-semibold text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Done
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="how-it-works" className="py-28 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p variants={staggerChild} className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
            How it works
          </motion.p>
          <motion.h2 variants={staggerChild} className="font-heading font-bold text-3xl md:text-4xl text-center mb-4">
            Three messages. That&apos;s it.
          </motion.h2>
          <motion.p variants={staggerChild} className="text-center text-suwappu-text-secondary mb-16 max-w-md mx-auto">
            No wallet setup, no app store, no seed phrases.
          </motion.p>

          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Steps */}
            <motion.div variants={stagger} className="space-y-6">
              {STEPS.map((step, i) => (
                <motion.div
                  key={step.number}
                  variants={staggerChild}
                  className="group flex gap-4 p-5 rounded-2xl hover:bg-white/60 transition-colors duration-200"
                >
                  <div className="shrink-0 relative">
                    <div className="w-11 h-11 rounded-xl bg-suwappu-gradient flex items-center justify-center text-white shadow-suwappu-button">
                      {step.icon}
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className="absolute top-full left-1/2 -translate-x-1/2 w-px h-6 bg-gradient-to-b from-suwappu-sakura-mid/40 to-transparent" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-heading font-bold text-suwappu-magenta/50 uppercase tracking-wider">
                        Step {step.number}
                      </span>
                    </div>
                    <h3 className="font-heading font-semibold text-lg mb-1">{step.title}</h3>
                    <p className="text-suwappu-text-secondary text-sm leading-relaxed">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            {/* Chat sim */}
            <motion.div variants={staggerChild}>
              <ChatSimulation />
            </motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ===================================================================
   Features — 4 cards
   =================================================================== */

const FEATURES = [
  {
    title: 'Cross-chain routing',
    description: 'Li.Fi for EVM chains, Jupiter for Solana. The bot picks the cheapest route and shows you the quote before you commit.',
    stat: '7 chains',
    color: 'from-suwappu-sakura-mid to-suwappu-magenta-mid',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
  },
  {
    title: 'Your keys, your wallet',
    description: 'Wallets are backed by Turnkey TEE hardware. Private keys never leave the secure enclave. No seed phrases, no KYC.',
    stat: 'Non-custodial',
    color: 'from-suwappu-purple to-suwappu-purple-deep',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
  },
  {
    title: 'Works where you already are',
    description: 'Telegram bot, Mini App, WhatsApp, or the iOS app. Same wallet, same funds, pick whichever.',
    stat: '4 interfaces',
    color: 'from-suwappu-magenta to-suwappu-purple',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
      </svg>
    ),
  },
  {
    title: 'Sub-second quotes',
    description: 'Quotes come back in under a second. Prices update live. Hit confirm and the tx goes out immediately.',
    stat: '< 1s',
    color: 'from-suwappu-magenta-mid to-suwappu-sakura-mid',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
];

function Features() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="features" className="py-28 px-6 relative">
      {/* Subtle background */}
      <div className="absolute inset-0 bg-gradient-to-b from-suwappu-blush/50 via-white to-white" />

      <div className="relative max-w-5xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p variants={staggerChild} className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
            Features
          </motion.p>
          <motion.h2 variants={staggerChild} className="font-heading font-bold text-3xl md:text-4xl text-center mb-16">
            What you get
          </motion.h2>

          <div className="grid sm:grid-cols-2 gap-5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                variants={staggerChild}
                className="group glass-card rounded-2xl p-7 shadow-suwappu-card hover:shadow-suwappu-card-hover transition-all duration-300 hover:-translate-y-1"
              >
                {/* Icon */}
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center text-white mb-5 shadow-sm group-hover:scale-105 transition-transform duration-200`}>
                  {f.icon}
                </div>

                <h3 className="font-heading font-semibold text-lg mb-2">{f.title}</h3>
                <p className="text-suwappu-text-secondary text-sm leading-relaxed mb-4">{f.description}</p>

                <span className="inline-block text-xs font-heading font-bold text-suwappu-purple bg-suwappu-purple/8 px-3 py-1 rounded-full">
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

/* ===================================================================
   Comparison table
   =================================================================== */

const COMPARE_ROWS = [
  { label: 'Non-custodial', suwappu: true, cex: false, dex: true },
  { label: 'Cross-chain', suwappu: true, cex: 'partial' as const, dex: 'partial' as const },
  { label: 'Fee', suwappu: '0.3%', cex: '0.1\u20130.5%', dex: '0.3\u20131%' },
  { label: 'Quote speed', suwappu: '< 1s', cex: 'Instant', dex: '5\u201330s' },
  { label: 'Chains', suwappu: '7+', cex: 'Varies', dex: '3\u20135' },
  { label: 'Chat interface', suwappu: true, cex: false, dex: false },
  { label: 'No KYC', suwappu: true, cex: false, dex: true },
];

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <svg className="w-5 h-5 text-suwappu-success mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;
  if (value === false) return <svg className="w-4 h-4 text-suwappu-text-secondary/30 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>;
  if (value === 'partial') return <span className="text-xs font-medium text-suwappu-warning">Partial</span>;
  return <span className="text-sm font-medium">{value}</span>;
}

function CompareTable() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section id="compare" className="py-28 px-6">
      <div className="max-w-3xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p variants={staggerChild} className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
            Compare
          </motion.p>
          <motion.h2 variants={staggerChild} className="font-heading font-bold text-3xl md:text-4xl text-center mb-4">
            How it stacks up
          </motion.h2>
          <motion.p variants={staggerChild} className="text-center text-suwappu-text-secondary mb-12 text-sm">
            Honest breakdown. Decide for yourself.
          </motion.p>

          <motion.div variants={staggerChild} className="glass-card rounded-2xl overflow-hidden shadow-suwappu-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-suwappu-sakura-light/15">
                    <th className="text-left py-4 px-5 font-heading font-medium text-suwappu-text-secondary text-xs" />
                    <th className="py-4 px-4 text-center font-heading font-bold text-sm bg-suwappu-gradient bg-clip-text text-transparent">Suwappu</th>
                    <th className="py-4 px-4 text-center font-heading font-medium text-xs text-suwappu-text-secondary">CEXs</th>
                    <th className="py-4 px-4 text-center font-heading font-medium text-xs text-suwappu-text-secondary">DEX Agg.</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row, i) => (
                    <tr key={row.label} className={`${i < COMPARE_ROWS.length - 1 ? 'border-b border-suwappu-sakura-light/10' : ''}`}>
                      <td className="py-3.5 px-5 font-medium text-sm">{row.label}</td>
                      <td className="py-3.5 px-4 text-center bg-suwappu-sakura-light/[0.06]"><Cell value={row.suwappu} /></td>
                      <td className="py-3.5 px-4 text-center"><Cell value={row.cex} /></td>
                      <td className="py-3.5 px-4 text-center"><Cell value={row.dex} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ===================================================================
   Platform demos
   =================================================================== */

const PLATFORMS = [
  {
    id: 'telegram-bot',
    name: 'Telegram Bot',
    description: 'Quick commands, inline keyboards, instant confirmations.',
    video: '/remotion/out/telegram-bot-demo.mp4',
    features: ['/s command for swaps', 'Inline keyboard confirmations', 'Real-time price updates'],
  },
  {
    id: 'mini-app',
    name: 'Mini App',
    description: 'Full trading dashboard inside Telegram.',
    video: '/remotion/out/mini-app-demo.mp4',
    features: ['Portfolio overview', 'Advanced swap interface', 'Price alerts'],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Same bot, different messenger.',
    video: '/remotion/out/whatsapp-demo.mp4',
    features: ['Token picker flow', 'Reply-based confirmations'],
  },
  {
    id: 'mobile',
    name: 'Mobile',
    description: 'Native iOS experience.',
    video: '/remotion/out/mobile-app-demo.mp4',
    features: ['Tab-based navigation', 'Token discovery', 'Push notifications'],
  },
];

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
      <video
        ref={ref}
        src={src}
        className="w-full aspect-[9/19.5] object-cover bg-suwappu-ocean"
        onLoadedData={() => setLoaded(true)}
        playsInline
        muted
      />
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

function Demos() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const [active, setActive] = useState(0);
  const plat = PLATFORMS[active];

  return (
    <section id="demos" className="py-28 px-6 relative">
      <div className="absolute inset-0 bg-gradient-to-b from-white via-suwappu-blush/40 to-white" />

      <div className="relative max-w-5xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p variants={staggerChild} className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
            Demos
          </motion.p>
          <motion.h2 variants={staggerChild} className="font-heading font-bold text-3xl md:text-4xl text-center mb-4">
            Pick your interface
          </motion.h2>
          <motion.p variants={staggerChild} className="text-center text-suwappu-text-secondary text-sm mb-12">
            Same wallet and funds everywhere.
          </motion.p>

          {/* Tabs */}
          <motion.div variants={staggerChild} className="flex flex-wrap justify-center gap-2 mb-14">
            {PLATFORMS.map((p, i) => (
              <button
                key={p.id}
                onClick={() => setActive(i)}
                className={`px-5 py-2.5 rounded-suwappu-pill font-heading font-medium text-sm transition-all duration-200 ${
                  i === active
                    ? 'bg-suwappu-gradient text-white shadow-suwappu-button'
                    : 'bg-white text-suwappu-text-secondary hover:text-suwappu-text border border-suwappu-sakura-light/20 shadow-sm hover:shadow-md'
                }`}
              >
                {p.name}
              </button>
            ))}
          </motion.div>

          {/* Content */}
          <motion.div variants={staggerChild}>
            <div className="grid md:grid-cols-2 gap-10 items-center">
              <div className="max-w-[280px] mx-auto">
                <div className="phone-frame">
                  <div className="phone-screen">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={plat.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                      >
                        <VideoPlayer src={plat.video} />
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              <div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={plat.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -16 }}
                    transition={{ duration: 0.3 }}
                  >
                    <h3 className="font-heading font-bold text-2xl mb-2">{plat.name}</h3>
                    <p className="text-suwappu-text-secondary mb-6 text-sm">{plat.description}</p>
                    <ul className="space-y-3">
                      {plat.features.map((f) => (
                        <li key={f} className="flex items-center gap-3 text-sm">
                          <span className="w-5 h-5 rounded-full bg-suwappu-sakura-light/30 flex items-center justify-center shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-suwappu-magenta" />
                          </span>
                          {f}
                        </li>
                      ))}
                    </ul>
                    {plat.id === 'telegram-bot' && (
                      <a
                        href="https://t.me/SuwappuBot"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 mt-8 text-sm font-heading font-semibold text-suwappu-magenta hover:text-suwappu-purple transition-colors"
                      >
                        Try it now
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
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

/* ===================================================================
   FAQ
   =================================================================== */

const FAQ_ITEMS = [
  { q: 'Is it really non-custodial?', a: 'Yes. Wallets run inside Turnkey TEE hardware. Your private keys never leave the secure enclave \u2014 not even we can access them. You can export your wallet at any time.' },
  { q: 'What chains does it support?', a: 'Ethereum, BSC, Polygon, Arbitrum, Optimism, Base, and Solana. EVM chains route through Li.Fi, Solana through Jupiter.' },
  { q: 'How does routing work?', a: 'When you send /s [amount] [from] [to], the bot queries Li.Fi and Jupiter for quotes, picks the best rate, and shows it to you. You see the exact output and fee before confirming.' },
  { q: 'What does it cost?', a: '0.3% per swap. No subscription, no hidden fees. Gas is paid from your wallet as usual.' },
  { q: 'Do I need to install anything?', a: 'No. The Telegram and WhatsApp bots work in-app \u2014 just search @SuwappuBot. The Mini App runs inside Telegram too. Only the iOS app requires a download.' },
  { q: 'How fast is it?', a: 'Quotes arrive in under a second. After you confirm, the tx is submitted immediately. Settlement depends on the chain \u2014 a few seconds on L2s, ~15s on Ethereum.' },
];

function FAQ() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="faq" className="py-28 px-6">
      <div className="max-w-2xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p variants={staggerChild} className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">
            FAQ
          </motion.p>
          <motion.h2 variants={staggerChild} className="font-heading font-bold text-3xl md:text-4xl text-center mb-12">
            Common questions
          </motion.h2>

          <motion.div variants={stagger} className="space-y-2">
            {FAQ_ITEMS.map((item, i) => (
              <motion.div key={i} variants={staggerChild} className="glass-card rounded-xl overflow-hidden shadow-sm">
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-6 py-4 text-left"
                >
                  <span className="font-heading font-semibold text-sm">{item.q}</span>
                  <motion.svg
                    className="w-4 h-4 shrink-0 text-suwappu-text-secondary"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                    animate={{ rotate: open === i ? 180 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </motion.svg>
                </button>
                <AnimatePresence>
                  {open === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-5 text-sm text-suwappu-text-secondary leading-relaxed">{item.a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/* ===================================================================
   CTA
   =================================================================== */

function CTA() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <section className="py-28 px-6 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-suwappu-sakura-light/15 blur-3xl" />
      </div>

      <motion.div
        ref={ref}
        initial={{ opacity: 0, y: 24 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative max-w-2xl mx-auto text-center"
      >
        <h2 className="font-heading font-bold text-3xl md:text-4xl mb-4">
          Open Telegram.{' '}
          <span className="gradient-text">Type /start.</span>
        </h2>
        <p className="text-suwappu-text-secondary mb-8">
          That&apos;s the whole onboarding. Your wallet is ready in the time it takes
          to read this sentence.
        </p>
        <a
          href="https://t.me/SuwappuBot"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 btn-suwappu bg-suwappu-gradient text-white font-heading font-semibold px-8 py-3.5 rounded-suwappu-pill shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
        >
          <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
          Open @SuwappuBot
        </a>
        <div className="flex items-center justify-center gap-5 mt-6 text-xs text-suwappu-text-secondary">
          <span>Non-custodial</span>
          <span className="w-1 h-1 rounded-full bg-suwappu-sakura-mid/50" />
          <span>0.3% fee</span>
          <span className="w-1 h-1 rounded-full bg-suwappu-sakura-mid/50" />
          <span>7 chains</span>
        </div>
      </motion.div>
    </section>
  );
}

/* ===================================================================
   Footer
   =================================================================== */

function Footer() {
  return (
    <footer className="bg-suwappu-ocean text-white py-16 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="grid md:grid-cols-3 gap-12 mb-12">
          <div>
            <h3 className="font-heading font-bold text-lg mb-3">Suwappu</h3>
            <p className="text-white/40 text-sm leading-relaxed max-w-xs">
              Swap tokens across 7 chains from Telegram, WhatsApp, or the iOS app. Non-custodial.
            </p>
          </div>
          <div>
            <h4 className="font-heading font-semibold text-xs mb-4 text-white/50 uppercase tracking-wider">Product</h4>
            <ul className="space-y-2.5">
              {['Features', 'Demos', 'How it works', 'FAQ'].map((l) => (
                <li key={l}><a href={`#${l.toLowerCase().replace(/ /g, '-')}`} className="text-sm text-white/40 hover:text-white transition-colors">{l}</a></li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-heading font-semibold text-xs mb-4 text-white/50 uppercase tracking-wider">Connect</h4>
            <ul className="space-y-2.5">
              {[
                { label: 'Telegram', href: 'https://t.me/SuwappuBot' },
                { label: 'Twitter/X', href: '#' },
                { label: 'GitHub', href: '#' },
              ].map((l) => (
                <li key={l.label}><a href={l.href} target="_blank" rel="noopener noreferrer" className="text-sm text-white/40 hover:text-white transition-colors">{l.label}</a></li>
              ))}
            </ul>
          </div>
        </div>

        <div className="section-divider mb-8" />

        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/25">&copy; {new Date().getFullYear()} Suwappu. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="text-xs text-white/25 hover:text-white/50 transition-colors">Privacy</a>
            <a href="#" className="text-xs text-white/25 hover:text-white/50 transition-colors">Terms</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ===================================================================
   Page
   =================================================================== */

export default function HomePage() {
  return (
    <main>
      <SakuraPetals count={8} />
      <Nav />
      <Hero />
      <ChainStrip />
      <div className="section-divider max-w-4xl mx-auto" />
      <HowItWorks />
      <Features />
      <div className="section-divider max-w-4xl mx-auto" />
      <CompareTable />
      <Demos />
      <div className="section-divider max-w-4xl mx-auto" />
      <FAQ />
      <CTA />
      <Footer />
    </main>
  );
}
