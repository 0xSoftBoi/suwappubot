import type { CSSProperties } from 'react';
import Live from './Live';

/**
 * DeadEnd: a route that found no path (404). Known stops draw on in sequence,
 * the last hop breaks into a dashed gap and ends in a hollow accent node.
 * `stops` are real route names (caller-supplied), `miss` the label of the dead end.
 */
const D = (s: number) => ({ '--v3-d': `${s}s` }) as CSSProperties;
const MONO = { fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.08em' } as const;

export default function DeadEnd({ stops, miss }: { stops: string[]; miss: string }) {
  const n = stops.length;
  const W = 420, gap = (W - 60) / n;
  const xs = [...stops.map((_, i) => 30 + i * gap), 30 + n * gap];
  const y = 70;
  return (
    <Live className="v3-deadend">
      <svg viewBox={`0 0 ${W} 140`} role="presentation" focusable="false" fill="none">
        {stops.map((s, i) => (
          <g key={s}>
            <path d={`M${xs[i]},${y}H${i < n - 1 ? xs[i + 1] : xs[n] - gap * 0.55}`} stroke="var(--v3-line-strong)" strokeWidth="1.4" pathLength={100} className="v3-draw" style={D(0.2 + i * 0.35)} />
            {i === 0 && <path d={`M${xs[0]},${y}H${xs[1]}`} pathLength={100} className="v3-pulse" style={{ ...D(0), strokeWidth: 2.5 }} />}
            <circle cx={xs[i]} cy={y} r="6" fill="var(--v3-surface-hi)" stroke="var(--v3-ink)" strokeWidth="1.3" className="v3-pop" style={D(i * 0.3)} />
            <text x={xs[i]} y={y + 28} textAnchor="middle" fontSize="10" fill="var(--v3-dim)" style={MONO}>{s.toUpperCase()}</text>
          </g>
        ))}
        <path d={`M${xs[n] - gap * 0.4},${y}H${xs[n] - 14}`} stroke="var(--v3-accent)" strokeWidth="1.4" strokeDasharray="3 5" />
        <circle cx={xs[n]} cy={y} r="10" fill="none" stroke="var(--v3-accent)" strokeWidth="1.6" strokeDasharray="3 3" className="v3-pop" style={D(1.4)} />
        <path d={`M${xs[n] - 4},${y - 4}l8,8M${xs[n] + 4},${y - 4}l-8,8`} stroke="var(--v3-accent)" strokeWidth="1.6" strokeLinecap="round" />
        <text x={xs[n]} y={y + 32} textAnchor="middle" fontSize="11" fill="var(--v3-accent)" style={{ ...MONO, fontWeight: 700 }}>{miss}</text>
      </svg>
    </Live>
  );
}
