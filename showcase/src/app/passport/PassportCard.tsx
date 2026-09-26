'use client';

import { useRef } from 'react';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import styles from './passport.module.css';

export type StampKey = 'worldId' | 'ens' | 'uniswap';

const STAMPS: { key: StampKey; label: string; sub: string; rotate: number; top: string; left: string }[] = [
  { key: 'worldId', label: 'WORLD ID', sub: 'PROOF OF PERSONHOOD', rotate: -9, top: '18%', left: '10%' },
  { key: 'ens', label: 'ENSv2', sub: 'AGENT SUBNAME · SEPOLIA', rotate: 6, top: '38%', left: '58%' },
  { key: 'uniswap', label: 'UNISWAP V4', sub: 'GATED HOOK SWAP', rotate: -4, top: '66%', left: '18%' },
];

export default function PassportCard({
  agentId,
  landed,
}: {
  agentId: string;
  landed: Record<StampKey, boolean>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const pxRaw = useMotionValue(0.5);
  const pyRaw = useMotionValue(0.5);
  const px = useSpring(pxRaw, { stiffness: 180, damping: 24 });
  const py = useSpring(pyRaw, { stiffness: 180, damping: 24 });
  const rotateXRaw = useMotionValue(0);
  const rotateYRaw = useMotionValue(0);
  const rotateX = useSpring(rotateXRaw, { stiffness: 180, damping: 20 });
  const rotateY = useSpring(rotateYRaw, { stiffness: 180, damping: 20 });
  const shineX = useMotionTemplate`${px}`;
  const shineY = useMotionTemplate`${py}`;

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    pxRaw.set(relX);
    pyRaw.set(relY);
    rotateYRaw.set((relX - 0.5) * 14);
    rotateXRaw.set((0.5 - relY) * 14);
  };

  const handleLeave = () => {
    rotateXRaw.set(0);
    rotateYRaw.set(0);
  };

  return (
    <div className={styles.cardStage}>
      <motion.div
        ref={ref}
        className={styles.card}
        onPointerMove={handleMove}
        onPointerLeave={handleLeave}
        style={reduceMotion ? undefined : { rotateX, rotateY, transformPerspective: 900 }}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        {!reduceMotion && (
          <motion.div
            className={styles.cardShine}
            style={{
              background: useMotionTemplate`radial-gradient(360px circle at calc(${shineX} * 100%) calc(${shineY} * 100%), rgba(255,255,255,0.42), transparent 60%)`,
            }}
          />
        )}
        <div className={styles.cardFoil} aria-hidden="true" />

        <div className={styles.cardHeader}>
          <span className={styles.cardKicker}>AGENT SWAP PASSPORT</span>
          <span className={styles.cardChip} aria-hidden="true" />
        </div>

        <div className={styles.cardBody}>
          <p className={styles.cardEyebrow}>Holder</p>
          <p className={styles.cardAgentId}>{agentId}</p>
          <p className={styles.cardEyebrow}>Trust layer</p>
          <p className={styles.cardTrustLine}>World ID · ENSv2 · Uniswap v4 hook</p>
        </div>

        <div className={styles.stampField}>
          {STAMPS.map((s) => (
            <motion.div
              key={s.key}
              className={`${styles.stamp} ${landed[s.key] ? styles.stampLanded : ''}`}
              style={{ top: s.top, left: s.left, ['--stamp-rotate' as string]: `${s.rotate}deg` }}
              initial={false}
              animate={
                landed[s.key]
                  ? { opacity: 1, scale: 1, rotate: s.rotate }
                  : { opacity: 0, scale: 1.6, rotate: s.rotate }
              }
              transition={{ type: 'spring', stiffness: 340, damping: 14, mass: 0.6 }}
            >
              <span className={styles.stampLabel}>{s.label}</span>
              <span className={styles.stampSub}>{s.sub}</span>
            </motion.div>
          ))}
        </div>

        <div className={styles.cardFooter}>
          <span className={styles.cardSerial}>SUW · PASSPORT · TOKYO2026</span>
          <span className={styles.cardMrz}>P&lt;SUWAPPU&lt;&lt;AGENT&lt;&lt;{agentId.toUpperCase().slice(0, 12)}</span>
        </div>
      </motion.div>
    </div>
  );
}
