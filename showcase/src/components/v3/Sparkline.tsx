import Live from './Live';

/**
 * Sparkline / SparkCard: illustrative signal traces (deterministic from
 * `seed`, never real data, no values shown). kinds:
 *   line  - area + stroke that draws on, ending in a breathing dot
 *   bars  - candle-like bars rising in sequence
 *   ticks - baseline with event pings (launch detection)
 * <SparkCard title="…" body="…" kind seed /> is a ready-made glass card.
 */
type Kind = 'line' | 'bars' | 'ticks';
const W = 240;
const H = 80;

function series(seed: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const v = 0.5 - 0.22 * Math.sin(i * 0.55 + seed) - 0.12 * Math.sin(i * 1.4 + seed * 2.3) - 0.14 * (t - 0.5);
    return +(H * Math.min(0.9, Math.max(0.12, v))).toFixed(1);
  });
}

export function Sparkline({ kind = 'line', seed = 1 }: { kind?: Kind; seed?: number }) {
  const n = kind === 'bars' ? 28 : 30;
  const ys = series(seed, n);
  const xs = ys.map((_, i) => +((i / (n - 1)) * W).toFixed(1));
  const d = ys.map((y, i) => `${i ? 'L' : 'M'}${xs[i]},${y}`).join(' ');
  const id = `sg${seed}${kind}`;
  return (
    <Live className="v3-spark">
      <svg viewBox={`0 0 ${W} ${H}`} role="presentation" focusable="false">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--v3-cool)" stopOpacity="0.38" />
            <stop offset="1" stopColor="var(--v3-cool)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g stroke="var(--v3-line)" strokeWidth="1">
          {[20, 40, 60].map((y) => <path key={y} d={`M0,${y}H${W}`} strokeDasharray="2 5" />)}
        </g>
        {kind === 'line' ? (
          <>
            <path d={`${d} L${W},${H} L0,${H}Z`} fill={`url(#${id})`} className="v3-spark__area" />
            <path d={d} pathLength={100} fill="none" stroke="var(--v3-cool)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="v3-draw" style={{ '--v3-dur': '2s' } as React.CSSProperties} />
            <circle cx={xs[n - 1]} cy={ys[n - 1]} r="9" fill="var(--v3-accent)" opacity="0.25" className="v3-breathe" />
            <circle cx={xs[n - 1]} cy={ys[n - 1]} r="3.4" fill="var(--v3-accent)" />
          </>
        ) : null}
        {kind === 'bars' ? (
          <g>
            {ys.map((y, i) => (
              <rect key={i} x={xs[i] - 2.6} y={y} width="5.2" height={H - y} rx="1.6"
                fill={i % 5 === 3 ? 'var(--v3-accent)' : 'var(--v3-cool)'} opacity={i % 5 === 3 ? 0.95 : 0.55}
                className="v3-spark__bar" style={{ '--v3-d': `${i * 0.04}s` } as React.CSSProperties} />
            ))}
          </g>
        ) : null}
        {kind === 'ticks' ? (
          <g>
            <path d={`M0,${H - 16}H${W}`} stroke="var(--v3-line-strong)" strokeWidth="1.4" />
            {[34, 78, 109, 152, 201].map((x, i) => (
              <g key={x} className="v3-pop" style={{ '--v3-d': `${0.3 + i * 0.35}s` } as React.CSSProperties}>
                <path d={`M${x},${H - 16}V${22 + (i * 11) % 24}`} stroke="var(--v3-cool)" strokeWidth="1.6" />
                <circle cx={x} cy={22 + (i * 11) % 24} r="9" fill="var(--v3-accent)" opacity="0.22" className="v3-breathe" style={{ '--v3-d': `${i * 0.9}s` } as React.CSSProperties} />
                <circle cx={x} cy={22 + (i * 11) % 24} r="3.4" fill="var(--v3-accent)" />
              </g>
            ))}
          </g>
        ) : null}
      </svg>
    </Live>
  );
}

export function SparkCard({ title, body, kind = 'line', seed = 1 }: { title: string; body: string; kind?: Kind; seed?: number }) {
  return (
    <article className="v3-glass v3-signal">
      <Sparkline kind={kind} seed={seed} />
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
      </div>
    </article>
  );
}
