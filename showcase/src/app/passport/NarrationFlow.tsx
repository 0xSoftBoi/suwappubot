'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import styles from './passport.module.css';

export type NarrationState = 'active' | 'done' | 'error' | 'unavailable';

export type NarrationLine = {
  id: string;
  text: string;
  state: NarrationState;
};

function Check({ animate }: { animate: boolean }) {
  return (
    <svg className={styles.checkIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <motion.path
        d="M5 12.5L10 17L19 7.5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0, opacity: 0 } : false}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

/**
 * The agent "narrating" its own onboarding, one real state transition at a
 * time. Every line maps to actual usePassportFlow/evidence state — nothing
 * here is a timer pretending success.
 */
export default function NarrationFlow({ lines }: { lines: NarrationLine[] }) {
  const reduceMotion = useReducedMotion();

  return (
    <ul className={styles.narration} aria-live="polite">
      <AnimatePresence initial={false}>
        {lines.map((line) => (
          <motion.li
            key={line.id}
            className={styles.narrationLine}
            data-state={line.state}
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className={styles.narrationMark}>
              {line.state === 'done' ? (
                <Check animate={!reduceMotion} />
              ) : line.state === 'active' ? (
                <span className={styles.narrationSpinner} />
              ) : line.state === 'error' ? (
                <span className={styles.narrationDotError} />
              ) : (
                <span className={styles.narrationDotMuted} />
              )}
            </span>
            <span className={styles.narrationText}>{line.text}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
