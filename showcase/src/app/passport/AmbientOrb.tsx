'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import styles from './passport.module.css';
import orbStyles from './orb.module.css';
import LivingOrbGL from './LivingOrbGL';

export type OrbState = 'idle' | 'thinking' | 'success' | 'error';

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * A single living orb — the page's only "hero visual". A raw-WebGL fragment
 * shader (LivingOrbGL) paints a lit, noise-flowing volume with a fresnel rim
 * and inner glow; `state` eases the shader's mood over ~800ms. Falls back to
 * a static CSS radial-gradient orb (single frame, no animation) when WebGL2
 * is unavailable or the user prefers reduced motion — same stage sizing
 * either way, so layout never shifts.
 */
export default function AmbientOrb({ state }: { state: OrbState }) {
  const reduceMotion = useReducedMotion();
  const [glSupported, setGlSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setGlSupported(hasWebGL2());
  }, []);

  const useGL = !reduceMotion && glSupported;

  return (
    <div className={styles.orbStage} aria-hidden="true">
      <div className={orbStyles.stage}>
        {useGL ? (
          <LivingOrbGL state={state} />
        ) : (
          <div className={orbStyles.fallback} data-state={state} />
        )}
      </div>
    </div>
  );
}
