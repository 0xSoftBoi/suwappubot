'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface Petal {
  id: number;
  x: number;
  size: number;
  delay: number;
  duration: number;
  rotate: number;
  drift: number;
}

export default function SakuraPetals({ count = 8 }: { count?: number }) {
  const [petals, setPetals] = useState<Petal[]>([]);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setPetals([]);
      return;
    }
    setPetals(
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        size: 8 + Math.random() * 8,
        delay: Math.random() * 15,
        duration: 10 + Math.random() * 10,
        rotate: Math.random() * 360,
        drift: -30 + Math.random() * 60,
      }))
    );
  }, [count, reducedMotion]);

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[1] overflow-hidden"
      aria-hidden="true"
    >
      {petals.map((p) => (
        <motion.div
          key={p.id}
          className="absolute sakura-petal opacity-[0.45]"
          style={{
            left: `${p.x}%`,
            width: p.size,
            height: p.size,
            top: -20,
          }}
          animate={{
            y: ['0vh', '110vh'],
            x: [0, p.drift],
            rotate: [p.rotate, p.rotate + 720],
            opacity: [0.5, 0.35, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
}
