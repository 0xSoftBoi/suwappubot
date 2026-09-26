'use client';

import { useReducedMotion } from 'framer-motion';
import styles from './passport.module.css';

export type OrbState = 'idle' | 'thinking' | 'success' | 'error';

/**
 * A single soft gradient orb — the page's only "hero visual". Cheap CSS
 * (no canvas, no WebGL): three blurred radial layers animated with
 * transform/opacity. `data-state` swaps the animation preset; reduced
 * motion collapses it to a static glow.
 */
export default function AmbientOrb({ state }: { state: OrbState }) {
  const reduceMotion = useReducedMotion();

  return (
    <div className={styles.orbStage} aria-hidden="true">
      <div
        className={styles.orb}
        data-state={state}
        data-static={reduceMotion ? 'true' : undefined}
      >
        <span className={styles.orbLayer} />
        <span className={styles.orbLayer} />
        <span className={styles.orbCore} />
        <span className={styles.orbSheen} />
      </div>
    </div>
  );
}
