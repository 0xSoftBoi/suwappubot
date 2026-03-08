'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { motion, useInView, AnimatePresence } from 'framer-motion';
import { stagger, staggerChild, viewportOnce } from '@/lib/animations';

const STEPS = [
  {
    number: 1,
    title: 'Message the bot',
    description: 'Open @suwappu_bot in Telegram. A non-custodial wallet is created for you automatically \u2014 no seed phrase to write down.',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" /></svg>,
  },
  {
    number: 2,
    title: 'Type a swap',
    description: 'Send /s 100 USDC ETH. The bot finds the best rate across Li.Fi and Jupiter, then shows you a quote with fees included.',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>,
  },
  {
    number: 3,
    title: 'Tap confirm',
    description: 'Review the quote and hit the confirm button. The transaction goes on-chain and you get a status update when it lands.',
    icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
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
      <div className={`max-w-[85%] px-4 py-2.5 text-sm whitespace-pre-line leading-relaxed ${
        from === 'user'
          ? 'bg-suwappu-gradient text-white rounded-2xl rounded-br-lg'
          : 'bg-suwappu-dark-surface-elevated border border-white/5 text-suwappu-dark-text rounded-2xl rounded-bl-lg shadow-sm'
      }`}>
        {text}
      </div>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex justify-start">
      <div className="bg-suwappu-dark-surface-elevated border border-white/5 px-4 py-3 rounded-2xl rounded-bl-lg shadow-sm flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="w-1.5 h-1.5 rounded-full bg-suwappu-dark-text-secondary/40" animate={{ y: [0, -3, 0] }} transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.12 }} />
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
    const push = (delay: number, fn: () => void) => { t.push(setTimeout(fn, delay)); };

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
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-white/5">
        <div className="w-9 h-9 rounded-full bg-suwappu-gradient flex items-center justify-center text-white font-bold text-xs">S</div>
        <div>
          <div className="font-heading font-semibold text-sm leading-none">Suwappu Bot</div>
          <div className="text-[11px] text-suwappu-success mt-0.5">online</div>
        </div>
      </div>
      <div className="space-y-2.5 min-h-[240px]">
        {messages.map((m, i) => <ChatBubble key={i} from={m.from} text={m.text} />)}
        <AnimatePresence>{step === 'bot-typing' && <TypingDots />}</AnimatePresence>
        {step === 'confirm' && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex justify-start">
            <span className="bg-suwappu-success/90 text-white font-heading font-semibold px-5 py-2 rounded-suwappu-pill text-sm shadow-sm">Confirm Swap</span>
          </motion.div>
        )}
        {step === 'done' && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="flex justify-center mt-1">
            <span className="flex items-center gap-1.5 text-suwappu-success font-heading font-semibold text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              Done
            </span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, viewportOnce);

  return (
    <section id="how-it-works" className="py-28 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div ref={ref} variants={stagger} initial="hidden" animate={inView ? 'visible' : 'hidden'}>
          <motion.p variants={staggerChild} className="text-center text-xs font-heading font-semibold text-suwappu-magenta uppercase tracking-[0.15em] mb-3">How it works</motion.p>
          <motion.h2 variants={staggerChild} className="font-heading font-bold text-3xl md:text-4xl text-center mb-4">Three messages. That&apos;s it.</motion.h2>
          <motion.p variants={staggerChild} className="text-center text-suwappu-dark-text-secondary mb-16 max-w-md mx-auto">No wallet setup, no app store, no seed phrases.</motion.p>

          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div variants={stagger} className="space-y-6">
              {STEPS.map((step, i) => (
                <motion.div key={step.number} variants={staggerChild} className="group flex gap-4 p-5 rounded-2xl hover:bg-white/5 transition-colors duration-200">
                  <div className="shrink-0 relative">
                    <div className="w-11 h-11 rounded-xl bg-suwappu-gradient flex items-center justify-center text-white shadow-suwappu-button">{step.icon}</div>
                    {i < STEPS.length - 1 && <div className="absolute top-full left-1/2 -translate-x-1/2 w-px h-6 bg-gradient-to-b from-white/20 to-transparent" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-heading font-bold text-suwappu-magenta/50 uppercase tracking-wider">Step {step.number}</span>
                    </div>
                    <h3 className="font-heading font-semibold text-lg mb-1">{step.title}</h3>
                    <p className="text-suwappu-dark-text-secondary text-sm leading-relaxed">{step.description}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
            <motion.div variants={staggerChild}><ChatSimulation /></motion.div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
