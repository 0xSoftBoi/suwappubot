import type { AgentStats } from './types';
import styles from './autopilot.module.css';

const pct = (n: number, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;

/**
 * The honesty panel.
 *
 * Every agent in this category publishes a P&L with no error bar. This is the
 * error bar. It is deliberately the section that most often says "this proves
 * nothing yet" — that sentence is the product, not a caveat on it.
 */
export default function TrackRecordPanel({ stats }: { stats: AgentStats }) {
  const tr = stats.track_record;
  const cal = stats.calibration;
  const bench = stats.benchmark;

  const target = tr.minTrackRecordLength;
  const progress =
    target && target > 0 ? Math.min(100, (tr.trades / target) * 100) : tr.trades > 0 ? 100 : 0;

  return (
    <section className={styles.proof} aria-label="What this record proves">
      <div className={styles.proofHead}>
        <h2 className={styles.sectionTitle}>What this record proves</h2>
        <span className={tr.significant ? styles.proofBadgeOk : styles.proofBadgeWait}>
          {tr.significant ? 'statistically significant' : 'not yet significant'}
        </span>
      </div>

      <p className={styles.proofVerdict}>{tr.summary}</p>

      {target ? (
        <div className={styles.proofBar} role="img"
          aria-label={`${tr.trades} of about ${target} closed trades needed`}>
          <div
            className={tr.significant ? styles.proofFillOk : styles.proofFill}
            style={{ width: `${progress}%` }}
          />
          <span className={styles.proofBarLabel}>
            {tr.trades} / ~{target} closed trades
          </span>
        </div>
      ) : null}

      <dl className={styles.proofGrid}>
        <div className={styles.proofStat}>
          <dt>Sharpe (per trade)</dt>
          <dd>{tr.sharpe === null ? '—' : tr.sharpe.toFixed(3)}</dd>
        </div>
        <div className={styles.proofStat}>
          <dt>P(true Sharpe &gt; 0)</dt>
          <dd>{tr.psr === null ? '—' : `${(tr.psr * 100).toFixed(1)}%`}</dd>
        </div>
        <div className={styles.proofStat}>
          <dt>Skew</dt>
          <dd className={tr.skew !== null && tr.skew < 0 ? styles.down : undefined}>
            {tr.skew === null ? '—' : tr.skew.toFixed(2)}
          </dd>
        </div>
        <div className={styles.proofStat}>
          <dt>Kurtosis</dt>
          <dd className={tr.kurtosis !== null && tr.kurtosis > 6 ? styles.down : undefined}>
            {tr.kurtosis === null ? '—' : tr.kurtosis.toFixed(1)}
          </dd>
        </div>
      </dl>

      {bench ? (
        <p className={bench.beatsBenchmark ? styles.proofBench : styles.proofBenchBad}>
          <strong>Versus doing nothing.</strong> Strategy {pct(bench.strategyReturnPct, 2)} ·{' '}
          {bench.label} {pct(bench.benchmarkReturnPct, 2)}. {bench.summary}
        </p>
      ) : null}

      <div className={styles.proofSub}>
        <h3 className={styles.proofSubTitle}>Is the agent&rsquo;s confidence worth anything?</h3>
        <p className={styles.proofSubNote}>{cal.summary}</p>
        {cal.buckets.length > 0 ? (
          <ReliabilityCurve stats={stats} />
        ) : null}
        {cal.brierScore !== null ? (
          <p className={styles.proofFootnote}>
            Brier score {cal.brierScore.toFixed(3)} (0.25 is a coin flip) · calibration error{' '}
            {cal.expectedCalibrationError === null
              ? '—'
              : (cal.expectedCalibrationError * 100).toFixed(1)}
            pts · {cal.samples} scored trades
          </p>
        ) : null}
      </div>

      <p className={styles.proofFootnote}>
        Every simulated fill is charged {stats.costs.paper_fee_bps_per_side}bps per side plus price
        impact, modelled as {stats.costs.impact_model}. Costs are published because omitting them is
        the commonest way a trading record gets inflated.
      </p>
    </section>
  );
}

/**
 * Classic reliability diagram: stated confidence on x, realised win rate on y.
 * The diagonal is perfect calibration; points below it are overconfidence, and
 * since position size scales with the stated number, points below the diagonal
 * are money.
 */
function ReliabilityCurve({ stats }: { stats: AgentStats }) {
  const W = 320;
  const H = 200;
  const P = 28;
  const x = (v: number) => P + v * (W - P * 2);
  const y = (v: number) => H - P - v * (H - P * 2);
  const maxCount = Math.max(...stats.calibration.buckets.map((b) => b.count), 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.proofSvg} role="img"
      aria-label="Reliability curve: stated confidence versus realised win rate">
      <rect x={P} y={P} width={W - P * 2} height={H - P * 2} className={styles.proofPlot} />
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g}>
          <line x1={x(g)} y1={P} x2={x(g)} y2={H - P} className={styles.proofGrid2} />
          <line x1={P} y1={y(g)} x2={W - P} y2={y(g)} className={styles.proofGrid2} />
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className={styles.proofDiagonal} />
      <polyline
        className={styles.proofLine}
        points={stats.calibration.buckets
          .map((b) => `${x(b.statedConfidence)},${y(b.realizedWinRate)}`)
          .join(' ')}
      />
      {stats.calibration.buckets.map((b) => (
        <circle
          key={b.from}
          cx={x(b.statedConfidence)}
          cy={y(b.realizedWinRate)}
          r={3 + (b.count / maxCount) * 4}
          className={b.gap < -0.1 ? styles.proofDotBad : styles.proofDot}
        >
          <title>
            {`Said ${(b.statedConfidence * 100).toFixed(0)}%, won ${(b.realizedWinRate * 100).toFixed(0)}% (${b.count} trades)`}
          </title>
        </circle>
      ))}
      <text x={W / 2} y={H - 6} className={styles.proofAxis} textAnchor="middle">
        stated confidence →
      </text>
      <text x={10} y={H / 2} className={styles.proofAxis} textAnchor="middle"
        transform={`rotate(-90 10 ${H / 2})`}>
        realised win rate →
      </text>
    </svg>
  );
}
