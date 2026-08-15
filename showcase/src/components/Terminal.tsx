'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Line {
  type: 'input' | 'output' | 'success';
  text: string;
}

const DEMO_LINES: Line[] = [
  { type: 'input', text: 'bun add @suwappu/sdk' },
  { type: 'success', text: '\u2713 installed @suwappu/sdk@0.1.0' },
  { type: 'output', text: '' },
  { type: 'input', text: 'suwappu get_quote ETH USDC 1.0 arbitrum' },
  { type: 'output', text: '1 ETH \u2192 2,847.32 USDC via Uniswap V3' },
  { type: 'output', text: 'Gas ~$0.12 | Route: Uniswap V3' },
  { type: 'output', text: '' },
  { type: 'input', text: 'suwappu execute_swap quote_abc123' },
  { type: 'success', text: '\u2713 Tx 0x3f8a...c291 confirmed' },
  { type: 'output', text: 'status: success' },
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
        timers.push(setTimeout(() => runDemo(), 4000));
        return;
      }

      const line = DEMO_LINES[i];
      i++;

      if (line.type === 'input') {
        let charIdx = 0;
        setTyping('');
        const typeChar = () => {
          if (charIdx < line.text.length) {
            setTyping(line.text.slice(0, charIdx + 1));
            charIdx++;
            timers.push(setTimeout(typeChar, 40 + Math.random() * 25));
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

  useEffect(() => {
    const id = setInterval(() => setCursor((v) => !v), 530);
    return () => clearInterval(id);
  }, []);

  // One source of truth: --sw-term-* group in globals.css.
  const lineColor = (type: Line['type']) => {
    switch (type) {
      case 'input': return 'var(--sw-term-input)';
      case 'success': return 'var(--sw-term-success)';
      case 'output': return 'var(--sw-term-output)';
    }
  };

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__dot code-block__dot--red" />
        <span className="code-block__dot code-block__dot--yellow" />
        <span className="code-block__dot code-block__dot--green" />
        <span className="code-block__filename">@suwappu/sdk</span>
      </div>

      <div className="terminal-body" style={{ padding: '1.25rem', minHeight: 260, fontSize: '0.8125rem', lineHeight: 1.7, fontFamily: 'var(--font-mono)' }}>
        <AnimatePresence>
          {lines.map((line, i) => (
            <motion.div
              key={`${i}-${line.text}`}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.15 }}
              style={{ color: lineColor(line.type) }}
            >
              {line.type === 'input' && (
                <span style={{ color: 'var(--suwappu-summer-accent)', marginRight: 8 }}>{'>'}</span>
              )}
              {line.text || '\u00A0'}
            </motion.div>
          ))}
        </AnimatePresence>

        {typing !== '' && (
          <div style={{ color: 'var(--sw-term-input)' }}>
            <span style={{ color: 'var(--suwappu-summer-accent)', marginRight: 8 }}>{'>'}</span>
            {typing}
            <span
              style={{
                display: 'inline-block',
                width: 7,
                height: 14,
                marginLeft: 2,
                marginBottom: -2,
                background: cursor ? 'var(--sw-term-input)' : 'transparent',
              }}
            />
          </div>
        )}

        {typing === '' && lines.length === 0 && (
          <div style={{ color: 'var(--sw-term-input)' }}>
            <span style={{ color: 'var(--suwappu-summer-accent)', marginRight: 8 }}>{'>'}</span>
            <span
              style={{
                display: 'inline-block',
                width: 7,
                height: 14,
                marginLeft: 2,
                marginBottom: -2,
                background: cursor ? 'var(--sw-term-input)' : 'transparent',
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
