import Live from './Live';
import type { ReactNode } from 'react';

/**
 * ToolOrbit: `count` nodes (pass the real MCP tool count) orbiting one hub on
 * two counter-rotating rings. One remote server, N callable tools, drawn
 * literally. `children` sits in the hub.
 */
export default function ToolOrbit({ count, children }: { count: number; children?: ReactNode }) {
  const inner = Math.round(count * 0.36);
  const outer = count - inner;
  const ring = (n: number, r: number, off: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = off + (i / n) * Math.PI * 2;
      return { x: +(200 + Math.cos(a) * r).toFixed(1), y: +(200 + Math.sin(a) * r).toFixed(1) };
    });
  const a = ring(inner, 92, 0.3);
  const b = ring(outer, 160, 0);
  return (
    <div className="v3-orbit">
      <Live>
        <svg viewBox="0 0 400 400" role="presentation" focusable="false">
          <circle cx="200" cy="200" r="92" fill="none" stroke="var(--v3-line-strong)" strokeDasharray="2 6" />
          <circle cx="200" cy="200" r="160" fill="none" stroke="var(--v3-line)" />
          <g className="v3-spin" style={{ '--v3-spin': '90s', animationDirection: 'reverse' } as React.CSSProperties}>
            {a.map((p, i) => (
              <g key={i}>
                <path d={`M200,200L${p.x},${p.y}`} stroke="var(--v3-line)" />
                <circle cx={p.x} cy={p.y} r="5.5" fill="var(--v3-cool)" />
              </g>
            ))}
          </g>
          <g className="v3-spin" style={{ '--v3-spin': '140s' } as React.CSSProperties}>
            {b.map((p, i) => (
              <g key={i}>
                <path d={`M${p.x},${p.y}L${200 + (p.x - 200) * 0.58},${200 + (p.y - 200) * 0.58}`} stroke="var(--v3-line)" />
                <circle cx={p.x} cy={p.y} r={i % 4 === 0 ? 7 : 4.5} fill={i % 4 === 0 ? 'var(--v3-accent)' : 'var(--v3-dim)'} opacity={i % 4 === 0 ? 1 : 0.8} />
              </g>
            ))}
          </g>
          <circle cx="200" cy="200" r="46" fill="var(--v3-surface-hi)" stroke="var(--v3-accent)" strokeWidth="1.4" />
          <circle cx="200" cy="200" r="58" fill="none" stroke="var(--v3-accent)" opacity="0.3" className="v3-breathe" />
        </svg>
      </Live>
      <div className="v3-orbit__hub">{children}</div>
    </div>
  );
}
