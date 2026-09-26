'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Check } from '@phosphor-icons/react';
import styles from './passport.module.css';

const EASE = [0.22, 1, 0.36, 1] as const;

/** Step 1 — a scan ring that draws itself. */
function ScanRingIllustration({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" fill="none">
      <circle cx="60" cy="60" r="34" stroke="rgba(244,244,246,0.14)" strokeWidth="2" />
      <motion.circle
        cx="60"
        cy="60"
        r="34"
        stroke="var(--sw-accent-bright)"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        initial={{ strokeDashoffset: 1 }}
        whileInView={{ strokeDashoffset: 0 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 1.4, ease: EASE, delay: 0.15 }}
        transform="rotate(-90 60 60)"
      />
      <motion.circle
        cx="60"
        cy="60"
        r="14"
        fill="var(--sw-accent-bright)"
        initial={{ opacity: 0, scale: 0.6 }}
        whileInView={{ opacity: 0.9, scale: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.4, ease: EASE, delay: 1.3 }}
      />
    </svg>
  );
}

/** Step 2 — a name types in character by character. */
function NameTypeIllustration({ reduceMotion }: { reduceMotion: boolean }) {
  const text = 'amber-kite';
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" fill="none">
      <rect x="10" y="52" width="100" height="16" rx="8" fill="rgba(255,255,255,0.05)" />
      <motion.text
        x="60"
        y="64"
        textAnchor="middle"
        fontFamily="var(--font-mono)"
        fontSize="11"
        fill="var(--sw-accent-bright)"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 0.2 }}
      >
        {reduceMotion ? (
          text
        ) : (
          <>
            {text.split('').map((ch, i) => (
              <motion.tspan
                key={i}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.05, delay: i * 0.06 }}
              >
                {ch}
              </motion.tspan>
            ))}
          </>
        )}
      </motion.text>
      <motion.rect
        x="14"
        y="54"
        width="2"
        height="12"
        fill="var(--sw-accent-bright)"
        initial={{ opacity: 1 }}
        whileInView={{ x: [14, 106], opacity: [1, 1, 0] }}
        viewport={{ once: true, amount: 0.6 }}
        transition={reduceMotion ? { duration: 0 } : { duration: text.length * 0.06 + 0.2, ease: 'linear' }}
      />
    </svg>
  );
}

/** Step 3 — a gate that closes, then opens when a check mark lands. */
function GateIllustration({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%" fill="none">
      <motion.rect
        x="18"
        y="30"
        width="12"
        height="60"
        rx="3"
        fill="rgba(244,244,246,0.5)"
        initial={{ x: 18 }}
        whileInView={{ x: [18, 42, 18] }}
        viewport={{ once: true, amount: 0.6 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 1.6, ease: EASE, times: [0, 0.45, 1] }}
      />
      <motion.rect
        x="90"
        y="30"
        width="12"
        height="60"
        rx="3"
        fill="rgba(244,244,246,0.5)"
        initial={{ x: 90 }}
        whileInView={{ x: [90, 66, 90] }}
        viewport={{ once: true, amount: 0.6 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 1.6, ease: EASE, times: [0, 0.45, 1] }}
      />
      <motion.g
        initial={{ opacity: 0, scale: 0.5 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: EASE, delay: 1.1 }}
      >
        <circle cx="60" cy="60" r="16" fill="var(--sw-accent-bright)" opacity="0.15" />
        <foreignObject x="46" y="46" width="28" height="28">
          <Check weight="bold" size={20} color="var(--sw-accent-bright)" />
        </foreignObject>
      </motion.g>
    </svg>
  );
}

const STEPS = [
  {
    id: 'human',
    title: 'Prove you’re human',
    sub: 'A quick, private check confirms a real person is behind the agent.',
    Illustration: ScanRingIllustration,
  },
  {
    id: 'name',
    title: 'Your agent gets a name',
    sub: 'That proof becomes a permanent identity your agent carries everywhere.',
    Illustration: NameTypeIllustration,
  },
  {
    id: 'gate',
    title: 'Trades can require you',
    sub: 'Sensitive trades can be gated on that same verified identity.',
    Illustration: GateIllustration,
  },
] as const;

export default function HowItWorks() {
  const reduceMotion = !!useReducedMotion();

  return (
    <section className={styles.howItWorks} aria-labelledby="how-it-works-title">
      <div className={styles.howItWorksHead}>
        <h2 id="how-it-works-title" className={styles.howItWorksTitle}>
          How it works
        </h2>
        <p className={styles.howItWorksSub}>Three steps, once.</p>
      </div>

      <div className={styles.steps}>
        {STEPS.map(({ id, title, sub, Illustration }) => (
          <motion.div
            key={id}
            className={styles.step}
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.4 }}
            transition={{ duration: 0.5, ease: EASE }}
          >
            <div className={styles.stepStage}>
              <Illustration reduceMotion={reduceMotion} />
            </div>
            <h3 className={styles.stepTitle}>{title}</h3>
            <p className={styles.stepSub}>{sub}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
