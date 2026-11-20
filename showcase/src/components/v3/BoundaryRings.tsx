import Live from './Live';

/**
 * BoundaryRings: concentric authority rings (a key at the centre, policy rings
 * around it, one orbiting approval). Decorative backdrop for security copy.
 */
export default function BoundaryRings({ className = '' }: { className?: string }) {
  return (
    <Live className={`v3-boundary ${className}`.trim()}>
      <svg viewBox="0 0 400 400" role="presentation" focusable="false" fill="none">
        {[60, 110, 160, 195].map((r, i) => (
          <circle key={r} cx="200" cy="200" r={r} stroke="var(--v3-line-strong)" strokeDasharray={i % 2 ? '3 7' : undefined} pathLength={100}
            className={i % 2 ? undefined : 'v3-draw'} style={{ '--v3-d': `${i * 0.25}s` } as React.CSSProperties} />
        ))}
        <g className="v3-spin" style={{ '--v3-spin': '60s' } as React.CSSProperties}>
          <circle cx="200" cy="40" r="6" fill="var(--v3-accent)" />
          <circle cx="200" cy="40" r="14" stroke="var(--v3-accent)" opacity="0.35" />
        </g>
        <g className="v3-spin" style={{ '--v3-spin': '90s', animationDirection: 'reverse' } as React.CSSProperties}>
          <circle cx="90" cy="200" r="4.5" fill="var(--v3-cool)" />
        </g>
        <circle cx="200" cy="200" r="5" fill="var(--v3-accent)" />
      </svg>
    </Live>
  );
}
