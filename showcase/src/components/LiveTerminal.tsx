'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import stats from '@/data/stats.generated.json';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

/**
 * LiveTerminal: the dark, data-dense "pro terminal" in the hero.
 * The marketing page stays light (Summer Breeze); the embedded product
 * surface goes near-black and dense: the premium signal in this category.
 * Left: animated command stream (real Suwappu flows). Right: live-looking
 * market data (quote, order book, open position). Bottom: route status bar.
 */

type LineType = 'cmd' | 'out' | 'ok' | 'gas';

interface Line {
  type: LineType;
  text: string;
}

const FLOWS: Line[][] = [
  [
    { type: 'cmd', text: '/s 1 ETH USDC --best-route' },
    { type: 'out', text: `racing ${stats.routerCount} routers…` },
    { type: 'out', text: '1 ETH → 3,483.28 USDC · Uniswap V3' },
    { type: 'ok', text: 'filled · 0x3f8a…c291' },
  ],
  [
    { type: 'cmd', text: '/perps long BTC 5x' },
    { type: 'out', text: 'entry $64,180 · liq $52,140' },
    { type: 'ok', text: 'position open' },
  ],
  [
    { type: 'cmd', text: '/fund 250 USDC --from arbitrum' },
    { type: 'out', text: 'Across → HyperCore' },
    { type: 'ok', text: 'credited' },
  ],
  [
    { type: 'cmd', text: '/s 100 USDC pathUSD --tempo' },
    { type: 'gas', text: 'gas sponsored · you paid $0.001' },
    { type: 'ok', text: 'swapped on Tempo' },
  ],
];

const COLORS: Record<LineType, string> = {
  cmd: '#7dd3fc', // sky-300
  out: '#8b9aa6',
  ok: '#4ade80', // green-400
  gas: '#fbbf24', // amber-400
};

// Static order-book rows (asks high→low, then bids) for the data sidebar.
const ASKS = [
  ['64,212', '0.84'],
  ['64,198', '1.20'],
  ['64,186', '0.46'],
];
const BIDS = [
  ['64,174', '0.91'],
  ['64,160', '1.35'],
  ['64,148', '0.72'],
];

export default function LiveTerminal({ className = '' }: { className?: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [typing, setTyping] = useState('');
  const [cursor, setCursor] = useState(true);
  const [flowIdx, setFlowIdx] = useState(0);
  const prefersReduced = useReducedMotion();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const runFlow = useCallback((idx: number) => {
    clearTimers();
    const flow = FLOWS[idx];
    setLines([]);
    setTyping('');
    let i = 0;

    const next = () => {
      if (i >= flow.length) {
        timers.current.push(
          setTimeout(() => {
            const n = (idx + 1) % FLOWS.length;
            setFlowIdx(n);
            runFlow(n);
          }, 2400)
        );
        return;
      }
      const line = flow[i];
      i++;

      if (line.type === 'cmd') {
        let c = 0;
        setTyping('');
        const typeChar = () => {
          if (c < line.text.length) {
            setTyping(line.text.slice(0, c + 1));
            c++;
            timers.current.push(setTimeout(typeChar, 34 + Math.random() * 26));
          } else {
            timers.current.push(
              setTimeout(() => {
                setTyping('');
                setLines((p) => [...p, line]);
                timers.current.push(setTimeout(next, 240));
              }, 320)
            );
          }
        };
        timers.current.push(setTimeout(typeChar, 320));
      } else {
        setLines((p) => [...p, line]);
        timers.current.push(setTimeout(next, line.type === 'ok' ? 560 : 340));
      }
    };

    timers.current.push(setTimeout(next, 560));
  }, []);

  useEffect(() => {
    if (prefersReduced) {
      setLines(FLOWS[0]);
      setTyping('');
      return;
    }
    runFlow(0);
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefersReduced]);

  useEffect(() => {
    const id = setInterval(() => setCursor((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={`pro-term sw-shine sw-card-dark ${className}`.trim()}
      aria-label="Live trading terminal"
    >
      <div className="pro-term__bar">
        <span className="pro-term__dot pro-term__dot--r" />
        <span className="pro-term__dot pro-term__dot--y" />
        <span className="pro-term__dot pro-term__dot--g" />
        <span className="pro-term__host">terminal.suwappu.bot</span>
        <span className="pro-term__live">
          <i /> LIVE
        </span>
      </div>

      <div className="pro-term__grid">
        {/* Command stream */}
        <div className="pro-term__log" role="log" aria-live="off">
          <div className="pro-term__intro">suwappu best-route execution · {stats.platformChains} chains</div>
          <AnimatePresence initial={false}>
            {lines.map((line, i) => (
              <motion.div
                key={`${flowIdx}-${i}-${line.text}`}
                className="pro-term__line"
                initial={prefersReduced ? false : { opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.16 }}
                style={{ color: COLORS[line.type] }}
              >
                {line.type === 'cmd' && <span className="pro-term__prompt">$</span>}
                {(line.type === 'ok' || line.type === 'gas') && (
                  <span className="pro-term__glyph">{line.type === 'gas' ? '⚡' : '✓'}</span>
                )}
                {line.text}
              </motion.div>
            ))}
          </AnimatePresence>

          {!prefersReduced && (
            <div className="pro-term__line" style={{ color: COLORS.cmd }}>
              <span className="pro-term__prompt">$</span>
              {typing}
              <span
                className="pro-term__cursor"
                style={{ background: cursor ? '#7dd3fc' : 'transparent' }}
              />
            </div>
          )}
        </div>

        {/* Market data sidebar */}
        <div className="pro-term__side" aria-hidden="true">
          <div className="pro-term__quote">
            <div className="pro-term__quote-head">
              <span>BTC-PERP</span>
              <b className="pro-term__up">+1.42%</b>
            </div>
            <strong>$64,180</strong>
            <svg className="pro-term__spark" viewBox="0 0 120 32" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="#4ade80"
                strokeWidth="1.5"
                points="0,24 14,22 28,25 42,16 56,19 70,11 84,14 98,7 112,9 120,5"
              />
            </svg>
          </div>

          <div className="pro-term__book">
            {ASKS.map(([p, s]) => (
              <div className="pro-term__book-row" key={`a-${p}`}>
                <span className="pro-term__down">{p}</span>
                <span className="pro-term__size">{s}</span>
              </div>
            ))}
            <div className="pro-term__spread">spread 0.02%</div>
            {BIDS.map(([p, s]) => (
              <div className="pro-term__book-row" key={`b-${p}`}>
                <span className="pro-term__up">{p}</span>
                <span className="pro-term__size">{s}</span>
              </div>
            ))}
          </div>

          <div className="pro-term__pos">
            <span>LONG BTC · 5x</span>
            <b className="pro-term__up">+$182</b>
          </div>
        </div>
      </div>

      <div className="pro-term__status" aria-hidden="true">
        <span>route <b>best of 9</b></span>
        <span>gas <b>~$0.12</b></span>
        <span>chains <b>{stats.platformChains}</b></span>
        <span>mev <b>shielded</b></span>
      </div>
    </div>
  );
}
