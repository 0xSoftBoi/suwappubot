'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Line {
  type: 'input' | 'output' | 'success' | 'muted';
  text: string;
}

const DEMO_LINES: Line[] = [
  { type: 'input', text: '/s 100 USDC ETH' },
  { type: 'muted', text: 'Fetching quotes from Li.Fi...' },
  { type: 'output', text: '' },
  { type: 'output', text: 'Swap 100 USDC  →  0.0287 ETH' },
  { type: 'output', text: 'Rate     $3,484.32/ETH' },
  { type: 'output', text: 'Fee      0.3% (0.30 USDC)' },
  { type: 'output', text: 'Route    USDC → WETH via Uniswap V3' },
  { type: 'output', text: '' },
  { type: 'input', text: 'confirm' },
  { type: 'success', text: 'Tx submitted  ✓  0x3f8a...c291' },
];

export default function Terminal() {
  const [lines, setLines] = useState<Line[]>([]);
  const [typing, setTyping] = useState('');
  const [cursor, setCursor] = useState(true);

  const runDemo = useCallback(() => {
    setLines([]);
    setTyping('');
    let i = 0;
    const timers: NodeJS.Timeout[] = [];

    const addNext = () => {
      if (i >= DEMO_LINES.length) {
        // restart after a pause
        timers.push(setTimeout(() => runDemo(), 3000));
        return;
      }

      const line = DEMO_LINES[i];
      i++;

      if (line.type === 'input') {
        // Typewriter effect for inputs
        let charIdx = 0;
        setTyping('');
        const typeChar = () => {
          if (charIdx < line.text.length) {
            setTyping(line.text.slice(0, charIdx + 1));
            charIdx++;
            timers.push(setTimeout(typeChar, 45 + Math.random() * 30));
          } else {
            timers.push(
              setTimeout(() => {
                setTyping('');
                setLines((prev) => [...prev, line]);
                timers.push(setTimeout(addNext, 200));
              }, 300)
            );
          }
        };
        timers.push(setTimeout(typeChar, 400));
      } else {
        setLines((prev) => [...prev, line]);
        const delay = line.type === 'success' ? 600 : line.text === '' ? 50 : 120;
        timers.push(setTimeout(addNext, delay));
      }
    };

    timers.push(setTimeout(addNext, 800));
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    const cleanup = runDemo();
    return cleanup;
  }, [runDemo]);

  // Blinking cursor
  useEffect(() => {
    const id = setInterval(() => setCursor((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="terminal rounded-2xl overflow-hidden shadow-suwappu-card">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
        <span className="terminal-dot bg-[#ff5f57]" />
        <span className="terminal-dot bg-[#febc2e]" />
        <span className="terminal-dot bg-[#28c840]" />
        <span className="ml-3 text-[11px] text-white/30 font-medium">
          @SuwappuBot
        </span>
      </div>

      {/* Content */}
      <div className="p-5 min-h-[280px] text-[13px] leading-relaxed space-y-0.5">
        <AnimatePresence>
          {lines.map((line, i) => (
            <motion.div
              key={`${i}-${line.text}`}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              className={
                line.type === 'input'
                  ? 'text-suwappu-cyan/80'
                  : line.type === 'success'
                    ? 'text-suwappu-success/80'
                    : line.type === 'muted'
                      ? 'text-white/30 italic'
                      : 'text-white/70'
              }
            >
              {line.type === 'input' && (
                <span className="text-suwappu-magenta/60 mr-2">{'>'}</span>
              )}
              {line.text || '\u00A0'}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Current typing line */}
        {typing !== '' && (
          <div className="text-suwappu-cyan/80">
            <span className="text-suwappu-magenta/60 mr-2">{'>'}</span>
            {typing}
            <span className={`inline-block w-[7px] h-[14px] ml-0.5 -mb-0.5 ${cursor ? 'bg-suwappu-cyan/60' : 'bg-transparent'}`} />
          </div>
        )}

        {/* Idle cursor */}
        {typing === '' && lines.length === 0 && (
          <div className="text-suwappu-cyan/80">
            <span className="text-suwappu-magenta/60 mr-2">{'>'}</span>
            <span className={`inline-block w-[7px] h-[14px] ml-0.5 -mb-0.5 ${cursor ? 'bg-suwappu-cyan/60' : 'bg-transparent'}`} />
          </div>
        )}
      </div>
    </div>
  );
}
