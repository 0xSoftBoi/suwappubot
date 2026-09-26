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

  // Split "f4c68576.suwappu-agents.eth" into the unique label and the shared
  // parent domain so the parent (which has a hyphen) wraps on its own line
  // and never breaks mid-word.
  const dotIndex = agentName.indexOf('.');
  const label = dotIndex === -1 ? agentName : agentName.slice(0, dotIndex);
  const parent = dotIndex === -1 ? null : agentName.slice(dotIndex);

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
      <h2 className={styles.resultName}>
        <span className={styles.resultLabel}>{label}</span>
        {parent && <span className={styles.resultParent}>{parent}</span>}
      </h2>
      <ul className={styles.resultChecks}>
        <li>
          <CheckCircle weight="fill" size={18} />
          Verified human owner
        </li>
        <li>
          <CheckCircle weight="fill" size={18} />
          Trades can require a verified human
        </li>
      </ul>
    </motion.div>
  );
}
