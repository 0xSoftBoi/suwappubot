'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle } from '@phosphor-icons/react';
import styles from './passport.module.css';

/**
 * The end state: a calm result card, not a "passport" prop. Shows the
 * agent's real ENS name plus the two guarantees a person actually cares
 * about — a human owns it, and its trades are protected. No stamps, no
 * foil, no MRZ line.
 */
export default function ResultCard({
  agentName,
  returning = false,
}: {
  agentName: string;
  returning?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={styles.resultCard}
      layout
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className={styles.resultKicker}>
        {returning ? 'Welcome back — your passport is active' : 'Your agent’s passport'}
      </span>
      <h2 className={styles.resultName}>{agentName}</h2>
      <ul className={styles.resultChecks}>
        <li>
          <CheckCircle weight="fill" size={18} />
          Verified human owner
        </li>
        <li>
          <CheckCircle weight="fill" size={18} />
          Protected trading enabled
        </li>
      </ul>
    </motion.div>
  );
}
