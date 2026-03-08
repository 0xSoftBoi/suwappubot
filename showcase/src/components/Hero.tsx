'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import Panel from './Panel';

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
      text: '\u2705 Best route found via Li.Fi\n1 ETH \u2192 2,847.32 USDC\nChain: Arbitrum\nFee: 0.3% | Gas: ~$0.12',
    },
    showAt: 2500,
  },
  { msg: { type: 'button', text: 'Confirm Swap' }, showAt: 3500 },
  { msg: { type: 'success', text: '\ud83c\udf89 Swap complete! +2,847.32 USDC' }, showAt: 5000 },
];

const LOOP_DELAY = 3000;
const TOTAL_CYCLE = 5000 + LOOP_DELAY;

// ---------------------------------------------------------------------------
// TypingIndicator — GSAP-driven dots
// ---------------------------------------------------------------------------

function TypingIndicator() {
  const dotsRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!dotsRef.current) return;
    const dots = dotsRef.current.querySelectorAll('.typing-dot');
    gsap.to(dots, {
      opacity: 1,
      stagger: { each: 0.2, repeat: -1, yoyo: true },
      duration: 0.4,
      ease: 'power1.inOut',
    });
  }, { scope: dotsRef });

  return (
    <div ref={dotsRef} className="flex items-center gap-1 px-4 py-3">
      <span className="typing-dot w-2 h-2 rounded-full bg-white/40 opacity-30" />
      <span className="typing-dot w-2 h-2 rounded-full bg-white/40 opacity-30" />
      <span className="typing-dot w-2 h-2 rounded-full bg-white/40 opacity-30" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatDemo — loops with GSAP timeline for message entrance
// ---------------------------------------------------------------------------

function ChatDemo() {
  const [visibleMessages, setVisibleMessages] = useState<ChatMessage[]>([]);
  const [cycleKey, setCycleKey] = useState(0);
  const chatAreaRef = useRef<HTMLDivElement>(null);

  const runSequence = useCallback(() => {
    setVisibleMessages([]);
    const timers: NodeJS.Timeout[] = [];

    CHAT_SEQUENCE.forEach(({ msg }) => {
      // We handle animation in useEffect below
    });

    CHAT_SEQUENCE.forEach(({ msg, showAt }) => {
      const timer = setTimeout(() => {
        setVisibleMessages((prev) => {
          if (msg.type === 'bot') {
            return [...prev.filter((m) => m.type !== 'typing'), msg];
          }
          return [...prev, msg];
        });
      }, showAt);
      timers.push(timer);
    });

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

  // Animate new messages in with GSAP
  useEffect(() => {
    if (!chatAreaRef.current) return;
    const children = chatAreaRef.current.children;
    if (children.length === 0) return;
    const last = children[children.length - 1] as HTMLElement;
    gsap.fromTo(last,
      { opacity: 0, y: 20, scale: 0.95 },
      { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: 'expo.out' }
    );
  }, [visibleMessages]);

  return (
    <div className="relative">
      <div className="absolute inset-0 -m-8 bg-[radial-gradient(ellipse_at_center,_rgba(233,30,140,0.1)_0%,_transparent_70%)]" />

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
        <div ref={chatAreaRef} className="px-4 py-5 min-h-[340px] flex flex-col gap-3">
          {visibleMessages.map((msg, i) => {
            if (msg.type === 'user') {
              return (
                <div key={`${cycleKey}-user-${i}`} className="flex justify-end">
                  <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-blue-600/80 text-white text-sm leading-relaxed">
                    {msg.text}
                  </div>
                </div>
              );
            }

            if (msg.type === 'typing') {
              return (
                <div key={`${cycleKey}-typing`} className="flex justify-start">
                  <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-suwappu-dark-surface-elevated">
                    <TypingIndicator />
                  </div>
                </div>
              );
            }

            if (msg.type === 'bot') {
              return (
                <div key={`${cycleKey}-bot-${i}`} className="flex justify-start">
                  <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-suwappu-dark-surface-elevated text-white/90 text-sm leading-relaxed whitespace-pre-line">
                    {msg.text}
                  </div>
                </div>
              );
            }

            if (msg.type === 'button') {
              return (
                <div key={`${cycleKey}-btn-${i}`} className="flex justify-center pt-1">
                  <div className="px-8 py-2.5 rounded-full bg-gradient-to-r from-suwappu-magenta to-suwappu-purple text-white text-sm font-heading font-semibold shadow-suwappu-glow-magenta">
                    {msg.text}
                  </div>
                </div>
              );
            }

            if (msg.type === 'success') {
              return (
                <div key={`${cycleKey}-success-${i}`} className="flex justify-start">
                  <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-bl-md bg-suwappu-success/10 border border-suwappu-success/20 text-suwappu-success text-sm font-semibold leading-relaxed">
                    {msg.text}
                  </div>
                </div>
              );
            }

            return null;
          })}
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
// Hero Panel
// ---------------------------------------------------------------------------

export default function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const demoRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!textRef.current || !demoRef.current) return;

    const tl = gsap.timeline({ defaults: { ease: 'expo.out', duration: 0.6 } });

    tl.from(textRef.current.querySelectorAll('.hero-stagger'), {
      y: 24,
      opacity: 0,
      stagger: 0.12,
    })
    .from(demoRef.current, {
      y: 30,
      opacity: 0,
      scale: 0.97,
      duration: 0.7,
    }, '-=0.3');
  }, { scope: heroRef });

  return (
    <Panel ref={heroRef} id="hero" className="flex items-center bg-suwappu-dark-bg relative overflow-hidden pt-20 md:pt-0">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(233,30,140,0.08)_0%,_transparent_70%)]" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left side */}
          <div ref={textRef}>
            <div className="hero-stagger mb-5">
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-suwappu-magenta/30 bg-suwappu-magenta/5 text-xs font-heading font-semibold text-suwappu-magenta tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-suwappu-success animate-pulse" />
                Cross-chain DEX
              </span>
            </div>

            <h1 className="hero-stagger font-heading font-bold text-4xl md:text-5xl lg:text-6xl leading-[1.08] mb-6 text-white">
              Swap Any Token.
              <br />
              Any Chain.
              <br />
              <span className="bg-gradient-to-r from-suwappu-magenta to-suwappu-purple bg-clip-text text-transparent">
                Any Chat.
              </span>
            </h1>

            <p className="hero-stagger text-lg text-suwappu-dark-text-secondary max-w-md mb-8 leading-relaxed">
              15 chains. 9 providers. One message. Trade from Telegram, WhatsApp,
              Discord, or iOS.
            </p>

            <div className="hero-stagger flex items-center gap-6 mb-8">
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
            </div>

            <div className="hero-stagger flex flex-wrap items-center gap-3">
              <a
                href="https://t.me/suwappu_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-suwappu-magenta to-suwappu-purple text-white font-heading font-semibold px-8 py-3 rounded-full shadow-suwappu-button hover:shadow-suwappu-button-hover transition-shadow"
              >
                Start Trading
              </a>
              <button
                className="nav-link inline-flex items-center gap-1.5 font-heading font-medium text-sm text-white px-6 py-3 rounded-full border border-white/20 hover:bg-white/5 transition-all"
                data-panel="1"
              >
                See How It Works
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Right side */}
          <div ref={demoRef}>
            <ChatDemo />
          </div>
        </div>
      </div>
    </Panel>
  );
}
