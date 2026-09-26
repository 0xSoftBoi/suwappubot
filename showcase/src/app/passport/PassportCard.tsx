'use client';

import { useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle } from '@phosphor-icons/react';
import styles from './passport.module.css';

const EASE = [0.22, 1, 0.36, 1] as const;

const ISSUED = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
}).format(new Date());

/**
 * The passport artifact: an elegant identity object, not a "passport" prop.
 * Two modes:
 *  - specimen: shown in the hero before the flow starts — dimmed, blurred,
 *    a placeholder name, no sheen interaction. Shares layoutId with the real
 *    card so framer-motion can morph one into the other on success.
 *  - real: the live result, with the agent's real name and a holographic
 *    sheen that tracks pointer position (mouse) or scroll (touch), disabled
 *    entirely under reduced motion.
 */
export default function PassportCard({
  agentName,
  returning = false,
  specimen = false,
}: {
  agentName: string;
  returning?: boolean;
  specimen?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);

  const dotIndex = agentName.indexOf('.');
  const label = dotIndex === -1 ? agentName : agentName.slice(0, dotIndex);
  const parent = dotIndex === -1 ? null : agentName.slice(dotIndex);

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (reduceMotion || specimen) return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty('--holo-x', `${x}%`);
    el.style.setProperty('--holo-y', `${y}%`);
  }

  function handlePointerLeave() {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--holo-x', '50%');
    el.style.setProperty('--holo-y', '30%');
  }

  return (
    <motion.div
      ref={cardRef}
      layoutId="passport-artifact"
      className={styles.resultCard}
      data-specimen={specimen || undefined}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      initial={reduceMotion ? { opacity: specimen ? 0.5 : 0 } : { opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: specimen ? 1 : 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: EASE }}
    >
      <span className={styles.holoSheen} aria-hidden="true" />
      <span className={styles.resultKicker}>
        {specimen ? "Your agent's passport" : returning ? 'Welcome back — your passport is active' : "Your agent's passport"}
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
      <span className={styles.resultIssued}>Issued {ISSUED}</span>
    </motion.div>
  );
}
