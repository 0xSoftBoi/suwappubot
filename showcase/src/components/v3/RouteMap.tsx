import Live from './Live';

/**
 * RouteMap: cross-chain schematic. Chain nodes, faint links that draw on, one
 * highlighted route with a travelling pulse and a bridge waypoint.
 * Diagram only: node names are chains Suwappu supports; no prices or volumes.
 * `route` picks the highlighted pair (defaults Base -> Solana via CCTP).
 */
const NODES: Record<string, { x: number; y: number }> = {
  Arbitrum: { x: 100, y: 90 },
  HyperLiquid: { x: 424, y: 80 },
  Ethereum: { x: 258, y: 158 },
  Base: { x: 62, y: 300 },
  Tempo: { x: 196, y: 392 },
  Polygon: { x: 352, y: 352 },
  Solana: { x: 452, y: 252 },
};

const LINKS: [string, string][] = [
  ['Arbitrum', 'Ethereum'], ['Ethereum', 'HyperLiquid'], ['Ethereum', 'Solana'],
  ['Base', 'Ethereum'], ['Base', 'Arbitrum'], ['Tempo', 'Base'],
  ['Tempo', 'Polygon'], ['Polygon', 'Solana'], ['HyperLiquid', 'Solana'], ['Ethereum', 'Polygon'],
];

const ROUTE = 'M62,300 C180,262 340,232 452,252';

export default function RouteMap({ bridge = 'CCTP', className = '' }: { bridge?: string; className?: string }) {
  return (
    <Live className={`v3-routemap ${className}`.trim()}>
      <svg viewBox="0 0 520 440" role="presentation" focusable="false">
        <g fill="none" stroke="var(--v3-line-strong)" strokeWidth="1.2">
          {LINKS.map(([a, b], i) => {
            const p = NODES[a];
            const q = NODES[b];
            const mx = (p.x + q.x) / 2 + (i % 2 ? 18 : -18);
            const my = (p.y + q.y) / 2 + (i % 3 ? -14 : 14);
            return (
              <path key={a + b} d={`M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`} pathLength={100}
                className="v3-draw" style={{ '--v3-d': `${0.2 + i * 0.12}s` } as React.CSSProperties} />
            );
          })}
        </g>
        <path d={ROUTE} pathLength={100} fill="none" stroke="var(--v3-accent)" strokeWidth="2.4" strokeLinecap="round"
          className="v3-draw" style={{ '--v3-d': '1.2s', '--v3-dur': '1.8s' } as React.CSSProperties} />
        <path d={ROUTE} pathLength={100} className="v3-pulse" style={{ '--v3-d': '3s' } as React.CSSProperties} />

        {Object.entries(NODES).map(([name, { x, y }], i) => {
          const hot = name === 'Base' || name === 'Solana';
          return (
            <g key={name} className="v3-pop" style={{ '--v3-d': `${0.1 + i * 0.1}s` } as React.CSSProperties}>
              {hot ? <circle cx={x} cy={y} r="14" fill="var(--v3-accent)" className="v3-breathe" /> : null}
              <circle cx={x} cy={y} r="6.5" fill="var(--v3-surface-hi)" stroke={hot ? 'var(--v3-accent)' : 'var(--v3-dim)'} strokeWidth="1.6" />
              <circle cx={x} cy={y} r="2.4" fill={hot ? 'var(--v3-accent)' : 'var(--v3-dim)'} />
              <text x={x} y={y + 26} textAnchor="middle" className={`v3-svg-label${hot ? ' v3-svg-label--hot' : ''}`}>{name}</text>
            </g>
          );
        })}

        <g className="v3-pop" style={{ '--v3-d': '1.8s' } as React.CSSProperties}>
          <rect x="226" y="230" width="68" height="26" rx="13" fill="var(--v3-surface-hi)" stroke="var(--v3-accent)" strokeWidth="1.2" />
          <text x="260" y="247.5" textAnchor="middle" className="v3-svg-label v3-svg-label--hot" style={{ fontSize: 12 }}>{bridge}</text>
        </g>
      </svg>
    </Live>
  );
}
