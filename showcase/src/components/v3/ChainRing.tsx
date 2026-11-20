import Live from './Live';
import type { ReactNode } from 'react';

/**
 * ChainRing: portfolio-composition donut. Segments draw on; a fine tick ring
 * turns slowly. Segment sizes are illustrative (no numbers shown); names are
 * supported chains. `children` renders in the hole (e.g. a CountUp).
 */
const SEGS = [
  { name: 'Ethereum', v: 31, c: 'var(--v3-cool)' },
  { name: 'Base', v: 24, c: 'var(--v3-accent)' },
  { name: 'Solana', v: 19, c: 'var(--v3-good)' },
  { name: 'Arbitrum', v: 15, c: 'color-mix(in srgb, var(--v3-cool) 55%, var(--v3-ink))' },
  { name: 'HyperLiquid', v: 11, c: 'color-mix(in srgb, var(--v3-accent) 55%, var(--v3-ink))' },
];

export default function ChainRing({ children }: { children?: ReactNode }) {
  const gap = 1.2;
  let acc = 0;
  return (
    <div className="v3-ring">
      <Live className="v3-ring__gfx">
        <svg viewBox="0 0 360 360" role="presentation" focusable="false">
          <g className="v3-spin" style={{ '--v3-spin': '120s' } as React.CSSProperties}>
            <circle cx="180" cy="180" r="172" fill="none" stroke="var(--v3-line-strong)" strokeWidth="6" strokeDasharray="1 7.5" />
          </g>
          <circle cx="180" cy="180" r="148" fill="none" stroke="var(--v3-line)" strokeWidth="1" />
          <g transform="rotate(-90 180 180)">
            {SEGS.map((s, i) => {
              const start = acc;
              acc += s.v;
              return (
                <circle key={s.name} cx="180" cy="180" r="118" fill="none" stroke={s.c} strokeWidth="26" pathLength={100}
                  strokeDasharray={`${s.v - gap} ${100 - s.v + gap}`} strokeDashoffset={-start}
                  className="v3-ring__seg" style={{ '--v3-d': `${0.2 + i * 0.18}s` } as React.CSSProperties} />
              );
            })}
          </g>
          <circle cx="180" cy="180" r="94" fill="none" stroke="var(--v3-line)" strokeWidth="1" />
        </svg>
      </Live>
      <div className="v3-ring__center">{children}</div>
      <ul className="v3-ring__legend" aria-hidden="true">
        {SEGS.map((s) => (
          <li key={s.name}><i style={{ background: s.c }} />{s.name}</li>
        ))}
      </ul>
    </div>
  );
}
