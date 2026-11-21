import Live from './Live';

/**
 * BoundaryRings: concentric authority rings (a key at the centre, policy rings
 * around it, one orbiting approval). Decorative backdrop for security copy.
 */
export default function BoundaryRings({ className = '', labels, quiet = false }: { className?: string; labels?: string[]; quiet?: boolean }) {
  // labels: one noun per ring, innermost first (centre label = labels[0]); quiet: rings only, no orbiting dots
  return (
    <Live className={`v3-boundary ${className}`.trim()}>
      <svg viewBox="0 0 400 400" role="presentation" focusable="false" fill="none">
        {[60, 110, 160, 195].map((r, i) => (
          <circle key={r} cx="200" cy="200" r={r} stroke="var(--v3-line-strong)" strokeDasharray={i % 2 ? '3 7' : undefined} pathLength={100}
            className={i % 2 ? undefined : 'v3-draw'} style={{ '--v3-d': `${i * 0.25}s` } as React.CSSProperties} />
        ))}
        {!quiet && !labels && (<>
        <g className="v3-spin" style={{ '--v3-spin': '60s' } as React.CSSProperties}>
          <circle cx="200" cy="40" r="6" fill="var(--v3-accent)" />
          <circle cx="200" cy="40" r="14" stroke="var(--v3-accent)" opacity="0.35" />
        </g>
        <g className="v3-spin" style={{ '--v3-spin': '90s', animationDirection: 'reverse' } as React.CSSProperties}>
          <circle cx="90" cy="200" r="4.5" fill="var(--v3-cool)" />
        </g></>)}
        {labels && [60, 110, 160, 195].map((r, i) => labels[i + 1] ? (
          <text key={r} x="200" y={200 - r + 4} textAnchor="middle" fontSize="11" fill="var(--v3-ink)" stroke="var(--v3-surface, #0b0d12)" strokeWidth="5" paintOrder="stroke" style={{ fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.1em', fontWeight: 600 }}>{labels[i + 1].toUpperCase()}</text>
        ) : null)}
        <circle cx="200" cy="200" r="5" fill="var(--v3-accent)" />
        {labels?.[0] && <text x="200" y="224" textAnchor="middle" fontSize="11" fill="var(--v3-accent)" style={{ fontFamily: 'var(--v3-font-mono)', letterSpacing: '0.1em', fontWeight: 600 }}>{labels[0].toUpperCase()}</text>}
      </svg>
    </Live>
  );
}
