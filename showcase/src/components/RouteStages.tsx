'use client';

import { useEffect, useState } from 'react';

import { pauseWhenHidden } from '@/lib/frameBudget';
import { subscribeMotionPreference } from '@/lib/motionPreference';

import { JOURNEYS } from './ChainSphereGL';

/**
 * RouteStages: the stage readout beside the sphere.
 *
 * A cross-chain swap is never one hop: the source asset is swapped on its own
 * chain, bridged, then swapped again on the destination. The sphere shows the
 * geometry; this names the stages, and the two stay in step by sharing the
 * same 7200ms cycle.
 *
 * The bridge leg is deliberately not pinned to a named provider: real quotes
 * pick a different bridge per corridor, so naming one here would be invented.
 */
const CYCLE = 7200;

export default function RouteStages() {
  const [j, setJ] = useState(0);
  const [stage, setStage] = useState(0);

  useEffect(() => {
    let raf = 0;
    // Last values written to React, held in refs. The loop samples every frame but
    // only calls setState when a value actually changes: the previous version pushed
    // two state updates per frame, re-rendering this subtree 120 times a second to
    // display a journey index that changes once every few seconds and a stage that
    // changes three times per cycle. That is Tektonic's ref-based-updates rule -
    // sample at frame rate, render at the rate the output changes.
    let lastJ = -1;
    let lastStage = -1;

    const tick = () => {
      // Nothing to schedule against while the tab is hidden.
      if (document.hidden) return;
      const t = performance.now();
      const nextJ = Math.floor(t / CYCLE) % JOURNEYS.length;
      const p = (t % CYCLE) / CYCLE;
      const nextStage = p < 0.28 ? 0 : p < 0.72 ? 1 : 2;

      if (nextJ !== lastJ) { lastJ = nextJ; setJ(nextJ); }
      if (nextStage !== lastStage) { lastStage = nextStage; setStage(nextStage); }

      raf = requestAnimationFrame(tick);
    };

    const motion = subscribeMotionPreference((reduce) => {
      cancelAnimationFrame(raf);
      if (!reduce) raf = requestAnimationFrame(tick);
    });
    if (!motion.reduce) raf = requestAnimationFrame(tick);

    const detachVisibility = pauseWhenHidden(() => {
      if (motion.reduce) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(raf);
      detachVisibility();
      motion.detach();
    };
  }, []);

  const journey = JOURNEYS[j];

  return (
    <div className="stages" aria-hidden="true">
      <div className="stages__head">
        <span className="stages__tok">{journey.fromToken}</span>
        <span className="stages__chain">{journey.fromChain}</span>
        <span className="stages__arrow">→</span>
        <span className="stages__tok">{journey.toToken}</span>
        <span className="stages__chain">{journey.toChain}</span>
      </div>
      <ol className="stages__list">
        {journey.legs.map((leg, i) => (
          <li key={i} className={i === stage ? 'stages__on' : undefined}>
            <span className="stages__n">{String(i + 1).padStart(2, '0')}</span>
            <span className={`stages__kind stages__kind--${leg.kind}`}>{leg.kind}</span>
            <span className="stages__venue">{leg.venue}</span>
            <span className="stages__note">{leg.note}</span>
          </li>
        ))}
      </ol>
      <p className="stages__foot">one signature, three stages</p>
    </div>
  );
}
