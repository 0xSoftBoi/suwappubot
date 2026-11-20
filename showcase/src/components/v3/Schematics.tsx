import Live from './Live';
import type { CSSProperties } from 'react';

/**
 * Schematics: small labelled diagrams for sales/trust pages. All decorative
 * (inside <Live>: aria-hidden, paused off-screen, static under reduced motion),
 * tone-aware via --v3-* vars, labels are caller-supplied nouns only, no numbers.
 *
 *   <AuthorityFlow lanes={[['Your keys','Unsigned tx','Chain'], ['Managed','Policy','Chain']]} />
 *     horizontal lanes of nodes joined by a travelling pulse; middle node is the accent "gate".
 *   <EvidenceStack items={['Status','Changelog',…]} />
 *     stacked document bars that draw in, each with a verified tick.
 *   <TierLadder steps={['Self-serve','Enterprise']} />
 *     ascending steps; last one lit (accent).
 */
const D = (s: number) => ({ '--v3-d': `${s}s` }) as CSSProperties;
const MONO = { fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.06em' } as const;

export function AuthorityFlow({ lanes }: { lanes: string[][] }) {
  const laneH = 78;
  const H = lanes.length * laneH + 20;
  return (
    <Live className="v3-schem">
      <svg viewBox={`0 0 420 ${H}`} role="presentation" focusable="false" fill="none">
        {lanes.map((lane, li) => {
          const y = 10 + li * laneH + laneH / 2 - 10;
          const w = 104, gap = (420 - lane.length * w) / (lane.length - 1);
          return (
            <g key={li}>
              {lane.map((label, i) => {
                const x = i * (w + gap);
                const gate = i === 1;
                return (
                  <g key={i}>
                    {i > 0 && (
                      <>
                        <path d={`M${x - gap},${y + 22}H${x}`} stroke="var(--v3-line-strong)" pathLength={100} className="v3-draw" style={D(0.2 + li * 0.2 + i * 0.3)} />
                        <path d={`M${x - gap},${y + 22}H${x}`} pathLength={100} className="v3-pulse" style={{ ...D(li), strokeWidth: 2.5 }} />
                      </>
                    )}
                    <rect x={x} y={y} width={w} height="44" rx="10" fill="var(--v3-surface-hi)" stroke={gate ? 'var(--v3-accent)' : 'var(--v3-line-strong)'} strokeWidth={gate ? 1.6 : 1} className="v3-pop" style={D(i * 0.25 + li * 0.15)} />
                    <text x={x + w / 2} y={y + 26} textAnchor="middle" fontSize="11" fill={gate ? 'var(--v3-accent)' : 'var(--v3-ink)'} style={MONO}>{label.toUpperCase()}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </Live>
  );
}

export function EvidenceStack({ items }: { items: string[] }) {
  const rowH = 46;
  return (
    <Live className="v3-schem">
      <svg viewBox={`0 0 420 ${items.length * rowH + 8}`} role="presentation" focusable="false" fill="none">
        {items.map((label, i) => {
          const y = 4 + i * rowH;
          return (
            <g key={label}>
              <rect x="0" y={y} width="420" height="38" rx="9" fill="var(--v3-surface-hi)" stroke="var(--v3-line-strong)" className="v3-pop" style={D(i * 0.15)} />
              <text x="16" y={y + 24} fontSize="11" fill="var(--v3-ink)" style={MONO}>{label.toUpperCase()}</text>
              <path d={`M170,${y + 19}H${340 - (i % 3) * 30}`} stroke="var(--v3-line-strong)" strokeDasharray="2 5" pathLength={100} className="v3-draw" style={D(0.3 + i * 0.15)} />
              <circle cx="396" cy={y + 19} r="9" fill="none" stroke="var(--v3-accent)" className="v3-pop" style={D(0.5 + i * 0.15)} />
              <path d={`M391.5,${y + 19}l3.2,3.2l6-6.4`} stroke="var(--v3-accent)" strokeWidth="1.8" pathLength={100} className="v3-draw" style={D(0.7 + i * 0.15)} />
            </g>
          );
        })}
      </svg>
    </Live>
  );
}

export function TierLadder({ steps }: { steps: string[] }) {
  const n = steps.length;
  const w = 420 / n;
  return (
    <Live className="v3-schem">
      <svg viewBox="0 0 420 220" role="presentation" focusable="false" fill="none">
        {steps.map((label, i) => {
          const h = 70 + (i * 110) / Math.max(1, n - 1);
          const last = i === n - 1;
          return (
            <g key={label} className="v3-pop" style={D(i * 0.3)}>
              <rect x={i * w + 6} y={214 - h} width={w - 12} height={h} rx="10" fill={last ? 'var(--v3-glow)' : 'var(--v3-surface-hi)'} stroke={last ? 'var(--v3-accent)' : 'var(--v3-line-strong)'} />
              <text x={i * w + w / 2} y={214 - h + 28} textAnchor="middle" fontSize="11" fill={last ? 'var(--v3-accent)' : 'var(--v3-ink)'} style={MONO}>{label.toUpperCase()}</text>
            </g>
          );
        })}
      </svg>
    </Live>
  );
}
