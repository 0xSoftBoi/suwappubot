import styles from './autopilot.module.css';

export type CyclePoint = {
  id: number;
  equity_usd: number | null;
  started_at: string;
};

/**
 * Equity across recent cycles, as an inline SVG.
 *
 * Deliberately plots only cycles that actually recorded an equity value — a
 * chart that interpolates through missing readings invents a performance
 * history. With fewer than two real points there is nothing to draw, and the
 * component says so rather than drawing a flat line that implies stability.
 */
export default function EquitySparkline({
  cycles,
  startingEquityUsd,
}: {
  cycles: CyclePoint[];
  startingEquityUsd: number;
}) {
  const points = [...cycles]
    .reverse()
    .filter((c): c is CyclePoint & { equity_usd: number } => typeof c.equity_usd === 'number');

  if (points.length < 2) {
    return (
      <div className={styles.chartCard}>
        <div className={styles.chartHead}>
          <h2 className={styles.sectionTitle}>Equity</h2>
          <p className={styles.sectionNote}>
            {points.length === 0 ? 'no completed cycles yet' : 'one cycle so far'}
          </p>
        </div>
        <p className={styles.sectionNote}>
          A curve needs at least two readings. Nothing is drawn until there are.
        </p>
      </div>
    );
  }

  const values = points.map((p) => p.equity_usd);
  const lo = Math.min(...values, startingEquityUsd);
  const hi = Math.max(...values, startingEquityUsd);
  const span = hi - lo || 1;

  const W = 720;
  const H = 120;
  const pad = 6;

  const x = (i: number) => (i / (points.length - 1)) * (W - pad * 2) + pad;
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - pad * 2);

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.equity_usd).toFixed(1)}`)
    .join(' ');
  const baseline = y(startingEquityUsd);
  const last = values[values.length - 1] as number;
  const up = last >= startingEquityUsd;
  const stroke = up ? 'var(--sw-leaf-bright)' : '#E8836F';

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHead}>
        <h2 className={styles.sectionTitle}>Equity</h2>
        <p className={styles.sectionNote}>
          {points.length} cycles · dashed line is starting capital
        </p>
      </div>
      <svg
        className={styles.chartSvg}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Equity across ${points.length} cycles, from $${startingEquityUsd.toFixed(2)} to $${last.toFixed(2)}`}
      >
        <line
          x1={pad}
          x2={W - pad}
          y1={baseline}
          y2={baseline}
          stroke="var(--sw-cosmic-muted)"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.6"
        />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(p.equity_usd)} r="2.5" fill={stroke} />
        ))}
      </svg>
      <div className={styles.chartAxis}>
        <span>{`$${(points[0] as { equity_usd: number }).equity_usd.toFixed(2)}`}</span>
        <span className={up ? styles.up : styles.down}>{`$${last.toFixed(2)}`}</span>
      </div>
    </div>
  );
}
