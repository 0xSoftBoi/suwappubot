'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { ARBITER_WASM_HASH } from './data';
import styles from './arbiter.module.css';

/**
 * Hero visual: escrow vault -> sealed enclave -> verdict. A 4-phase loop
 * (fund, evidence, verdict:pass, verdict:fail) drives data attributes; all
 * motion is CSS transitions/keyframes. Reduced motion freezes on "pass".
 */
const PHASES = ['fund', 'evidence', 'pass', 'fund2', 'evidence2', 'fail'] as const;

export default function HeroPipeline() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(2);

  useEffect(() => {
    if (reduce) {
      setI(2);
      return;
    }
    setI(0);
    const t = setInterval(() => setI((n) => (n + 1) % PHASES.length), 1700);
    return () => clearInterval(t);
  }, [reduce]);

  const phase = PHASES[i];
  const outcome = phase === 'fail' || phase === 'fund2' || phase === 'evidence2' ? 'fail' : 'pass';
  const stage = phase.startsWith('fund') ? 0 : phase.startsWith('evidence') ? 1 : 2;

  return (
    <div className={styles.pipe} data-stage={stage} data-outcome={outcome} aria-hidden="true">
      <div className={styles.pipeNode} data-active={stage === 0}>
        <span className={styles.pipeKicker}>1 · Escrow</span>
        <div className={styles.vault}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
            <path d={stage >= 1 ? 'M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7' : 'M8.5 10.5V7.8a3.5 3.5 0 0 1 6.6-1.6'} />
          </svg>
          <b>0.1 NEAR</b>
        </div>
        <span className={styles.pipeMeta}>locked vs. terms</span>
      </div>

      <div className={styles.link}>
        <span className={styles.linkTrack} />
        <span className={styles.linkDot} data-on={stage === 1} />
        <span className={styles.linkLabel}>signed evidence</span>
      </div>

      <div className={`${styles.pipeNode} ${styles.enclave}`} data-active={stage === 1}>
        <span className={styles.pipeKicker}>2 · Sealed arbiter</span>
        <div className={styles.seal}>
          <span className={styles.sealRing} />
          <span className={styles.sealRing2} />
          <span className={styles.sealCore}>TDX</span>
        </div>
        <span className={styles.pipeMeta}>wasm {ARBITER_WASM_HASH.slice(0, 8)}…{ARBITER_WASM_HASH.slice(-4)}</span>
      </div>

      <div className={styles.link}>
        <span className={styles.linkTrack} />
        <span className={styles.linkDot} data-on={stage === 2} data-beam />
        <span className={styles.linkLabel}>verdict</span>
      </div>

      <div className={`${styles.pipeNode} ${styles.verdictNode}`} data-active={stage === 2}>
        <span className={styles.pipeKicker}>3 · Settlement</span>
        <div className={styles.verdictBadge} data-show={stage === 2}>
          {outcome === 'pass' ? 'PASS' : 'FAIL'}
        </div>
        <span className={styles.pipeMeta}>
          {stage < 2 ? 'awaiting verdict' : outcome === 'pass' ? 'worker paid' : 'no transfer'}
        </span>
      </div>
    </div>
  );
}
