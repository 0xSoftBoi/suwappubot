'use client';

import { useEffect, useState } from 'react';
import { JOURNEYS } from './SectionField';

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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      setJ(Math.floor(t / CYCLE) % JOURNEYS.length);
      const p = (t % CYCLE) / CYCLE;
      setStage(p < 0.28 ? 0 : p < 0.72 ? 1 : 2);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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
            <span className="stages__kind">{leg.kind}</span>
            <span className="stages__venue">{leg.venue}</span>
            <span className="stages__note">{leg.note}</span>
          </li>
        ))}
      </ol>
      <p className="stages__foot">one signature, three stages</p>
    </div>
  );
}
